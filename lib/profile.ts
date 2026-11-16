import "server-only";

import pool from "@/lib/db";
import type { CurrentUser, Profile } from "@/lib/definitions";

export async function getProfile(user: CurrentUser): Promise<Profile> {
  const result = await pool.query<{ specialty: string | null }>(
    `SELECT specialty FROM users WHERE id = $1`,
    [user.id]
  );

  return {
    name: user.name,
    email: user.email,
    role: user.role,
    departmentName: user.departmentName,
    specialty: result.rows[0]?.specialty ?? null,
  };
}

// The ONLY profile field an employee can change. Role and department are
// admin-controlled because they drive authorization.
export async function updateSpecialty(userId: number, specialty: string | null) {
  await pool.query(`UPDATE users SET specialty = $1 WHERE id = $2`, [
    specialty,
    userId,
  ]);
}
