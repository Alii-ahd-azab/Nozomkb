import "server-only";

import pool from "@/lib/db";
import type { Department } from "@/lib/definitions";

export async function getDepartments(): Promise<Department[]> {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM departments ORDER BY name`
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
  }));
}
