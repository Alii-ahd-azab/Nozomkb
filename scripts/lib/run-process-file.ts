// Test helper: runs the Worker's processFile() directly (no BullMQ), N times.
//   npx tsx scripts/lib/run-process-file.ts <fileId> <version> [times]
// Prints one JSON line with the outcomes and the resulting Chunk counts.
import { loadWorkerEnv } from "../../worker/env";

loadWorkerEnv();

async function main() {
  const [fileId, version, times = 1] = process.argv.slice(2).map(Number);
  const { Pool } = await import("pg");
  const { processFile } = await import("@/lib/processing/process-file");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  try {
    const outcomes: string[] = [];
    const counts: number[] = [];

    for (let run = 0; run < times; run += 1) {
      outcomes.push((await processFile(pool, { fileId, version })).outcome);
      const result = await pool.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM file_chunks WHERE file_id = $1 AND version = $2",
        [fileId, version]
      );
      counts.push(Number(result.rows[0].count));
    }

    console.log(JSON.stringify({ outcomes, counts }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
