import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { isRole } from "@/lib/definitions";

// Compared against when the email does not exist, so a wrong email and a
// wrong password take about the same time (no account enumeration by timing).
const DUMMY_PASSWORD_HASH =
  "$2b$10$f9OZA4gZZAMwwVJuuBNtl.8HjkoK9FIA3sqhHsv1ed0g5s.DdyD4K";

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // one working day

export const { handlers, auth, signIn, signOut } = NextAuth({
  // AUTH_SECRET is read from the server environment automatically.
  session: {
    // Signed + encrypted, httpOnly cookie managed by Auth.js (no localStorage).
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  pages: {
    signIn: "/login",
  },

  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");

        if (!email || !password || email.length > 254 || password.length > 200) {
          return null;
        }

        const result = await pool.query(
          `
            SELECT
              id,
              name,
              email,
              password_hash,
              role,
              department_id
            FROM users
            WHERE LOWER(email) = $1
          `,
          [email]
        );

        const user = result.rows[0];

        const passwordMatches = await bcrypt.compare(
          password,
          user?.password_hash ?? DUMMY_PASSWORD_HASH
        );

        // Same "null" result for unknown email, missing hash, or wrong
        // password -> the login page shows one generic message.
        if (!user || !user.password_hash || !passwordMatches || !isRole(user.role)) {
          return null;
        }

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
          departmentId:
            user.department_id === null ? null : Number(user.department_id),
        };
      },
    }),
  ],

  callbacks: {
    // Runs when the session token is created/refreshed (server-side only).
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.departmentId = user.departmentId ?? null;
      }

      return token;
    },

    // What auth() returns on the server.
    session({ session, token }) {
      if (token.id && token.role) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.departmentId = token.departmentId ?? null;
      }

      return session;
    },
  },
});
