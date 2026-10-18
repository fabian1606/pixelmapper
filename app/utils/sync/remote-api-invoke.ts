import { isNetworkError, reportNetworkFailure, reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { RemoteError, RemoteErrorKind, RemoteResult } from '~/utils/sync/remote-api-types';

/**
 * Low-level edge-function invocation with error classification.
 *
 * Every outcome is reported to the connectivity module (ADR 0004 §3.4): any
 * HTTP response counts as "backend reachable", a fetch failure as offline.
 */

// ── Client seam ──────────────────────────────────────────────────────────────

/**
 * The part of `SupabaseClient` the wrapper needs. Structural, so tests can
 * pass a plain mock and `useSupabaseClient()` fits as is.
 */
export interface RemoteClient {
  functions: {
    invoke(
      functionName: string,
      options?: { body?: Record<string, unknown> },
    ): Promise<{ data: unknown; error: unknown }>;
  };
}

// ── Invocation ───────────────────────────────────────────────────────────────

/**
 * Calls `functionName` with a JSON body and validates the response with `parse`.
 * `parse` returns `null` for an unexpected body (→ `invalid-response`).
 */
export async function invokeRemote<T>(
  client: RemoteClient,
  functionName: string,
  body: Record<string, unknown>,
  parse: (data: unknown) => T | null,
): Promise<RemoteResult<T>> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.functions.invoke(functionName, { body }));
  } catch (err) {
    error = err;
  }

  if (error) {
    const classified = await classifyError(error);
    if (classified.kind === 'network') reportNetworkFailure();
    else if (classified.status !== null) reportNetworkSuccess();
    return { ok: false, error: classified };
  }

  reportNetworkSuccess();
  const parsed = parse(data);
  if (parsed === null) {
    return {
      ok: false,
      error: { kind: 'invalid-response', status: 200, message: `unexpected response from ${functionName}`, retryable: false, cause: data },
    };
  }
  return { ok: true, data: parsed };
}

// ── Error classification ─────────────────────────────────────────────────────

/**
 * Maps a supabase-js invoke error to a `RemoteError`.
 * `FunctionsHttpError`/`FunctionsRelayError` carry the `Response` in `context`;
 * `FunctionsFetchError` (and a raw `TypeError`) mean the request never got a response.
 */
export async function classifyError(error: unknown): Promise<RemoteError> {
  const response = responseOf(error);
  if (response) {
    const status = response.status;
    const kind = kindForStatus(status);
    return {
      kind,
      status,
      message: (await readErrorMessage(response)) ?? messageOf(error),
      retryable: kind === 'server',
      cause: error,
    };
  }
  if (isNetworkError(error)) {
    return { kind: 'network', status: null, message: messageOf(error), retryable: true, cause: error };
  }
  return { kind: 'unknown', status: null, message: messageOf(error), retryable: false, cause: error };
}

/** HTTP status → error kind. */
function kindForStatus(status: number): RemoteErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'bad-request';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** The `Response` attached to an invoke error, if any. */
function responseOf(error: unknown): Response | null {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof ctx === 'object' && typeof (ctx as { status?: unknown }).status === 'number') {
    return ctx as Response;
  }
  return null;
}

/** Reads `{ error }` (or plain text) from an error response without throwing. */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const source = typeof response.clone === 'function' ? response.clone() : response;
    const text = await source.text();
    if (!text) return null;
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown };
      const msg = body?.error ?? body?.message;
      if (typeof msg === 'string') return msg;
    } catch { /* plain-text body */ }
    return text;
  } catch {
    return null;
  }
}

/** Best-effort message of an unknown error. */
function messageOf(error: unknown): string {
  const msg = (error as { message?: unknown } | null)?.message;
  return typeof msg === 'string' ? msg : String(error);
}
