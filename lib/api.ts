// Small helpers shared by the Route Handlers.
import "server-only";

import {
  isContentScope,
  isContentStatus,
  type ContentScope,
  type ContentStatus,
} from "@/lib/definitions";

export const TITLE_MAX_LENGTH = 200;
export const CONTENT_MAX_LENGTH = 20000;

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const unauthorized = () =>
  jsonError("You must be signed in.", 401);

export const forbidden = () =>
  jsonError("You do not have permission to do this.", 403);

// Also used when content exists but must not be revealed to this user.
export const notFound = (what = "Content") =>
  jsonError(`${what} not found.`, 404);

// Never send database errors to the browser; log them on the server only.
export function serverError(error: unknown) {
  console.error(error);
  return jsonError("Something went wrong. Please try again.", 500);
}

export function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const id = Number(raw);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();

    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }

    return null;
  } catch {
    return null;
  }
}

export function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function validateTitleAndContent(
  body: Record<string, unknown>
): ValidationResult<{ title: string; content: string }> {
  const title = readText(body.title);
  const content = readText(body.content);

  if (!title || !content) {
    return { ok: false, error: "Title and content are required." };
  }

  if (title.length > TITLE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Title must be at most ${TITLE_MAX_LENGTH} characters.`,
    };
  }

  if (content.length > CONTENT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Content must be at most ${CONTENT_MAX_LENGTH} characters.`,
    };
  }

  return { ok: true, value: { title, content } };
}

export function validateScope(
  value: unknown,
  fallback: ContentScope
): ValidationResult<ContentScope> {
  if (value === undefined) {
    return { ok: true, value: fallback };
  }

  return isContentScope(value)
    ? { ok: true, value }
    : { ok: false, error: "Scope must be 'company' or 'department'." };
}

export function validateStatus(
  value: unknown,
  fallback: ContentStatus,
  allowed: readonly ContentStatus[]
): ValidationResult<ContentStatus> {
  if (value === undefined) {
    return { ok: true, value: fallback };
  }

  return isContentStatus(value) && allowed.includes(value)
    ? { ok: true, value }
    : {
        ok: false,
        error: `Status must be one of: ${allowed.join(", ")}.`,
      };
}

// Postgres foreign-key / check violations caused by bad input -> 400.
export function isBadInputDatabaseError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;

  return code === "23503" || code === "23514";
}
