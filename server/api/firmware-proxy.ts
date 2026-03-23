/**
 * Proxies GitHub release asset downloads to avoid CORS restrictions.
 * Usage: GET /api/firmware-proxy?url=<encoded_browser_download_url>
 *
 * NOTE: We buffer the entire response instead of streaming, because H3's
 * sendStream may re-encode chunks as UTF-8 which corrupts binary data.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const url = query.url as string | undefined;

  if (!url || !url.includes('github.com/fabian1606/pixelmapper/releases/')) {
    throw createError({ statusCode: 400, message: 'Invalid or missing url parameter' });
  }

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw createError({ statusCode: res.status, message: `GitHub returned ${res.status}` });
  }

  // Buffer the entire binary in memory — streaming risks UTF-8 re-encoding
  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  setResponseHeader(event, 'Content-Type', 'application/octet-stream');
  setResponseHeader(event, 'Content-Length', buf.length);
  return buf;
});
