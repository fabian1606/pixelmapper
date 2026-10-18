// ── HTTP helpers shared by the sync edge functions (ADR 0004) ───────────────
//
// Files in `_shared/` are not deployed as functions; the Supabase CLI bundles
// them into every function that imports them.

/** CORS headers for browser callers (supabase.functions.invoke). */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** JSON response with CORS headers. Errors use the body shape `{ error }`. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** `{ error: message }` response. */
export function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

/**
 * Handles the CORS preflight and rejects non-POST methods.
 * Returns a response to send back, or `null` when the request may proceed.
 */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method Not Allowed', 405);
  return null;
}

/** Parses the JSON body as an object; `null` when it is missing or invalid. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
