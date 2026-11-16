// Test helper (Week 8): runs indexSource() for one source version directly,
// N times — sequentially (retry) or in parallel (duplicate Jobs) — to prove
// semantic indexing is idempotent. Prints one JSON line.
//
//   tsx scripts/lib/run-index-source.ts <sourceType> <sourceId> <version> [times] [parallel]
import { loadWorkerEnv } from "../../worker/env";

loadWorkerEnv();

async function main() {
  const [sourceType, id, version, timesText = "1", mode = "sequential"] = process.argv.slice(2);
  const { Pool } = await import("pg");
  const { parseSemanticJobData } = await import("@/lib/semantic/config");
  const { createEmbeddingProvider } = await import("@/lib/semantic/provider");
  const { indexSource } = await import("@/lib/semantic/index-source");

  const job = parseSemanticJobData({
    sourceType,
    sourceId: Number(id),
    sourceVersion: Number(version),
  });
  const times = Math.max(1, Number(timesText));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: times + 2 });
  const provider = await createEmbeddingProvider();

  const outcomes: string[] = [];

  if (mode === "parallel") {
    const results = await Promise.all(
      Array.from({ length: times }, () => indexSource(pool, provider, job))
    );
    outcomes.push(...results.map((result) => result.outcome));
  } else {
    for (let i = 0; i < times; i += 1) {
      outcomes.push((await indexSource(pool, provider, job)).outcome);
    }
  }

  await pool.end();
  console.log(JSON.stringify({ outcomes, model: provider.modelId }));
}

main().catch((error) => {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
