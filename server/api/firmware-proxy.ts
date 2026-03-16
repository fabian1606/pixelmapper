/**
 * Proxies GitHub release asset downloads to avoid CORS restrictions.
 * Usage: GET /api/firmware-proxy?url=<encoded_browser_download_url>
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const url = query.url as string | undefined;

  if (!url || !url.startsWith('https://github.com/fabian1606/pixelmapper/releases/download/')) {
    throw createError({ statusCode: 400, message: 'Invalid or missing url parameter' });
  }

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw createError({ statusCode: res.status, message: `GitHub returned ${res.status}` });
  }

  setResponseHeader(event, 'Content-Type', 'application/octet-stream');
  return sendStream(event, res.body!);
});
