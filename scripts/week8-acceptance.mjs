// Week 8 acceptance / integration tests — Embeddings + pgvector + Semantic
// Search, on the REAL architecture: real HTTP app + real PostgreSQL/pgvector +
// real Redis/BullMQ + real TypeScript Worker processes (started/stopped here).
//
// Embeddings: the TEST ONLY deterministic provider (no money, no network).
// These vectors are NOT real semantic quality — they only prove the
// architecture (indexing, lifecycle, permissions, idempotency). The real
// retrieval-quality comparison is `npm run eval:week8` (real local model).
//
// Usage:
//   Redis on 127.0.0.1:6379 (or REDIS_URL)                          (terminal 1)
//   npm run build
//   EMBEDDING_PROVIDER=test NOZOMKB_TEST_EMBEDDINGS=1 npm run start -- -p 3100
//                                                                   (terminal 2)
//   (do NOT run `npm run worker` meanwhile: this test controls the Worker)
//   BASE_URL=http://localhost:3100 npm run test:week8               (terminal 3)
//
// Cleans up everything it creates: [TEST] rows (semantic rows cascade),
// uploaded files and ONLY its own Jobs (never FLUSHALL / FLUSHDB).
// DATABASE_URL / REDIS_URL / AUTH_SECRET are never printed.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { BASE, Browser } from "./lib/test-browser.mjs";

const ROOT = process.cwd();
if (!process.env.DATABASE_URL && existsSync(path.join(ROOT, ".env.local"))) {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
}
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
// Must match lib/processing/config.ts and lib/semantic/config.ts
const QUEUE_PREFIX = "nozomkb";
const FILE_QUEUE = "nozom-file-processing";
const SEMANTIC_QUEUE = "nozom-semantic-indexing";
const SEMANTIC_TEST_QUEUE = "nozom-semantic-indexing-test";
const TEST_MODEL = "test-only:nozomkb-test-only-hash-v1@384";
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const TEST_ENV = { EMBEDDING_PROVIDER: "test", NOZOMKB_TEST_EMBEDDINGS: "1" };

const AR_INDEX_FAILED = "تعذّرت فهرسة المحتوى للبحث الدلالي بعد عدة محاولات.";

const M = `w8${Date.now().toString(36)}`; // unique marker for this run

const results = [];
function check(number, name, passed, detail = "") {
  results.push({ number, name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  [${number}] ${name}${detail ? `  (${detail})` : ""}`);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const fileQueue = new Queue(FILE_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });
const testQueue = new Queue(SEMANTIC_TEST_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });
const realQueue = new Queue(SEMANTIC_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });

const created = { posts: [], pages: [], comments: [], files: [] };

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

const semantic = (browser, q, type = "all") =>
  browser.json(`/api/search?${new URLSearchParams({ mode: "semantic", q, type })}`);
const keyword = (browser, q, type = "all") =>
  browser.json(`/api/search?${new URLSearchParams({ mode: "keyword", q, type })}`);
const hits = async (browser, q, type = "all") => (await semantic(browser, q, type)).data?.results ?? [];
const found = (list, type, id) =>
  list.some((r) => (type === "file" ? r.type === "file" && r.file?.id === id : r.type === type && r.id === id));
const sees = async (browser, q, type, id) => found(await hits(browser, q, type), type, id);

async function statusRow(kind, id) {
  const r = await db.query(
    `SELECT status, source_version, error, embedding_model, document_count
     FROM semantic_index_status WHERE source_kind = $1 AND source_id = $2`,
    [kind, id]
  );
  return r.rows[0] ?? null;
}

const DOC_FILTER = {
  page: "source_type = 'page' AND page_id = $1",
  post: "source_type = 'post' AND post_id = $1",
  comment: "comment_id = $1",
  file: "file_id = $1",
};
async function docs(kind, id) {
  const r = await db.query(
    `SELECT id, source_version, embedding_model, page_number, chunk_index
     FROM semantic_documents WHERE ${DOC_FILTER[kind]} ORDER BY source_version, chunk_index NULLS FIRST`,
    [id]
  );
  return r.rows;
}

const waitIndexed = (kind, id, version = 1, timeoutMs = 40000) =>
  waitFor(`${kind} ${id} v${version} indexed`, async () => {
    const row = await statusRow(kind, id);
    return row?.status === "ready" && row.source_version === version ? row : null;
  }, timeoutMs);

const waitSemanticStatus = (kind, id, status, timeoutMs = 40000) =>
  waitFor(`${kind} ${id} semantic ${status}`, async () => {
    const row = await statusRow(kind, id);
    return row?.status === status ? row : null;
  }, timeoutMs);

async function fileRow(id) {
  const r = await db.query(
    `SELECT id, version, processing_status AS status, is_active, storage_key FROM files WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}
const waitFileStatus = (id, status, timeoutMs = 40000) =>
  waitFor(`file ${id} -> ${status}`, async () => {
    const row = await fileRow(id);
    return row?.status === status ? row : null;
  }, timeoutMs);

async function newPost(browser, fields) {
  const r = await browser.json("/api/posts", "POST", {
    tag: "IT", scope: "company", status: "published", ...fields,
  });
  if (r.status !== 201) throw new Error(`Could not create post: ${r.status}`);
  created.posts.push(r.data.id);
  return r.data;
}

async function newPage(browser, fields) {
  const r = await browser.json("/api/pages", "POST", {
    scope: "company", status: "published", ...fields,
  });
  if (r.status !== 201) throw new Error(`Could not create page: ${r.status}`);
  created.pages.push(r.data.id);
  return r.data;
}

async function newComment(browser, postId, content) {
  const r = await browser.json(`/api/posts/${postId}/comments`, "POST", { content });
  if (r.status !== 201) throw new Error(`Could not create comment: ${r.status}`);
  created.comments.push(r.data.id);
  return r.data;
}

async function upload(browser, postId, name, text) {
  const r = await browser.upload(`/api/posts/${postId}/files`, {
    name, type: "text/plain", bytes: Buffer.from(text, "utf8"),
  });
  if (r.data?.id) created.files.push(r.data.id);
  return r.data;
}

function runIndexDirect(kind, id, version, times, mode) {
  const out = spawnSync(
    process.execPath,
    [TSX_CLI, "scripts/lib/run-index-source.ts", kind, String(id), String(version), String(times), mode],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...TEST_ENV } }
  );
  const line = out.stdout.trim().split("\n").pop();
  try { return JSON.parse(line); } catch { return { error: out.stderr || line }; }
}

// ------------------------------------------------------- Worker processes
let worker = null;

async function startWorker() {
  const lines = [];
  const child = spawn(process.execPath, [TSX_CLI, "worker/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, ...TEST_ENV, WORKER_CONCURRENCY: "2", SEMANTIC_WORKER_CONCURRENCY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
  child.stderr.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
  worker = { child, lines };
  await waitFor("worker ready", () => lines.some((l) => l.includes("[semantic] listening on")), 30000);
  return worker;
}

async function stopWorker() {
  if (!worker) return;
  const { child } = worker;
  // never kill it in the middle of a Job
  await waitFor("queues idle", async () =>
    (await fileQueue.getActiveCount()) === 0 && (await testQueue.getActiveCount()) === 0, 60000);
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  await waitFor("worker exit", () => child.exitCode !== null || child.signalCode !== null, 15000);
  await waitFor("no workers on queues", async () =>
    (await fileQueue.getWorkers()).length === 0 && (await testQueue.getWorkers()).length === 0, 15000);
  worker = null;
}

// ------------------------------------------------------------------- main
async function main() {
  if ((await fileQueue.getWorkers()).length > 0 || (await testQueue.getWorkers()).length > 0) {
    throw new Error("Another NozomKB Worker is running. Stop `npm run worker` first: this test controls the Worker.");
  }

  const admin = await new Browser().login("admin@nozom.local"); // Admin (IT)
  const ali = await new Browser().login("ali@nozom.local");     // Member IT
  const ahmed = await new Browser().login("ahmed@nozom.local"); // Member HR

  const probe = await semantic(ali, "probe");
  if (probe.status !== 200 || probe.data?.embedding?.testOnly !== true) {
    throw new Error(
      "The app must run with the TEST ONLY provider for this test: " +
        "EMBEDDING_PROVIDER=test NOZOMKB_TEST_EMBEDDINGS=1 npm run start -- -p 3100"
    );
  }
  console.log(`Embedding provider for this run: ${probe.data.embedding.provider} / ${probe.data.embedding.model} (TEST ONLY)\n`);

  // ---------------- 1-2: pgvector ----------------
  const ext = (await db.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`)).rows[0];
  check(1, "pgvector extension is enabled", Boolean(ext), `vector ${ext?.extversion}`);

  const col = (await db.query(
    `SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
     WHERE attrelid = 'semantic_documents'::regclass AND attname = 'embedding'`
  )).rows[0];
  check(2, "Vector column has the expected dimension", col?.type === "vector(384)", col?.type);

  // ---------------- fixtures ----------------
  await startWorker();

  const pLeave = await newPost(ali, {
    title: `[TEST] Annual leave rules ${M}`,
    content: "Every employee receives twenty one days of paid leave each year. Leave requests are approved by the manager.",
  });
  const pageCo = await newPage(admin, {
    title: `[TEST] Laptop handbook ${M}`,
    content: "IT prepares every laptop for new staff. A broken laptop must be reported to the helpdesk.",
  });
  const pageHr = await newPage(admin, {
    title: `[TEST] Payroll calendar ${M}`,
    content: "Salary is transferred on the 25th of each month. Payroll questions go to the HR team.",
    scope: "department", departmentId: 2,
  });
  const postIt = await newPost(ali, {
    title: `[TEST] VPN access ${M}`,
    content: "Use the VPN client to connect remotely from home.",
    scope: "department",
  });
  const cLeave = await newComment(ahmed, pLeave.id, "Remember to attach expense receipts for reimbursement.");
  const cIt = await newComment(ali, postIt.id, "Password resets are done on the self service portal.");
  const fPrinter = await upload(ali, pLeave.id, `w8-printer-${M}.txt`,
    "Printer toner cartridges are kept in the supply room on floor four.");
  const fOnboard = await upload(ali, postIt.id, `w8-onboarding-${M}.txt`,
    "Onboarding checklist: new hires receive orientation on day one.");

  await Promise.all([
    waitIndexed("post", pLeave.id), waitIndexed("page", pageCo.id), waitIndexed("page", pageHr.id),
    waitIndexed("post", postIt.id), waitIndexed("comment", cLeave.id), waitIndexed("comment", cIt.id),
    waitIndexed("file", fPrinter.id), waitIndexed("file", fOnboard.id),
  ]);

  // ---------------- 3-6: indexed + retrievable ----------------
  const pageCoDocs = await docs("page", pageCo.id);
  check(3, "Published Official Page is indexed (and retrievable)",
    pageCoDocs.length === 1 && pageCoDocs[0].embedding_model === TEST_MODEL &&
      (await sees(ali, "computer damaged notebook", "page", pageCo.id)));

  check(4, "Published Community Post is indexed (and retrievable)",
    (await docs("post", pLeave.id)).length === 1 &&
      (await sees(ahmed, "vacation holiday allowance", "post", pLeave.id)));

  check(5, "Comment with a published readable parent is indexed (and retrievable)",
    (await docs("comment", cLeave.id)).length === 1 &&
      (await sees(ali, "claim reimburse expenses", "comment", cLeave.id)));

  const printerDocs = await docs("file", fPrinter.id);
  const printerHits = await hits(ahmed, "printing cartridge supplies", "file");
  const printerHit = printerHits.find((r) => r.file?.id === fPrinter.id);
  check(6, "Ready current File Chunk is indexed (and retrievable with File + version)",
    printerDocs.length >= 1 && printerDocs.every((d) => d.source_version === 1 && d.page_number === 1) &&
      printerHit?.file?.version === 1 && printerHit?.downloadUrl === `/api/files/${fPrinter.id}/download`);

  // ---------------- 7: draft ----------------
  const pDraft = await newPost(ali, {
    title: `[TEST] Travel plan draft ${M}`,
    content: "Flight and hotel booking for the business trip.",
    status: "draft",
  });
  const cDraft = await newComment(ali, pDraft.id, "Trip budget for flights approved.");
  await sleep(1500);
  check(7, "Draft Post is not indexed and not retrievable (not even by its owner / Admin)",
    (await statusRow("post", pDraft.id)) === null && (await docs("post", pDraft.id)).length === 0 &&
      !(await sees(ali, "travel flight hotel trip", "post", pDraft.id)) &&
      !(await sees(admin, "travel flight hotel trip", "post", pDraft.id)));

  // ---------------- 8 + 9 + 23: archive ----------------
  const pArch = await newPost(ali, {
    title: `[TEST] Hotel guide ${M}`,
    content: "Preferred hotels for business travel and trip bookings.",
  });
  const cArch = await newComment(ahmed, pArch.id, "Flights must be booked two weeks ahead for every trip.");
  await Promise.all([waitIndexed("post", pArch.id), waitIndexed("comment", cArch.id)]);
  const archBefore =
    (await sees(ahmed, "travel trip hotel", "post", pArch.id)) &&
    (await sees(ahmed, "travel trip flights", "comment", cArch.id));
  const archived = await ali.json(`/api/posts/${pArch.id}`, "PATCH", {
    title: pArch.title, content: pArch.content, scope: "company", status: "archived",
  });
  // immediately after the response — no Worker involved
  const archPostGone = !(await sees(ahmed, "travel trip hotel", "post", pArch.id)) &&
    !(await sees(ali, "travel trip hotel", "post", pArch.id));
  const archCommentGone = !(await sees(ahmed, "travel trip flights", "comment", cArch.id));
  const archDocs = (await docs("post", pArch.id)).length + (await docs("comment", cArch.id)).length;

  check(8, "Archived Post is not retrievable", archived.status === 200 && archPostGone);
  check(9, "Comments on Draft / Archived parents are excluded",
    (await statusRow("comment", cDraft.id)) === null && (await docs("comment", cDraft.id)).length === 0 &&
      archCommentGone);
  check(23, "Archive -> old semantic results disappear immediately (vectors removed)",
    archBefore && archPostGone && archCommentGone && archDocs === 0 &&
      (await statusRow("post", pArch.id)) === null,
    `before=${archBefore}, vectors after=${archDocs}`);

  // ---------------- 10: failed File ----------------
  const fEmpty = await upload(ali, pLeave.id, `w8-empty-${M}.txt`, " \r\n \t \n ");
  await waitFileStatus(fEmpty.id, "failed").catch(() => null);
  const filesForAli = (await ali.json(`/api/posts/${pLeave.id}/files`)).data ?? [];
  const emptyItem = filesForAli.find((f) => f.id === fEmpty.id);
  check(10, "Failed File produces no semantic rows (Week 7 failure still shown)",
    emptyItem?.status === "failed" && Boolean(emptyItem?.error) && emptyItem?.semanticStatus === null &&
      (await docs("file", fEmpty.id)).length === 0 && (await statusRow("file", fEmpty.id)) === null);

  // ---------------- 11: disabled File ----------------
  const printerQ = "printing cartridge supplies";
  const disable = await ali.json(`/api/files/${fPrinter.id}`, "PATCH", { isActive: false });
  const disabledGone = !(await sees(ahmed, printerQ, "file", fPrinter.id)) &&
    !(await sees(ali, printerQ, "file", fPrinter.id));
  const disabledDocs = (await docs("file", fPrinter.id)).length;
  const enable = await ali.json(`/api/files/${fPrinter.id}`, "PATCH", { isActive: true });
  await waitIndexed("file", fPrinter.id).catch(() => null);
  check(11, "Disabled File produces no semantic result (re-enabled -> indexed again)",
    disable.status === 200 && disabledGone && disabledDocs === 0 && enable.status === 200 &&
      (await sees(ahmed, printerQ, "file", fPrinter.id)),
    `vectors while disabled=${disabledDocs}`);

  // ---------------- 12 + 27 + 28: replace (versions) ----------------
  const fVer = await upload(ali, pLeave.id, `w8-version-${M}.txt`,
    "Coffee machine descaling procedure: run the cleaning cycle weekly.");
  await waitIndexed("file", fVer.id, 1);
  const v1Before = await sees(ali, "coffee machine descaling", "file", fVer.id);
  const replaced = await ali.upload(`/api/files/${fVer.id}/replace`, {
    name: `w8-version-${M}.txt`, type: "text/plain",
    bytes: Buffer.from("Parking garage access cards are issued by facilities.", "utf8"),
  });
  const v1GoneNow = !(await sees(ali, "coffee machine descaling", "file", fVer.id));
  const v1Docs = (await docs("file", fVer.id)).filter((d) => d.source_version === 1).length;
  check(12, "Old File version produces no semantic result",
    replaced.status === 200 && replaced.data?.version === 2 && v1Before && v1GoneNow && v1Docs === 0);
  check(27, "Replace File -> old version's semantic rows disappear (immediately)",
    v1Before && v1GoneNow && v1Docs === 0, `v1 vectors after replace=${v1Docs}`);

  await waitFileStatus(fVer.id, "ready").catch(() => null);
  await waitIndexed("file", fVer.id, 2).catch(() => null);
  const v2Hit = (await hits(ali, "parking garage cards", "file")).find((r) => r.file?.id === fVer.id);
  const verDocs = await docs("file", fVer.id);
  const verStatus = await statusRow("file", fVer.id);
  const v1TextServed = (await hits(ali, "coffee machine descaling", "file"))
    .some((r) => r.file?.id === fVer.id && (r.file.version !== 2 || /coffee/i.test(r.snippet)));
  check(28, "New File version processed Ready -> semantically indexed (version 2 only)",
    v2Hit?.file?.version === 2 && verDocs.length >= 1 && verDocs.every((d) => d.source_version === 2) &&
      !v1TextServed,
    `status=${verStatus?.status} v${verStatus?.source_version}, vectors=${verDocs.map((d) => `v${d.source_version}`).join(",")}, hit v${v2Hit?.file?.version}`);

  // ---------------- 13 + 14: meaning vs keywords ----------------
  const kwVacation = await keyword(ali, "vacation holiday allowance");
  const kwLeave = await keyword(ali, "paid leave");
  const semVacation = await semantic(ali, "vacation holiday allowance");
  check(13, "Semantic query finds a meaning-related result although the words differ (TEST ONLY vectors)",
    found(semVacation.data?.results ?? [], "post", pLeave.id) &&
      !(kwVacation.data?.results ?? []).some((r) => r.type === "post" && r.id === pLeave.id),
    "query 'vacation holiday allowance' vs text about 'paid leave'");

  const badMode = await ali.json(`/api/search?${new URLSearchParams({ mode: "magic", q: "x" })}`);
  check(14, "Keyword and Semantic modes remain separate",
    kwVacation.data?.mode === "keyword" && kwLeave.data?.mode === "keyword" &&
      (kwLeave.data?.results ?? []).some((r) => r.type === "post" && r.id === pLeave.id) &&
      typeof kwLeave.data?.totalPages === "number" &&
      (kwLeave.data?.results ?? []).every((r) => r.similarity === undefined) &&
      semVacation.data?.mode === "semantic" &&
      (semVacation.data?.results ?? []).every((r) => typeof r.similarity === "number") &&
      badMode.status === 400);

  // ---------------- 15: openable source references ----------------
  const sample = [
    ...(await hits(ali, "vacation holiday allowance")),
    ...(await hits(ali, "printing cartridge supplies", "file")),
    ...(await hits(ali, "claim reimburse expenses", "comment")),
    ...(await hits(ali, "computer damaged notebook", "page")),
  ];
  let openable = sample.length >= 4;
  for (const r of sample) {
    const urlOk = /^\/(posts|official)\/\d+$/.test(r.url ?? "") && (await ali.html(r.url)).status === 200;
    const dlOk = r.type !== "file" ||
      (r.downloadUrl === `/api/files/${r.file?.id}/download` && (await ali.request(r.downloadUrl)).status === 200);
    const idOk = Number.isInteger(r.id) && Number.isInteger(r.parentId) && Boolean(r.parentTitle);
    if (!(urlOk && dlOk && idOk)) openable = false;
  }
  check(15, "Every semantic result has an openable source reference", openable, `${sample.length} results checked`);

  // ---------------- 16-19: other department ----------------
  check(16, "Wrong-department user cannot retrieve a restricted Page",
    (await sees(ahmed, "when is my wage paycheck", "page", pageHr.id)) &&
      !(await sees(ali, "when is my wage paycheck", "page", pageHr.id)));
  check(17, "Wrong-department user cannot retrieve a restricted Post",
    (await sees(ali, "telework remote connection", "post", postIt.id)) &&
      !(await sees(ahmed, "telework remote connection", "post", postIt.id)));
  check(18, "Wrong-department user cannot retrieve a restricted Comment",
    (await sees(ali, "forgot credentials passcode", "comment", cIt.id)) &&
      !(await sees(ahmed, "forgot credentials passcode", "comment", cIt.id)));
  const ahmedOnboard = JSON.stringify((await semantic(ahmed, "newcomer joiner orientation", "file")).data);
  check(19, "Wrong-department user cannot retrieve a restricted File Chunk",
    (await sees(ali, "newcomer joiner orientation", "file", fOnboard.id)) &&
      !(await sees(ahmed, "newcomer joiner orientation", "file", fOnboard.id)) &&
      !ahmedOnboard.includes("Onboarding checklist") && !ahmedOnboard.includes(`w8-onboarding-${M}`));

  // ---------------- 20: Admin ----------------
  check(20, "Admin retrieval follows the Admin policy (all departments, published only)",
    (await sees(admin, "when is my wage paycheck", "page", pageHr.id)) &&
      (await sees(admin, "telework remote connection", "post", postIt.id)) &&
      (await sees(admin, "newcomer joiner orientation", "file", fOnboard.id)) &&
      !(await sees(admin, "travel flight hotel trip", "post", pDraft.id)));

  // ---------------- 21: scope / department change ----------------
  const pScope = await newPost(ali, {
    title: `[TEST] Fire drill ${M}`,
    content: "The fire drill evacuation exercise happens every quarter in the parking lot.",
  });
  await waitIndexed("post", pScope.id);
  const scopeQ = "evacuation exercise fire drill";
  const ahmedBefore = await sees(ahmed, scopeQ, "post", pScope.id);
  await ali.json(`/api/posts/${pScope.id}`, "PATCH", {
    title: pScope.title, content: pScope.content, scope: "department", status: "published",
  });
  const ahmedAfter = await sees(ahmed, scopeQ, "post", pScope.id);
  const aliAfter = await sees(ali, scopeQ, "post", pScope.id);
  const scopeDocs = await docs("post", pScope.id);

  const moved = await admin.json(`/api/pages/${pageHr.id}`, "PATCH", {
    title: pageHr.title, content: pageHr.content, scope: "department", departmentId: 1, status: "published",
  });
  const payQ = "when is my wage paycheck";
  check(21, "Changing scope / department changes retrieval visibility immediately (no re-embedding)",
    ahmedBefore && !ahmedAfter && aliAfter && scopeDocs.length === 1 && scopeDocs[0].source_version === 1 &&
      moved.status === 200 && (await sees(ali, payQ, "page", pageHr.id)) && !(await sees(ahmed, payQ, "page", pageHr.id)),
    "post company->IT, page HR->IT");

  // ---------------- 22: publish ----------------
  const pPub = await newPost(ali, {
    title: `[TEST] Gym membership ${M}`,
    content: "Staff get a discounted gym membership at the fitness center.",
    status: "draft",
  });
  await sleep(500);
  const draftState = await statusRow("post", pPub.id);
  await ali.json(`/api/posts/${pPub.id}`, "PATCH", {
    title: pPub.title, content: pPub.content, scope: "company", status: "published",
  });
  const pubIndexed = await waitIndexed("post", pPub.id).catch(() => null);
  check(22, "Publish -> content becomes eligible and is indexed",
    draftState === null && pubIndexed !== null && (await sees(ahmed, "fitness gym discount", "post", pPub.id)));

  // ---------------- 24 + 25: edit Post (stale exclusion, then reindex) ----------------
  const pEdit = await newPost(ali, {
    title: `[TEST] Kitchen notes ${M}`,
    content: "Kitchen fridge is emptied every Friday afternoon.",
  });
  await waitIndexed("post", pEdit.id);
  const oldQ = "kitchen fridge friday";
  const newQ = "meeting rooms booked calendar";
  const editBefore = await sees(ali, oldQ, "post", pEdit.id);

  await stopWorker(); // nothing can re-index until we say so
  const edit = await ali.json(`/api/posts/${pEdit.id}`, "PATCH", {
    title: pEdit.title, content: "Meeting rooms can be booked through the calendar system.",
    scope: "company", status: "published",
  });
  const oldGone = !(await sees(ali, oldQ, "post", pEdit.id));
  const notYet = !(await sees(ali, newQ, "post", pEdit.id));
  const editDocs = await docs("post", pEdit.id);
  const editStatus = await statusRow("post", pEdit.id);
  check(24, "Edit indexed Post -> old embedding excluded immediately, before the re-index runs",
    editBefore && edit.status === 200 && oldGone && notYet && editDocs.length === 0 &&
      editStatus?.status === "pending" && editStatus?.source_version === 2,
    `worker stopped; vectors=${editDocs.length}, status=${editStatus?.status} v${editStatus?.source_version}`);

  await startWorker();
  await waitIndexed("post", pEdit.id, 2).catch(() => null);
  const afterDocs = await docs("post", pEdit.id);
  const afterStatus = await statusRow("post", pEdit.id);
  const newHits = await hits(ali, newQ, "post");
  // Nearest-neighbour search always returns the closest rows, so "old text is
  // not searchable" = no result anywhere still carries the old text.
  const oldTextServed = (await hits(ali, oldQ, "post")).some((r) => /fridge/i.test(r.snippet));
  check(25, "Re-index finishes -> the new text is semantically searchable (old text is not)",
    found(newHits, "post", pEdit.id) && newHits[0]?.id === pEdit.id && !oldTextServed &&
      afterDocs.length === 1 && afterDocs[0].source_version === 2,
    `status=${afterStatus?.status} v${afterStatus?.source_version}, vectors=${afterDocs.map((d) => `v${d.source_version}`).join(",")}, ` +
      `rank=${newHits.findIndex((r) => r.id === pEdit.id)}/${newHits.length}`);

  // ---------------- 26: edit Comment ----------------
  const cEdit = await newComment(ali, pLeave.id, "The coffee corner on floor two is out of order.");
  await waitIndexed("comment", cEdit.id);
  const cOldQ = "coffee corner floor";
  const cBefore = await sees(ali, cOldQ, "comment", cEdit.id);
  const cPatch = await ali.json(`/api/comments/${cEdit.id}`, "PATCH", { content: "Bicycle parking is behind building B." });
  const cOldGone = !(await sees(ali, cOldQ, "comment", cEdit.id));
  await waitIndexed("comment", cEdit.id, 2).catch(() => null);
  const cDocs = await docs("comment", cEdit.id);
  check(26, "Edit Comment -> stale vector disappears and the new one replaces it",
    cBefore && cPatch.status === 200 && cOldGone && (await sees(ali, "bicycle parking building", "comment", cEdit.id)) &&
      cDocs.length === 1 && cDocs[0].source_version === 2);

  // ---------------- 29 + 30: idempotency ----------------
  const seq = runIndexDirect("post", pLeave.id, 1, 2, "sequential");
  const seqDocs = await docs("post", pLeave.id);
  const jobKey = `post-${pLeave.id}-v1`;
  const prior = await testQueue.getJob(jobKey);
  if (prior && ["completed", "failed"].includes(await prior.getState())) await prior.remove();
  await testQueue.add("index-source", { sourceType: "post", sourceId: pLeave.id, sourceVersion: 1 }, { jobId: jobKey, attempts: 4 });
  await waitFor("re-run job done", async () => ["completed", "failed"].includes(await (await testQueue.getJob(jobKey))?.getState()));
  const rerunDocs = await docs("post", pLeave.id);
  check(29, "Retrying the same semantic Job -> no duplicates",
    seq.outcomes?.every((o) => o === "indexed") && seqDocs.length === 1 && rerunDocs.length === 1,
    `direct x2 + BullMQ re-run -> ${rerunDocs.length} vector(s)`);

  const chunkCount = Number((await db.query(
    `SELECT COUNT(*) FROM file_chunks fc JOIN files f ON f.id = fc.file_id AND fc.version = f.version WHERE f.id = $1`,
    [fVer.id]
  )).rows[0].count);
  const par = runIndexDirect("file", fVer.id, 2, 3, "parallel");
  const parPost = runIndexDirect("post", pLeave.id, 1, 3, "parallel");
  const parFileDocs = await docs("file", fVer.id);
  check(30, "Parallel duplicate semantic Jobs -> no duplicates",
    par.outcomes?.length === 3 && parPost.outcomes?.length === 3 &&
      parFileDocs.length === chunkCount && (await docs("post", pLeave.id)).length === 1,
    `file: ${parFileDocs.length} vectors for ${chunkCount} chunk(s); outcomes ${JSON.stringify(par.outcomes)}`);

  // ---------------- 31: delete ----------------
  const pDel = await newPost(ali, { title: `[TEST] Delete me ${M}`, content: "Shuttle bus timetable for the summer." });
  const cDel = await newComment(ahmed, pDel.id, "The shuttle leaves at eight.");
  const fDel = await upload(ali, pDel.id, `w8-delete-${M}.txt`, "Shuttle bus stops near the main gate.");
  const cDel2 = await newComment(ahmed, pLeave.id, "Annual company picnic is in June.");
  await Promise.all([
    waitIndexed("post", pDel.id), waitIndexed("comment", cDel.id), waitIndexed("file", fDel.id),
    waitIndexed("comment", cDel2.id),
  ]);
  const delPost = await ali.json(`/api/posts/${pDel.id}`, "DELETE");
  const delComment = await ahmed.json(`/api/comments/${cDel2.id}`, "DELETE");
  const leftover = Number((await db.query(
    `SELECT COUNT(*) FROM semantic_documents WHERE post_id = $1 OR comment_id = ANY($2::bigint[]) OR file_id = $3`,
    [pDel.id, [cDel.id, cDel2.id], fDel.id]
  )).rows[0].count);
  const leftoverStatus = Number((await db.query(
    `SELECT COUNT(*) FROM semantic_index_status
     WHERE post_id = $1 OR comment_id = ANY($2::bigint[]) OR file_id = $3`,
    [pDel.id, [cDel.id, cDel2.id], fDel.id]
  )).rows[0].count);
  check(31, "Delete source -> semantic rows removed (Post + its Comments/Files, single Comment)",
    delPost.status === 200 && delComment.status === 200 && leftover === 0 && leftoverStatus === 0 &&
      !(await sees(ali, "shuttle bus timetable", "post", pDel.id)));

  // ---------------- 32: transient provider failure -> retry ----------------
  const pFlaky = await newPost(ali, {
    title: `[TEST] Switch maintenance ${M}`,
    content: `Network switch maintenance window on Sunday night. [[test:fail-once:${M}flaky]]`,
  });
  const flakyRow = await waitIndexed("post", pFlaky.id, 1, 60000).catch(() => null);
  const flakyJob = await testQueue.getJob(`post-${pFlaky.id}-v1`);
  check(32, "Embedding provider transient failure -> automatic retry -> indexed",
    flakyRow !== null && flakyJob?.attemptsMade === 2 && (await sees(ali, "network switch maintenance", "post", pFlaky.id)),
    `attempts=${flakyJob?.attemptsMade}`);

  // ---------------- 33: permanent failure -> visible safe failure ----------------
  const pBad = await newPost(ali, {
    title: `[TEST] Broken vectors ${M}`,
    content: "Elevator inspection certificate renewal. [[test:wrong-dimensions]]",
  });
  const badRow = await waitSemanticStatus("post", pBad.id, "failed").catch(() => null);
  const badJob = await testQueue.getJob(`post-${pBad.id}-v1`);
  const fBad = await upload(ali, pLeave.id, `w8-badvec-${M}.txt`, "Lift maintenance log. [[test:wrong-dimensions]]");
  await waitSemanticStatus("file", fBad.id, "failed").catch(() => null);
  const badItem = ((await ali.json(`/api/posts/${pLeave.id}/files`)).data ?? []).find((f) => f.id === fBad.id);
  check(33, "Permanent provider/dimension failure -> safe visible 'failed' state, no retries, no vectors",
    badRow?.error === AR_INDEX_FAILED && badJob?.attemptsMade === 1 && (await docs("post", pBad.id)).length === 0 &&
      badItem?.status === "ready" && badItem?.semanticStatus === "failed" && badItem?.semanticError === AR_INDEX_FAILED &&
      !JSON.stringify(badItem).includes("dimension"),
    `post attempts=${badJob?.attemptsMade}, file processing=${badItem?.status} semantic=${badItem?.semanticStatus}`);

  // ---------------- 34: SQL as text ----------------
  const injection = await semantic(ali, "'; DROP TABLE semantic_documents; -- ' OR 1=1 --");
  const injection2 = await ali.json(`/api/search?${new URLSearchParams({ mode: "semantic", q: "x", type: "post' OR 1=1 --" })}`);
  const tableStill = (await db.query(`SELECT to_regclass('public.semantic_documents') AS t`)).rows[0].t;
  check(34, "Query text containing SQL syntax is treated as text",
    injection.status === 200 && Array.isArray(injection.data?.results) && injection2.status === 400 && tableStill !== null);

  // ---------------- 35: nothing sensitive in responses ----------------
  const bodies = [
    JSON.stringify(semVacation.data),
    JSON.stringify((await semantic(admin, "printing cartridge supplies")).data),
    JSON.stringify((await semantic(ali, "newcomer joiner orientation")).data),
    (await ali.html(`/search?${new URLSearchParams({ mode: "semantic", q: "vacation holiday allowance" })}`)).text,
  ].join("\n");
  const keys = (await db.query(`SELECT storage_key FROM files WHERE id = ANY($1::bigint[])`, [created.files])).rows
    .map((r) => r.storage_key);
  const secrets = [process.env.DATABASE_URL, process.env.AUTH_SECRET, process.env.OPENAI_API_KEY].filter(Boolean);
  check(35, "No vector values, storage keys or secrets in API / page responses",
    !/(-?\d\.\d{3,},){16,}/.test(bodies) && !bodies.includes('"embedding":[') &&
      !keys.some((k) => bodies.includes(k)) && !bodies.includes("storage/private") &&
      secrets.every((s) => !bodies.includes(s)) && bodies.includes("TEST ONLY embeddings are active"));

  // Worker log never contains secrets
  const log = worker?.lines.join("\n") ?? "";
  check("S1", "Worker log has no secrets",
    secrets.every((s) => !log.includes(s)) && log.includes("[semantic] job"));

  console.log("\n(36 = npm run test:week5, 37 = npm run test:week6, 38 = npm run test:week7, 39 = npm run test:e2e)");
}

// ---------------------------------------------------------------- cleanup
async function cleanup() {
  const admin = await new Browser().login("admin@nozom.local").catch(() => null);
  // API deletes also remove the private files from disk; Comments, Files,
  // Chunks and semantic rows cascade.
  for (const id of created.posts) {
    if (admin) await admin.json(`/api/posts/${id}`, "DELETE");
  }
  // Any other [TEST] post (e.g. from an interrupted run).
  const testPosts = await db.query(`SELECT id FROM posts WHERE title LIKE '[TEST]%'`);
  for (const row of testPosts.rows) {
    if (admin) await admin.json(`/api/posts/${row.id}`, "DELETE");
  }
  await db.query(`DELETE FROM posts WHERE title LIKE '[TEST]%'`);
  // Official Pages have no delete API: remove this run's rows directly.
  await db.query(`DELETE FROM pages WHERE id = ANY($1::bigint[]) OR title LIKE $2`, [created.pages, `[TEST]%${M}%`]);

  await stopWorker().catch((error) => console.error("stop worker:", error.message));

  // Remove ONLY this run's Jobs (by id). No FLUSHALL / FLUSHDB.
  const ids = { file: [], semantic: [] };
  for (const id of created.files) {
    for (let v = 1; v <= 5; v += 1) {
      ids.file.push(`file-${id}-v${v}`);
      ids.semantic.push(`file-${id}-v${v}`);
    }
  }
  for (const [kind, list] of [["post", created.posts], ["page", created.pages], ["comment", created.comments]]) {
    for (const id of list) for (let v = 1; v <= 5; v += 1) ids.semantic.push(`${kind}-${id}-v${v}`);
  }
  let removed = 0;
  for (const [queue, list] of [[fileQueue, ids.file], [testQueue, ids.semantic], [realQueue, ids.semantic]]) {
    for (const id of list) {
      const job = await queue.getJob(id);
      if (job) {
        await job.remove().catch(() => undefined);
        removed += 1;
      }
    }
  }
  const testRows = Number((await db.query(
    `SELECT COUNT(*) FROM semantic_documents WHERE embedding_model = $1`, [TEST_MODEL]
  )).rows[0].count);
  console.log(`cleanup: removed ${removed} test job(s); TEST ONLY vectors left in the database: ${testRows}`);
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
  await Promise.all([fileQueue.close(), testQueue.close(), realQueue.close()]);
  await redis.quit();
  await db.end();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. (BASE_URL=${BASE})`);
process.exitCode = failed.length || exitCode ? 1 : 0;
