/**
 * Copy of `@nuxtjs/supabase`'s `fetchWithRetry` (dist/runtime/utils/fetch-retry.js,
 * v2.0.6), which the package does not export. Used by the desktop replacement
 * of the module's client plugin (`app/runtime/supabase-spa.client.ts`) so the
 * Supabase client keeps exactly the module's fetch behaviour: up to three
 * attempts on network errors with 100 ms · attempt pauses, no retry when aborted.
 */
export async function fetchWithRetry(req: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const retries = 3;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(req, init);
    }
    catch (error) {
      if (init?.signal?.aborted) throw error;
      if (attempt === retries) {
        // Never log auth headers.
        const { headers: _headers, ...safeInit } = init ?? {};
        console.error(`Error fetching request ${String(req)}`, error, safeInit);
        throw error;
      }
      console.warn(`Retrying fetch attempt ${attempt + 1} for request: ${String(req)}`);
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
  throw new Error('Unreachable code');
}
