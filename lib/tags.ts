import "server-only";

import pool from "@/lib/db";

// Reuses the existing tags / post_tags tables (Week 3).
export async function getTagNames() {
  const result = await pool.query<{ name: string }>(
    `SELECT name FROM tags ORDER BY name`
  );

  return result.rows.map((row) => row.name);
}
