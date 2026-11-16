import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/definitions";

declare module "next-auth" {
  interface User {
    role?: Role;
    departmentId?: number | null;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      departmentId: number | null;
    } & DefaultSession["user"];
  }
}

// next-auth/jwt re-exports this module, so the JWT interface is extended here.
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    departmentId?: number | null;
  }
}
