import { NextResponse } from "next/server";
import type { ZodError, ZodType, z } from "zod";

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(message: string, status = 400, details?: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.error(`API ${status}: ${message}`, details);
  }
  return NextResponse.json({ success: false, error: { message } }, { status });
}

/**
 * The `{ success, error: { message } }` envelope carries a string, so a Zod
 * failure is reduced to its first issue rather than returning a nested flatten
 * object the client cannot render.
 */
export function firstZodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

type ParsedBody<S extends ZodType> =
  | { data: z.infer<S>; errorResponse: null }
  | { data: null; errorResponse: NextResponse };

/**
 * Parse and validate a JSON request body in one step. Malformed JSON and
 * schema failures both become enveloped 400s (first Zod issue as the
 * message), so handlers never throw a raw 500 on bad input and never need
 * `as`-cast bodies.
 */
export async function parseJsonBody<S extends ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedBody<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { data: null, errorResponse: apiError("Invalid JSON", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { data: null, errorResponse: apiError(firstZodMessage(parsed.error), 400) };
  }
  return { data: parsed.data, errorResponse: null };
}
