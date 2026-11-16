// Week 8 — Keyword vs Semantic retrieval evaluation on 10 questions, with the
// REAL embedding provider (never the TEST ONLY one).
//
// Usage:
//   Redis on 127.0.0.1:6379 (or REDIS_URL)
//   npm run build && npm run start -- -p 3100        (normal / real provider)
//   (do NOT run `npm run worker` meanwhile: this script controls the Worker)
//   BASE_URL=http://localhost:3100 npm run eval:week8
//
// 1. creates the [EVAL] fixtures of tests/fixtures/week8-retrieval-questions.json
//    through the real API (Pages, Posts, a Comment, a PDF File)
// 2. waits until the real Worker has processed the File and embedded every
//    source with the real model
// 3. runs every question in Keyword mode and in Semantic mode as the asking user
// 4. records the Top 5 of both, whether an expected source is in it, and writes
//    docs/week8-retrieval-evaluation.md (+ .json with the raw output)
// 5. deletes the fixtures and ONLY its own Jobs (never FLUSHALL / FLUSHDB)
//
// Results that are not evaluation fixtures (your own existing content) are
// listed only as "other <type> #id" — their titles/text are not copied.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { Browser } from "./lib/test-browser.mjs";
import { buildPdf } from "./lib/pdf-fixtures.mjs";

const ROOT = process.cwd();
if (!process.env.DATABASE_URL && existsSync(path.join(ROOT, ".env.local"))) {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
}
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const QUEUE_PREFIX = "nozomkb";
const FILE_QUEUE = "nozom-file-processing";
const SEMANTIC_QUEUE = "nozom-semantic-indexing";
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const TOP = 5;
const SPEC = JSON.parse(readFileSync(path.join(ROOT, "tests", "fixtures", "week8-retrieval-questions.json"), "utf8"));

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const fileQueue = new Queue(FILE_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });
const semanticQueue = new Queue(SEMANTIC_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(label, fn, timeoutMs = 180000, intervalMs = 300) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await sleep(intervalMs);
  }
}

// fixture key -> { type, id, title }
const sources = new Map();
const created = { posts: [], pages: [], files: [], comments: [] };

let worker = null;
async function startWorker() {
  const lines = [];
  const env = { ...process.env };
  delete env.EMBEDDING_PROVIDER; // always the configured REAL provider (default: local)
  delete env.NOZOMKB_TEST_EMBEDDINGS;
  const child = spawn(process.execPath, [TSX_CLI, "worker/index.ts"], {
    cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
  child.stderr.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
  worker = { child, lines };
  await waitFor("worker ready", () => lines.some((l) => l.includes("[semantic] listening on")), 60000);
}
async function stopWorker() {
  if (!worker) return;
  await waitFor("queues idle", async () =>
    (await fileQueue.getActiveCount()) === 0 && (await semanticQueue.getActiveCount()) === 0, 120000);
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(worker.child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    worker.child.kill("SIGTERM");
  }
  await waitFor("worker exit", () => worker.child.exitCode !== null || worker.child.signalCode !== null, 15000);
  worker = null;
}

async function statusReady(kind, id) {
  const r = await db.query(
    `SELECT status FROM semantic_index_status WHERE source_kind = $1 AND source_id = $2`,
    [kind, id]
  );
  return r.rows[0]?.status === "ready";
}

function keyOf(result) {
  for (const [key, source] of sources) {
    if (source.type === "file" ? result.type === "file" && result.file?.id === source.id
      : result.type === source.type && result.id === source.id) return key;
  }
  return null;
}

function describe(result, rank, expected, withSimilarity) {
  const key = keyOf(result);
  const mark = key && expected.includes(key) ? " ✅" : "";
  const sim = withSimilarity ? ` · sim ${result.similarity.toFixed(3)}` : "";
  const page = result.file?.pageNumber ? ` · PDF page ${result.file.pageNumber}` : "";
  if (!key) return `${rank}. other ${result.type} #${result.id}${sim}`;
  return `${rank}. **${key}** (${result.type} #${result.type === "file" ? result.file.id : result.id}${page})${sim} → \`${result.url ?? (result.parentKind === "page" ? "/official/" : "/posts/") + result.parentId}\`${mark}`;
}

async function main() {
  if ((await fileQueue.getWorkers()).length > 0 || (await semanticQueue.getWorkers()).length > 0) {
    throw new Error("Another NozomKB Worker is running. Stop `npm run worker` first: this script controls the Worker.");
  }

  const users = {
    admin: await new Browser().login("admin@nozom.local"),
    ali: await new Browser().login("ali@nozom.local"),
    ahmed: await new Browser().login("ahmed@nozom.local"),
  };

  const probe = await users.ali.json(`/api/search?${new URLSearchParams({ mode: "semantic", q: "probe" })}`);
  const embedding = probe.data?.embedding;
  if (probe.status !== 200 || !embedding || embedding.testOnly) {
    throw new Error("REAL RETRIEVAL EVALUATION: BLOCKED — the app is not running with a real embedding provider.");
  }
  console.log(`Real embedding provider: ${embedding.provider} / ${embedding.model} (${embedding.dimensions} dims)`);

  await startWorker();

  // ---------------- fixtures (through the real API) ----------------
  const F = SPEC.fixtures;
  for (const page of F.pages) {
    const r = await users.admin.json("/api/pages", "POST", {
      title: `[EVAL] ${page.title}`, content: page.content, status: "published",
      scope: page.scope ?? "company", departmentId: page.departmentId,
    });
    if (r.status !== 201) throw new Error(`page ${page.key}: ${r.status}`);
    created.pages.push(r.data.id);
    sources.set(page.key, { type: "page", id: r.data.id, kind: "page" });
  }
  for (const post of F.posts) {
    const r = await users.ali.json("/api/posts", "POST", {
      title: `[EVAL] ${post.title}`, content: post.content, status: "published", scope: "company", tag: "IT",
    });
    if (r.status !== 201) throw new Error(`post ${post.key}: ${r.status}`);
    created.posts.push(r.data.id);
    sources.set(post.key, { type: "post", id: r.data.id, kind: "post" });
  }
  for (const comment of F.comments) {
    const parent = sources.get(comment.parent);
    const r = await users[comment.author].json(
      `/api/${parent.type === "page" ? "pages" : "posts"}/${parent.id}/comments`, "POST", { content: comment.content }
    );
    if (r.status !== 201) throw new Error(`comment ${comment.key}: ${r.status}`);
    created.comments.push(r.data.id);
    sources.set(comment.key, { type: "comment", id: r.data.id, kind: "comment" });
  }
  for (const file of F.files) {
    const parent = sources.get(file.parent);
    const r = await users.ali.upload(`/api/posts/${parent.id}/files`, {
      name: file.name, type: "application/pdf", bytes: buildPdf(file.pdfPages),
    });
    if (r.status !== 201) throw new Error(`file ${file.key}: ${r.status}`);
    created.files.push(r.data.id);
    sources.set(file.key, { type: "file", id: r.data.id, kind: "file" });
  }

  console.log(`Created ${sources.size} fixture sources; waiting for the real Worker to index them...`);
  const started = Date.now();
  await waitFor("all fixtures indexed", async () => {
    for (const source of sources.values()) {
      if (!(await statusReady(source.kind, source.id))) return false;
    }
    return true;
  });
  const indexSeconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Indexed in ${indexSeconds}s.\n`);

  // ---------------- questions ----------------
  const rows = [];
  for (const q of SPEC.questions) {
    const browser = users[q.user];
    const kw = await browser.json(`/api/search?${new URLSearchParams({ mode: "keyword", q: q.keyword })}`);
    const sem = await browser.json(`/api/search?${new URLSearchParams({ mode: "semantic", q: q.question })}`);
    const kwTop = (kw.data?.results ?? []).slice(0, TOP);
    const semTop = (sem.data?.results ?? []).slice(0, TOP);
    const rankOf = (list) => {
      const i = list.findIndex((r) => q.expected.includes(keyOf(r)));
      return i === -1 ? null : i + 1;
    };

    let kwOk;
    let semOk;
    if (q.expected.length === 0) {
      // no relevant source exists: correct behaviour = nothing presented
      kwOk = kwTop.length === 0;
      semOk = semTop.length === 0;
    } else {
      kwOk = rankOf(kwTop) !== null;
      semOk = rankOf(semTop) !== null;
    }

    let mustNot = null;
    if (q.mustNotSee) {
      const other = await users[q.mustNotSee.user].json(`/api/search?${new URLSearchParams({ mode: "semantic", q: q.question })}`);
      const leaked = (other.data?.results ?? []).some((r) => q.mustNotSee.sources.includes(keyOf(r)));
      mustNot = { user: q.mustNotSee.user, leaked, total: other.data?.results?.length ?? 0 };
    }

    rows.push({
      ...q,
      keywordTotal: kw.data?.total ?? 0,
      keywordTop: kwTop.map((r) => ({ key: keyOf(r), type: r.type, id: r.type === "file" ? r.file?.id : r.id, parentId: r.parentId, parentKind: r.parentKind })),
      semanticTop: semTop.map((r) => ({ key: keyOf(r), type: r.type, id: r.type === "file" ? r.file?.id : r.id, similarity: r.similarity, url: r.url, pageNumber: r.file?.pageNumber ?? null })),
      keywordRank: rankOf(kwTop),
      semanticRank: rankOf(semTop),
      keywordOk: kwOk,
      semanticOk: semOk,
      mustNot,
      keywordLines: kwTop.map((r, i) => describe(r, i + 1, q.expected, false)),
      semanticLines: semTop.map((r, i) => describe(r, i + 1, q.expected, true)),
    });

    console.log(`Q${q.n} ${q.case}: keyword ${kwOk ? "YES" : "NO"} | semantic ${semOk ? "YES" : "NO"}` +
      (mustNot ? ` | ${mustNot.user} sees restricted: ${mustNot.leaked}` : ""));
  }

  const kwScore = rows.filter((r) => r.keywordOk).length;
  const semScore = rows.filter((r) => r.semanticOk).length;
  console.log(`\nKeyword Top-${TOP} success: ${kwScore}/10\nSemantic Top-${TOP} success: ${semScore}/10`);

  writeReport({ embedding, rows, kwScore, semScore, indexSeconds });
}

function writeReport({ embedding, rows, kwScore, semScore, indexSeconds }) {
  const runAt = new Date().toISOString();
  const yesNo = (v) => (v ? "YES" : "NO");
  const lines = [];
  lines.push("# Week 8 — Keyword vs Semantic retrieval evaluation");
  lines.push("");
  lines.push("Generated by `npm run eval:week8` (scripts/week8-evaluation.mjs). Do not edit by hand: re-run the script.");
  lines.push("");
  lines.push(`- Run at: ${runAt}`);
  lines.push(`- Embedding provider: **REAL** — \`${embedding.provider}\` / \`${embedding.model}\`, ${embedding.dimensions} dimensions (local, no API key)`);
  lines.push("- Similarity: cosine (pgvector `<=>`), exact scan, permission + lifecycle filters in the same SQL query");
  lines.push(`- Fixtures: \`tests/fixtures/week8-retrieval-questions.json\` — created as \`[EVAL]\` content through the real API, indexed by the real Worker (${indexSeconds}s), deleted afterwards`);
  lines.push("- Keyword mode gets what a user would type as keywords; Semantic mode gets the natural question");
  lines.push(`- Metric: is an expected source in the Top ${TOP}? (Question 10 has no relevant source: success = nothing returned)`);
  lines.push("- Other existing content in the database also takes part; it is listed only as `other <type> #id`");
  lines.push("");
  lines.push("## Result");
  lines.push("");
  lines.push(`| | Top-${TOP} success |`);
  lines.push("|---|---|");
  lines.push(`| Keyword Search | **${kwScore}/10** |`);
  lines.push(`| Semantic Search | **${semScore}/10** |`);
  lines.push("");
  lines.push(`| # | Case | User | Keyword query | Semantic question | Expected | Keyword | Semantic |`);
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const kw = `${yesNo(r.keywordOk)}${r.keywordRank ? ` (#${r.keywordRank})` : ""}`;
    const sem = `${yesNo(r.semanticOk)}${r.semanticRank ? ` (#${r.semanticRank})` : ""}`;
    lines.push(`| ${r.n} | ${r.case} | ${r.user} | \`${r.keyword}\` | ${r.question} | ${r.expected.join(", ") || "none"} | ${kw} | ${sem} |`);
  }
  lines.push("");
  lines.push("## Details (actual Top 5)");
  for (const r of rows) {
    lines.push("");
    lines.push(`### ${r.n}. ${r.case}`);
    lines.push("");
    lines.push(`- Asked by: ${r.user} · Expected: ${r.expected.join(", ") || "no relevant source"}`);
    lines.push(`- Keyword \`${r.keyword}\` → ${r.keywordTotal} result(s), relevant in Top ${TOP}: **${yesNo(r.keywordOk)}**`);
    for (const line of r.keywordLines) lines.push(`  ${line}`);
    lines.push(`- Semantic “${r.question}” → relevant in Top ${TOP}: **${yesNo(r.semanticOk)}**`);
    for (const line of r.semanticLines) lines.push(`  ${line}`);
    if (r.mustNot) {
      lines.push(`- Permission check: the same question asked by **${r.mustNot.user}** (other department) returned ${r.mustNot.total} result(s); restricted source present: **${r.mustNot.leaked ? "YES (LEAK)" : "NO"}**`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Fixture ids / links are the ones created during this run (the fixtures are deleted afterwards).");
  lines.push("- Semantic Search always returns the nearest neighbours: there is no similarity cut-off, so a question without any relevant source still gets (low-similarity) results — see question 10.");
  lines.push("- Similarity values are from the local e5 model; they are only comparable within one model.");
  lines.push("");

  mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  writeFileSync(path.join(ROOT, "docs", "week8-retrieval-evaluation.md"), lines.join("\n"), "utf8");
  writeFileSync(
    path.join(ROOT, "docs", "week8-retrieval-evaluation.json"),
    JSON.stringify({ runAt, embedding, top: TOP, keywordScore: kwScore, semanticScore: semScore, questions: rows.map((row) => {
      const rest = { ...row };
      delete rest.keywordLines;
      delete rest.semanticLines;
      return rest;
    }) }, null, 2) + "\n",
    "utf8"
  );
  console.log("Wrote docs/week8-retrieval-evaluation.md and .json");
}

async function cleanup() {
  const admin = await new Browser().login("admin@nozom.local").catch(() => null);
  for (const id of created.posts) if (admin) await admin.json(`/api/posts/${id}`, "DELETE");
  const evalPosts = await db.query(`SELECT id FROM posts WHERE title LIKE '[EVAL]%'`);
  for (const row of evalPosts.rows) if (admin) await admin.json(`/api/posts/${row.id}`, "DELETE");
  await db.query(`DELETE FROM pages WHERE id = ANY($1::bigint[]) OR title LIKE '[EVAL]%'`, [created.pages]);

  await stopWorker().catch((error) => console.error("stop worker:", error.message));

  let removed = 0;
  const semanticIds = [];
  for (const [kind, list] of [["post", created.posts], ["page", created.pages], ["comment", created.comments], ["file", created.files]]) {
    for (const id of list) for (let v = 1; v <= 3; v += 1) semanticIds.push(`${kind}-${id}-v${v}`);
  }
  for (const [queue, ids] of [
    [fileQueue, created.files.flatMap((id) => [1, 2, 3].map((v) => `file-${id}-v${v}`))],
    [semanticQueue, semanticIds],
  ]) {
    for (const id of ids) {
      const job = await queue.getJob(id);
      if (job) { await job.remove().catch(() => undefined); removed += 1; }
    }
  }
  console.log(`cleanup: fixtures deleted, ${removed} evaluation job(s) removed`);
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (worker) console.error("--- worker log ---\n" + worker.lines.slice(-20).join("\n"));
  exitCode = 1;
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
  await Promise.all([fileQueue.close(), semanticQueue.close()]);
  await redis.quit();
  await db.end();
}
process.exitCode = exitCode;
