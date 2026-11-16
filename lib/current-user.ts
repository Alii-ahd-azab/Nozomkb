// Data Access Layer for the authenticated user.
//
// The Auth.js session cookie only proves WHO the user is (user id).
// Role and department are re-loaded from PostgreSQL on every request, so a
// role change or a removed account takes effect immediately instead of
// waiting for the session to expire. The browser is never trusted for role.
import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { isRole, type CurrentUser } from "@/lib/definitions";

// cache(): at most one database lookup per request/render pass.
export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => {
    const session = await auth();
    const userId = Number(session?.user?.id);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return null;
    }

    const result = await pool.query(
      `
        SELECT
          users.id,
          users.name,
          users.email,
          users.role,
          users.department_id,
          departments.name AS department_name
        FROM users
        LEFT JOIN departments
          ON departments.id = users.department_id
        WHERE users.id = $1
      `,
      [userId]
    );

    const row = result.rows[0];

    // Deleted user, or an unexpected role value -> treat as signed out.
    if (!row || !isRole(row.role)) {
      return null;
    }

    return {
      id: Number(row.id),
      name: row.name,
      email: row.email,
      role: row.role,
      departmentId:
        row.department_id === null ? null : Number(row.department_id),
      departmentName: row.department_name,
    };
  }
);

// For Server Components: unauthenticated visitors are sent to /login.
export async function requireUser(returnTo: string) {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
  }

  return user;
}
