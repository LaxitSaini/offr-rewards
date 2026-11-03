"use client";

export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: Record<string, string> | null;
  constructor(status: number, code: string, message: string, details?: Record<string, string> | null) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details ?? null;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  csrf?: string | null;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.csrf) headers["x-offr-csrf"] = options.csrf;

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: options.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiClientError(0, "network_error", (err as Error).message || "Network request failed.");
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: Record<string, string> } })?.error;
    throw new ApiClientError(
      res.status,
      error?.code ?? "request_failed",
      error?.message ?? `Request failed (${res.status}).`,
      error?.details ?? null,
    );
  }
  return payload as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
