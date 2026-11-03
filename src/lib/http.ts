import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { env } from "@/lib/env";
import { IntegrationUnavailable } from "@/lib/env";
import { pruneRateLimits } from "@/lib/ratelimit";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  unauthorized: (msg = "Connect your wallet to continue.") =>
    new ApiError(401, "unauthorized", msg),
  forbidden: (msg = "You do not have access to this resource.") =>
    new ApiError(403, "forbidden", msg),
  notFound: (msg = "Not found.") => new ApiError(404, "not_found", msg),
  badRequest: (msg = "Invalid request.", details?: unknown) =>
    new ApiError(400, "bad_request", msg, details),
  conflict: (msg = "That action was already completed.") =>
    new ApiError(409, "conflict", msg),
  tooMany: (retryAfterSec: number, msg = "Too many requests. Please slow down.") =>
    new ApiError(429, "rate_limited", msg, { retryAfterSec }),
  server: (msg = "Something went wrong on our side.") =>
    new ApiError(500, "server_error", msg),
};

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export function getClientIp(req: Request): string {
  if (!env.trustProxy) return "direct";
  const h = req.headers;
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? h.get("cf-connecting-ip") ?? "unknown";
}

export function getUserAgent(req: Request): string {
  return req.headers.get("user-agent")?.slice(0, 300) ?? "unknown";
}

export async function parseJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw errors.badRequest("Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "validation_failed", "Some fields need attention.", flattenZod(parsed.error));
  }
  return parsed.data as z.infer<S>;
}

export function flattenZod(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Wraps a route handler with consistent error serialisation. */
export function route<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<Response>,
) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      const res = await handler(req, ...args);
      void pruneRateLimits();
      return res;
    } catch (err) {
      if (err instanceof ApiError) {
        return json(
          { error: { code: err.code, message: err.message, details: err.details ?? null } },
          err.status,
        );
      }
      if (err instanceof IntegrationUnavailable) {
        return json(
          { error: { code: "integration_unavailable", message: err.message, details: null } },
          503,
        );
      }
      if (err instanceof ZodError) {
        return json(
          { error: { code: "validation_failed", message: "Invalid input.", details: flattenZod(err) } },
          400,
        );
      }
      console.error("[api] unhandled error:", err);
      return json(
        { error: { code: "server_error", message: "Something went wrong on our side.", details: null } },
        500,
      );
    }
  };
}
