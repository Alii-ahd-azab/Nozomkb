"use client";

import { useActionState } from "react";
import { authenticate } from "@/app/actions/auth";

type LoginFormProps = {
  redirectTo: string;
  // Generic message only; never says whether the email exists.
  initialError?: string;
};

export default function LoginForm({
  redirectTo,
  initialError,
}: LoginFormProps) {
  const [errorMessage, formAction, isPending] = useActionState(
    authenticate,
    initialError
  );

  return (
    <form action={formAction} className="post-form login-form">
      {errorMessage && (
        <p className="form-error" role="alert">
          {errorMessage}
        </p>
      )}

      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />

      <input type="hidden" name="redirectTo" value={redirectTo} />

      <button type="submit" className="btn btn-primary btn-block" disabled={isPending}>
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
