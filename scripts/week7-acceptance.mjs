// Week 7 acceptance / integration tests — the REAL architecture:
// real HTTP app + real PostgreSQL + real Redis/BullMQ + real TypeScript
// Worker processes (started/stopped by this script) + real private storage.
//
// Usage:
//   Redis on 127.0.0.1:6379 (or REDIS_URL)                     (terminal 1)
//   npm run build && npm run start -- -p 3100                   (terminal 2)
//   (do NOT run `npm run worker` meanwhile: the test controls the Worker)
//   BASE_URL=http://localhost:3100 npm run test:week7           (terminal 3)
//
// Cleans up everything it creates: [TEST] rows, uploaded files, Chunks and
// ONLY its own Jobs in the NozomKB queue (never FLUSHALL / FLUSHDB).
// DATABASE_URL / REDIS_URL are read from the environment or .env.local and
// never printed.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { BASE, Browser } from "./lib/test-browser.mjs";
import { buildPdf } from "./lib/pdf-fixtures.mjs";

const ROOT = process.cwd();
if (!process.env.DATABASE_URL && existsSync(path.join(ROOT, ".env.local"))) {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
}
const STORAGE = path.resolve(process.env.FILE_STORAGE_DIR ?? path.join(ROOT, "storage", "private"));
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
// Must match lib/processing/config.ts
const QUEUE_NAME = "nozom-file-processing";
const QUEUE_PREFIX = "nozomkb";
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const M = `w7${Date.now().toString(36)}`; // unique marker for this run
const AR_EMPTY = "الملف لا يحتوي على نص قابل للبحث.";
const AR_NO_PDF_TEXT = "لم يتم العثور على نص قابل للاستخراج في ملف PDF";
const AR_RETRYING = "ستتم إعادة المحاولة تلقائيًا";
const AR_FAILED = "فشلت معالجة الملف بعد عدة محاولات";

const results = [];
function check(number, name, passed, detail = "") {
  results.push({ number, name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  [${number}] ${name}${detail ? `  (${detail})` : ""}`);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE_NAME, { connection: redis, prefix: QUEUE_PREFIX });

const created = { posts: [], fileIds: new Set(), extraJobIds: new Set(), held: [] };

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, fn, timeoutMs = 40000, intervalMs = 150) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await sleep(intervalMs);
  }
}

async function fileRow(id) {
  const r = await db.query(
    `SELECT id, version, processing_status AS status, processing_error AS error,
            is_active, storage_key, processed_at
     FROM files WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

async function chunkRows(id) {
  const r = await db.query(
    `SELECT id, file_id, version, page_number, chunk_index, text
     FROM file_chunks WHERE file_id = $1 ORDER BY version, chunk_index`,
    [id]
  );
  return r.rows;
}

const waitStatus = (id, status, timeoutMs) =>
  waitFor(`file ${id} -> ${status}`, async () => {
    const row = await fileRow(id);
    return row?.status === status ? row : null;
  }, timeoutMs);

const jobId = (fileId, version) => `file-${fileId}-v${version}`;

async function jobState(id) {
  const job = await queue.getJob(id);
  return job ? { state: await job.getState(), job } : { state: null, job: null };
}

const waitJobDone = (id, timeoutMs) =>
  waitFor(`job ${id} finished`, async () => {
    const { state, job } = await jobState(id);
    return state === "completed" || state === "failed" ? job : null;
  }, timeoutMs);

const search = (browser, q, type = "all") =>
  browser.json(`/api/search?${new URLSearchParams({ q, type })}`);
const fileHits = async (browser, q, type = "all") =>
  ((await search(browser, q, type)).data?.results ?? []).filter((r) => r.type === "file");

async function upload(browser, postId, name, text, type = "text/plain") {
  const bytes = typeof text === "string" ? Buffer.from(text, "utf8") : text;
  const r = await browser.upload(`/api/posts/${postId}/files`, { name, type, bytes });
  if (r.data?.id) created.fileIds.add(r.data.id);
  return r;
}

async function newPost(browser, fields) {
  const r = await browser.json("/api/posts", "POST", {
    tag: "IT", scope: "company", status: "published", ...fields,
  });
  if (r.status !== 201) throw new Error(`Could not create post: ${r.status}`);
  created.posts.push(r.data.id);
  return r.data;
}

// Hide a stored file from the Worker (real I/O failure), and put it back.
async function hideStored(fileId) {
  const { storage_key: key } = await fileRow(fileId);
  const from = path.join(STORAGE, key);
  await rename(from, `${from}.held`);
  created.held.push(from);
  return from;
}
async function restoreStored(from) {
  await rename(`${from}.held`, from);
  created.held = created.held.filter((p) => p !== from);
}

// ------------------------------------------------------- Worker processes
let worker = null;

async function startWorker() {
  const lines = [];
  const child = spawn(process.execPath, [TSX_CLI, "worker/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, WORKER_CONCURRENCY: "2" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
  child.stderr.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
  worker = { child, lines };
  await waitFor("worker ready", () => lines.some((l) => l.includes("listening on")), 30000);
  return worker;
}

async function stopWorker() {
  if (!worker) return;
  const { child } = worker;
  // never kill it in the middle of a Job
  await waitFor("queue idle", async () => (await queue.getActiveCount()) === 0, 60000);
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  await waitFor("worker exit", () => child.exitCode !== null || child.signalCode !== null, 15000);
  await waitFor("no workers on queue", async () => (await queue.getWorkers()).length === 0, 15000);
  worker = null;
}

function runProcessFileDirect(fileId, version, times) {
  const out = spawnSync(
    process.execPath,
    [TSX_CLI, "scripts/lib/run-process-file.ts", String(fileId), String(version), String(times)],
    { cwd: ROOT, encoding: "utf8" }
  );
  const line = out.stdout.trim().split("\n").pop();
  return JSON.parse(line);
}

// ------------------------------------------------------------------- main
async function main() {
  if ((await queue.getWorkers()).length > 0) {
    throw new Error("Another NozomKB Worker is running. Stop `npm run worker` first: this test controls the Worker.");
  }

  const admin = await new Browser().login("admin@nozom.local");
  const ali = await new Browser().login("ali@nozom.local");     // Member IT
  const ahmed = await new Browser().login("ahmed@nozom.local"); // Member HR

  const post = await newPost(ali, { title: `[TEST] W7 files ${M}`, content: `Week 7 ${M}` });

  // Long TXT (several Chunks). k1 = "old version" keyword.
  const para = (n) =>
    `Paragraph ${n}. Printer queue maintenance notes and network checks for the IT team. `.repeat(6);
  const longText =
    `Intro ${M}k1 start.\n\n` +
    Array.from({ length: 10 }, (_, i) => para(i + 1)).join("\n\n") +
    `\n\nClosing line ${M}k1 end.\r\n`;

  // ---------------- 1-4: TXT upload -> Pending -> Processing -> Ready ----------------
  const t1 = await upload(ali, post.id, `w7-notes-${M}.txt`, longText);
  const t1Id = t1.data?.id;
  const t1Job = await jobState(jobId(t1Id, 1));
  const t1Db = await fileRow(t1Id);
  check(1, "Upload TXT -> status starts Pending (Job waiting in Redis, nothing extracted in the request)",
    t1.status === 201 && t1.data.status === "pending" && t1Db.status === "pending" &&
      ["waiting", "prioritized"].includes(t1Job.state) && (await chunkRows(t1Id)).length === 0,
    `api=${t1.data?.status}, db=${t1Db?.status}, job=${t1Job.state}`);

  // Hold a KEY SHARE lock: the Worker can mark the row "processing" but must
  // wait for us before its final FOR UPDATE transaction -> Processing is observable.
  const lockClient = await db.connect();
  await lockClient.query("BEGIN");
  await lockClient.query("SELECT 1 FROM files WHERE id = $1 FOR KEY SHARE", [t1Id]);
  await startWorker();
  const seenProcessing = await waitStatus(t1Id, "processing", 30000).then(() => true).catch(() => false);
  await lockClient.query("COMMIT");
  lockClient.release();
  const t1Ready = await waitStatus(t1Id, "ready", 30000).catch(() => null);
  check(2, "Worker processes TXT: Pending -> Processing -> Ready",
    t1Db.status === "pending" && seenProcessing && t1Ready?.status === "ready" && t1Ready.processed_at !== null);

  const t1Chunks = await chunkRows(t1Id);
  check(3, "TXT produces Chunks",
    t1Chunks.length >= 3 && t1Chunks.every((c, i) => c.chunk_index === i),
    `${t1Chunks.length} chunks, ${longText.length} chars`);
  check(4, "Every Chunk links to file + version + chunk index + page (TXT = page 1)",
    t1Chunks.every((c) => Number(c.file_id) === t1Id && c.version === 1 && c.page_number === 1 &&
      Number.isInteger(c.chunk_index) && c.text.length > 0 && c.text.length <= 1200) &&
      t1Chunks[0].text.includes(`${M}k1`));

  // ---------------- 5: text PDF, page-aware ----------------
  const pdfBytes = buildPdf([
    `Page one about printers ${M}p1 and toner.`,
    null, // image-only page in the middle
    `Page three about VPN ${M}p3 and certificates.`,
  ]);
  const pdf = await upload(ali, post.id, `w7-guide-${M}.pdf`, pdfBytes, "application/pdf");
  const pdfId = pdf.data?.id;
  await waitStatus(pdfId, "ready").catch(() => null);
  const pdfChunks = await chunkRows(pdfId);
  check(5, "Text PDF -> Ready, Chunks keep the real page numbers",
    pdfChunks.length === 2 &&
      pdfChunks[0].page_number === 1 && pdfChunks[0].text.includes(`${M}p1`) &&
      pdfChunks[1].page_number === 3 && pdfChunks[1].text.includes(`${M}p3`),
    `pages=${pdfChunks.map((c) => c.page_number).join(",")}`);

  // ---------------- 6-8: not indexable Files ----------------
  const empty = await upload(ali, post.id, `w7-empty-${M}.txt`, " \r\n\t \n ");
  const emptyRow = await waitStatus(empty.data?.id, "failed").catch(() => null);
  const emptyJob = (await jobState(jobId(empty.data?.id, 1))).job;
  check(6, "Empty (whitespace-only) TXT -> Failed, clear reason, no pointless retries",
    emptyRow?.error === AR_EMPTY && emptyJob?.attemptsMade === 1 &&
      (await chunkRows(empty.data?.id)).length === 0,
    `attempts=${emptyJob?.attemptsMade}`);

  const scanned = await upload(ali, post.id, `w7-scan-${M}.pdf`, buildPdf([null, null]), "application/pdf");
  const scannedRow = await waitStatus(scanned.data?.id, "failed").catch(() => null);
  check(7, "Image-only (scanned-style) PDF -> Failed: no extractable text, no OCR",
    scannedRow?.error?.includes(AR_NO_PDF_TEXT) && (await chunkRows(scanned.data?.id)).length === 0);

  const listed = (await ahmed.json(`/api/posts/${post.id}/files`)).data ?? [];
  const listedScan = listed.find((f) => f.id === scanned.data?.id);
  const postHtml = (await ali.html(`/posts/${post.id}`)).text;
  check(8, "Processing failure is visible in the API and the UI (safe message, no stack, no storage key)",
    listedScan?.status === "failed" && listedScan.error?.includes(AR_NO_PDF_TEXT) &&
      !("storageKey" in listedScan) && postHtml.includes("Failed") && postHtml.includes(AR_NO_PDF_TEXT) &&
      !JSON.stringify(listed).includes(scannedRow?.storage_key ?? "@@") && !/\bat .+\.ts:\d+/.test(postHtml));

  // ---------------- 11-12: idempotency ----------------
  const before = t1Chunks.length;
  const rerunId = `test-${M}-rerun`;
  created.extraJobIds.add(rerunId);
  await queue.add("process-file", { fileId: t1Id, version: 1 }, { jobId: rerunId });
  const rerun = await waitJobDone(rerunId);
  const afterRerun = await chunkRows(t1Id);
  const direct = runProcessFileDirect(t1Id, 1, 2);
  check(11, "Re-running the SAME Job/version keeps the same logical Chunk count",
    rerun.returnvalue?.outcome === "ready" && afterRerun.length === before &&
      afterRerun[0].id !== t1Chunks[0].id && // really re-processed (rows replaced)
      direct.outcomes.join() === "ready,ready" && direct.counts.every((n) => n === before),
    `before=${before}, after BullMQ re-run=${afterRerun.length}, direct processFile x2=${direct.counts}`);

  const dupIds = [1, 2, 3].map((n) => `test-${M}-dup${n}`);
  dupIds.forEach((id) => created.extraJobIds.add(id));
  await Promise.all(dupIds.map((id) =>
    queue.add("process-file", { fileId: t1Id, version: 1 }, { jobId: id })));
  const dupJobs = await Promise.all(dupIds.map((id) => waitJobDone(id)));
  const dupCheck = await db.query(
    `SELECT COUNT(*)::int AS n, COUNT(DISTINCT (version, chunk_index))::int AS d
     FROM file_chunks WHERE file_id = $1`, [t1Id]);
  check(12, "Concurrent duplicate deliveries do not create duplicate Chunks",
    dupJobs.every((j) => j.returnvalue?.outcome === "ready") &&
      dupCheck.rows[0].n === before && dupCheck.rows[0].d === before,
    `${dupCheck.rows[0].n} chunks after 3 parallel jobs`);

  // ---------------- Worker stopped: queue up the tricky cases ----------------
  await stopWorker();

  // 9 + 10: real transient I/O failure (stored file temporarily unreadable)
  const a = await upload(ali, post.id, `w7-retry-a-${M}.txt`, `Transient retry ${M}ra file.`);
  const b = await upload(ali, post.id, `w7-retry-b-${M}.txt`, `Manual retry ${M}rb file.`);
  const aHidden = await hideStored(a.data.id);
  const bHidden = await hideStored(b.data.id);

  // 24: File deleted while its Job waits
  const d = await upload(ali, post.id, `w7-deleted-${M}.txt`, `Deleted before processing ${M}dd.`);
  const dDelete = await ali.json(`/api/files/${d.data.id}`, "DELETE");

  // 25: File replaced while the old-version Job waits
  const e = await upload(ali, post.id, `w7-stale-${M}.txt`, `Old version text ${M}e1.`);
  const eReplace = await ali.upload(`/api/files/${e.data.id}/replace`, {
    name: `w7-stale-${M}.txt`, type: "text/plain", bytes: Buffer.from(`New version text ${M}e2.`),
  });

  // Phase 20: File disabled while its Job waits
  const f = await upload(ali, post.id, `w7-disabled-${M}.txt`, `Disabled while waiting ${M}ff.`);
  const fDisable = await ali.json(`/api/files/${f.data.id}`, "PATCH", { isActive: false });

  // 13-14: replace the Ready T1 file (k1 -> k2)
  const searchableBefore = (await fileHits(ali, `${M}k1`)).length;
  const replaced = await ali.upload(`/api/files/${t1Id}/replace`, {
    name: `w7-notes-v2-${M}.txt`, type: "text/plain",
    bytes: Buffer.from(`Version two of the notes ${M}k2 with updated printer steps.\n\nMore v2 text.`),
  });
  const t1AfterReplace = await fileRow(t1Id);
  check(13, "Replace File -> version increments, status Pending, new Job for the NEW version",
    replaced.status === 200 && replaced.data?.version === 2 && replaced.data?.status === "pending" &&
      t1AfterReplace.version === 2 && (await jobState(jobId(t1Id, 2))).state === "waiting");

  const oldHitsNow = await fileHits(ali, `${M}k1`);
  const newHitsNow = await fileHits(ali, `${M}k2`);
  check(14, "Old version Chunks are excluded immediately after replacement (before re-processing)",
    searchableBefore === 1 && oldHitsNow.length === 0 && newHitsNow.length === 0 &&
      (await chunkRows(t1Id)).length === 0,
    `before=${searchableBefore}, old now=${oldHitsNow.length}`);

  // ---------------- Worker back: retries, stale Jobs, new version ----------------
  await startWorker();

  // 9: automatic retry — first attempt fails, file comes back, retry succeeds
  const aRetrying = await waitFor("A retrying", async () => {
    const row = await fileRow(a.data.id);
    return row?.status === "pending" && row.error?.includes(AR_RETRYING) ? row : null;
  }).catch(() => null);
  await restoreStored(aHidden);
  const aReady = await waitStatus(a.data.id, "ready").catch(() => null);
  const aJob = (await jobState(jobId(a.data.id, 1))).job;
  check(9, "Automatic retry after a transient failure (attempt 1 fails -> BullMQ retries -> Ready)",
    Boolean(aRetrying) && aReady?.status === "ready" && aReady.error === null &&
      aJob?.attemptsMade >= 1 && (await chunkRows(a.data.id)).length === 1,
    `attemptsMade=${aJob?.attemptsMade}`);

  // 10: retries exhausted -> Failed -> manual retry
  const bFailed = await waitStatus(b.data.id, "failed", 60000).catch(() => null);
  const bJob = (await jobState(jobId(b.data.id, 1))).job;
  await restoreStored(bHidden);
  const ahmedRetry = await ahmed.json(`/api/files/${b.data.id}/retry`, "POST");
  const aliRetry = await ali.json(`/api/files/${b.data.id}/retry`, "POST");
  const bReady = await waitStatus(b.data.id, "ready").catch(() => null);
  const retryReady = await ali.json(`/api/files/${b.data.id}/retry`, "POST");
  check(10, "Retries exhausted -> Failed (visible); manual Retry by the manager -> Ready",
    bFailed?.error?.includes(AR_FAILED) && bJob?.attemptsMade === 3 &&
      ahmedRetry.status === 403 && aliRetry.status === 202 && aliRetry.data?.status === "pending" &&
      bReady?.status === "ready" && retryReady.status === 409 &&
      (await chunkRows(b.data.id)).length === 1,
    `attempts=${bJob?.attemptsMade}, other user=${ahmedRetry.status}, owner=${aliRetry.status}, retry on Ready=${retryReady.status}`);

  // 15: the new version is processed; only it is searchable
  await waitStatus(t1Id, "ready").catch(() => null);
  const t1v2Chunks = await chunkRows(t1Id);
  const newHits = await fileHits(ali, `${M}k2`);
  check(15, "Worker processes the new version; only current Chunks are searchable",
    t1v2Chunks.length > 0 && t1v2Chunks.every((c) => c.version === 2) &&
      newHits.length === 1 && newHits[0].file.id === t1Id &&
      (await fileHits(ali, `${M}k1`)).length === 0);

  // 24: stale Job for a deleted File exits safely
  const dJob = await waitJobDone(jobId(d.data.id, 1)).catch(() => null);
  check(24, "Stale Job for a deleted File exits safely (no rows, no Chunks, no error)",
    dDelete.status === 200 && dJob?.returnvalue?.outcome === "missing" && !dJob.failedReason &&
      (await fileRow(d.data.id)) === null && (await chunkRows(d.data.id)).length === 0);

  // 25: old-version Job cannot overwrite the current version
  const eOldJob = await waitJobDone(jobId(e.data.id, 1)).catch(() => null);
  const eReady = await waitStatus(e.data.id, "ready").catch(() => null);
  const eChunks = await chunkRows(e.data.id);
  check(25, "Stale old-version Job cannot overwrite the current version",
    eReplace.data?.version === 2 && eOldJob?.returnvalue?.outcome === "stale" &&
      eReady?.version === 2 && eChunks.length === 1 && eChunks[0].version === 2 &&
      eChunks[0].text.includes(`${M}e2`) && !eChunks[0].text.includes(`${M}e1`));

  // Phase 20: disabled while waiting -> skipped; re-enable -> processed
  const fJob = await waitJobDone(jobId(f.data.id, 1)).catch(() => null);
  const fWhileDisabled = await fileRow(f.data.id);
  const fEnable = await ali.json(`/api/files/${f.data.id}`, "PATCH", { isActive: true });
  const fReady = await waitStatus(f.data.id, "ready").catch(() => null);
  check("S1", "Disabled while its Job waits -> not processed; Enable -> queued again -> Ready",
    fDisable.status === 200 && fJob?.returnvalue?.outcome === "inactive" &&
      fWhileDisabled.status === "pending" && (await chunkRows(f.data.id)).length === 1 &&
      fEnable.status === 200 && fReady?.status === "ready");

  // ---------------- 16-19: disable / enable / search results ----------------
  const pdfHitsBefore = await fileHits(ali, `${M}p3`, "file");
  const disable = await ali.json(`/api/files/${pdfId}`, "PATCH", { isActive: false });
  const pdfHitsDisabled = await fileHits(ali, `${M}p3`);
  const pdfChunksKept = (await chunkRows(pdfId)).length;
  const readerDownload = await ahmed.request(`/api/files/${pdfId}/download`);
  const managerDownload = await ali.request(`/api/files/${pdfId}/download`);
  const readerList = (await ahmed.json(`/api/posts/${post.id}/files`)).data ?? [];
  check(16, "Disable a Ready File -> its Chunks leave Search immediately (rows kept), readers lose access",
    pdfHitsBefore.length === 1 && disable.status === 200 && disable.data?.isActive === false &&
      pdfHitsDisabled.length === 0 && pdfChunksKept === 2 &&
      readerDownload.status === 404 && managerDownload.status === 200 &&
      !readerList.some((x) => x.id === pdfId),
    `reader download=${readerDownload.status}, manager download=${managerDownload.status}`);

  const enable = await ali.json(`/api/files/${pdfId}`, "PATCH", { isActive: true });
  const pdfHitsEnabled = await fileHits(ahmed, `${M}p3`);
  check(17, "Re-enable a Ready File -> permitted Chunks are searchable again (no re-processing needed)",
    enable.status === 200 && enable.data?.status === "ready" && pdfHitsEnabled.length === 1);

  const typeFile = await search(ali, `${M}p1`, "file");
  const typePost = await search(ali, `${M}p1`, "post");
  check(18, "Keyword Search finds the current Ready File Chunk (type=all and type=file)",
    (await fileHits(ali, `${M}p1`)).length === 1 && typeFile.data?.results?.length === 1 &&
      typeFile.data.results[0].type === "file" && typePost.data?.results?.length === 0);

  const hit = pdfHitsEnabled[0];
  const searchHtml = (await ali.html(`/search?q=${M}p3&type=file`)).text;
  check(19, "File result identifies file name, parent and page (and offers an authorized link)",
    hit?.file?.name === `w7-guide-${M}.pdf` && hit.file.pageNumber === 3 &&
      hit.parentTitle === post.title && hit.parentKind === "post" && hit.parentId === post.id &&
      hit.snippet.includes(`${M}p3`) && newHits[0]?.file?.pageNumber === null &&
      searchHtml.includes(`w7-guide-${M}.pdf`) && searchHtml.includes("Page 3") &&
      searchHtml.includes(`/api/files/${pdfId}/download`) &&
      !searchHtml.includes(scannedRow?.storage_key ?? "@@") && !JSON.stringify(hit).includes("storage"));

  // ---------------- 20-22: parent permissions ----------------
  const hrPost = await newPost(ahmed, {
    title: `[TEST] W7 HR only ${M}`, content: "HR restricted", tag: "HR", scope: "department",
  });
  const hrFile = await upload(ahmed, hrPost.id, `w7-hr-${M}.txt`, `Salary bands ${M}hr confidential.`);
  await waitStatus(hrFile.data?.id, "ready").catch(() => null);
  const hrForAhmed = await fileHits(ahmed, `${M}hr`);
  const hrForAli = await fileHits(ali, `${M}hr`);
  const hrForAdmin = await fileHits(admin, `${M}hr`);
  const hrAliRaw = JSON.stringify((await search(ali, `${M}hr`)).data);
  check(20, "User from another department cannot see restricted File Chunks",
    hrForAhmed.length === 1 && hrForAli.length === 0 && hrForAdmin.length === 1 &&
      !hrAliRaw.includes("confidential"));

  const draftPost = await newPost(ali, {
    title: `[TEST] W7 draft ${M}`, content: "draft", status: "draft",
  });
  const draftFile = await upload(ali, draftPost.id, `w7-draft-${M}.txt`, `Draft only ${M}dr text.`);
  const draftReady = await waitStatus(draftFile.data?.id, "ready").catch(() => null);
  check(21, "Draft parent -> its File Chunks are absent from Search (even for the owner)",
    draftReady?.status === "ready" && (await fileHits(ali, `${M}dr`)).length === 0 &&
      (await fileHits(ahmed, `${M}dr`)).length === 0 && (await fileHits(admin, `${M}dr`)).length === 0);

  const archPost = await newPost(ali, { title: `[TEST] W7 archived ${M}`, content: "to archive" });
  const archFile = await upload(ali, archPost.id, `w7-arch-${M}.txt`, `Archived later ${M}ar text.`);
  await waitStatus(archFile.data?.id, "ready").catch(() => null);
  const archBefore = (await fileHits(ahmed, `${M}ar`)).length;
  const archive = await ali.json(`/api/posts/${archPost.id}`, "PATCH", {
    title: archPost.title, content: archPost.content, status: "archived", scope: "company",
  });
  check(22, "Archived parent -> its File Chunks disappear from Search",
    archBefore === 1 && archive.status === 200 &&
      (await fileHits(ahmed, `${M}ar`)).length === 0 && (await fileHits(ali, `${M}ar`)).length === 0);

  // ---------------- 23: delete ----------------
  const delRow = await fileRow(pdfId);
  const delPath = path.join(STORAGE, delRow.storage_key);
  const del = await ali.json(`/api/files/${pdfId}`, "DELETE");
  check(23, "Deleted File -> metadata, Chunks (cascade) and disk file are gone; Search empty",
    del.status === 200 && (await fileRow(pdfId)) === null && (await chunkRows(pdfId)).length === 0 &&
      !existsSync(delPath) && (await fileHits(ali, `${M}p3`)).length === 0);

  // Worker log never contains secrets
  const log = worker?.lines.join("\n") ?? "";
  const secrets = [process.env.DATABASE_URL, process.env.AUTH_SECRET].filter(Boolean);
  check("S2", "Worker log has no secrets and no file contents",
    secrets.every((s) => !log.includes(s)) && !log.includes(`${M}k2`) && log.includes("[worker] job"));

  console.log("\n(26 = npm run test:week5, 27 = npm run test:week6, 28 = npm run test:e2e)");
}

// ---------------------------------------------------------------- cleanup
async function cleanup() {
  for (const from of created.held) {
    await rename(`${from}.held`, from).catch(() => undefined);
  }

  const admin = await new Browser().login("admin@nozom.local").catch(() => null);
  // API deletes also remove the private files from disk (+ Chunks by cascade).
  for (const id of created.posts) {
    if (admin) await admin.json(`/api/posts/${id}`, "DELETE");
  }

  const leftovers = await db.query(`SELECT id FROM files WHERE original_name LIKE $1`, [`%${M}%`]);
  for (const row of leftovers.rows) {
    if (admin) await admin.json(`/api/files/${row.id}`, "DELETE");
  }
  // Any other [TEST] post (e.g. from an interrupted run): delete through the
  // API first so its private files leave the disk too, then sweep the rows.
  const testPosts = await db.query(`SELECT id FROM posts WHERE title LIKE '[TEST]%'`);
  for (const row of testPosts.rows) {
    if (admin) await admin.json(`/api/posts/${row.id}`, "DELETE");
  }
  await db.query(`DELETE FROM posts WHERE title LIKE '[TEST]%'`);

  await stopWorker().catch((error) => console.error("stop worker:", error.message));

  // Remove ONLY this run's Jobs (by id). No FLUSHALL / FLUSHDB.
  let removed = 0;
  const ids = [...created.extraJobIds];
  for (const fileId of created.fileIds) {
    for (let v = 1; v <= 5; v += 1) ids.push(jobId(fileId, v));
  }
  for (const id of ids) {
    const job = await queue.getJob(id);
    if (job) {
      await job.remove();
      removed += 1;
    }
  }
  const remaining = (await Promise.all(ids.map((id) => queue.getJob(id)))).filter(Boolean).length;
  console.log(`cleanup: removed ${removed} test job(s) from "${QUEUE_PREFIX}:${QUEUE_NAME}", ${remaining} left`);
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error(error);
  if (worker) console.error("--- worker log ---\n" + worker.lines.slice(-30).join("\n"));
  exitCode = 1;
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
  await queue.close();
  await redis.quit();
  await db.end();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. (BASE_URL=${BASE})`);
process.exitCode = failed.length || exitCode ? 1 : 0;
