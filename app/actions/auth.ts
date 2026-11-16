"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";

const GENERIC_LOGIN_ERROR = "Invalid email or password.";

// Only allow redirects to paths inside this app (prevents open redirects).
function safeRedirectPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "";

  if (path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")) {
    return path;
  }

  return "/feed";
}

export async function authenticate(
  _previousState: string | undefined,
  formData: FormData
) {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return GENERIC_LOGIN_ERROR;
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: safeRedirectPath(formData.get("redirectTo")),
    });
  } catch (error) {
    // Wrong email and wrong password produce the SAME message.
    if (error instanceof AuthError) {
      return GENERIC_LOGIN_ERROR;
    }

    // signIn() redirects by throwing; let Next.js handle that.
    throw error;
  }

  return undefined;
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
