// REST client for the backend contract (../../../../backendspec.md v3). Every response is validated against its
// zod schema (see validateContract); errors in the `{ error: { code, message } }` shape become ApiError.
import type { z } from "zod";
import { ENV } from "@/config/env";
import { ErrorBody } from "./schemas";
import { validateContract } from "./contractIssues";
import { mocksReady } from "./mockGate";

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  signal?: AbortSignal;
}

export class ApiError extends Error {
  /** HTTP status, or 0 when the server couldn't be reached. */
  readonly status: number;
  /** The backend's error code (HTTP_ERROR, NOT_FOUND, VALIDATION_ERROR, ...), or NETWORK / INVALID_RESPONSE / HTTP_<status>. */
  readonly code: string;

  constructor(init: { status: number; code: string; message: string }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  params?: QueryParams,
  options?: RequestOptions,
): Promise<T> {
  return request("GET", path, undefined, schema, params, options);
}

export async function apiSend<T>(
  method: "POST",
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  options?: RequestOptions,
): Promise<T> {
  return request(method, path, body, schema, undefined, options);
}

function buildUrl(path: string, params?: QueryParams): string {
  const base = ENV.apiBaseUrl.replace(/\/+$/, "");
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const qs = search.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  params: QueryParams | undefined,
  options: RequestOptions | undefined,
): Promise<T> {
  await mocksReady();
  const label = `${method} ${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    });
  } catch (err) {
    if (options?.signal?.aborted) throw err;
    throw new ApiError({ status: 0, code: "NETWORK", message: "Couldn't reach the server." });
  }

  const json = await readJson(res);
  if (!res.ok) throw toApiError(res, json, label);
  if (json === undefined) {
    throw new ApiError({
      status: res.status,
      code: "INVALID_RESPONSE",
      message: `${label} returned an empty or non-JSON response.`,
    });
  }
  return validateContract(label, schema, json);
}

async function readJson(res: Response): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toApiError(res: Response, json: unknown, label: string): ApiError {
  const parsed = ErrorBody.safeParse(json);
  if (parsed.success) {
    const { error } = parsed.data;
    return new ApiError({ status: res.status, code: error.code, message: error.message });
  }

  // Not the documented error shape. Keep whatever code we can read so the UI still reacts.
  const error = isRecord(json) && isRecord(json.error) ? json.error : null;
  if (error && typeof error.code === "string") {
    validateContract(`${label} (error body)`, ErrorBody, json);
    const message = typeof error.message === "string" ? error.message : `Request failed (${res.status}).`;
    return new ApiError({ status: res.status, code: error.code, message });
  }
  return new ApiError({
    status: res.status,
    code: `HTTP_${res.status}`,
    message: res.statusText ? `${res.status} ${res.statusText}` : `Request failed (${res.status}).`,
  });
}

// ---------- approve / reject conflicts ----------

/**
 * UI copy for a 409 on approve/reject (spec §9.3). The backend sends `HTTP_ERROR` with a plain-English
 * message and no trip, so known messages map to the spec's wording (DECISIONS.md "2a answers"); anything
 * else, such as a replanning failure ("arrival is 120 seconds after proactive target"), is shown as sent.
 */
export function tripConflictMessage(err: ApiError): string {
  const m = err.message.toLowerCase();
  if (m.includes("expired")) return "This proposal expired before approval.";
  if (m.includes("not proposed")) return "This trip changed state. Showing latest.";
  if (m.includes("reservation is inconsistent") || m.includes("candidate is missing")) {
    return "The simulation moved. Refreshing…";
  }
  return err.message.charAt(0).toUpperCase() + err.message.slice(1).replace(/\.?$/, ".");
}
