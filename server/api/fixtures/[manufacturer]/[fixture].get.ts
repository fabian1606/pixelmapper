import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { OflFixture } from '../../../../app/utils/ofl/types';


const OFL_FIXTURES_DIR = path.resolve(process.cwd(), 'ofl-data/fixtures');

/**
 * GET /api/fixtures/:manufacturer/:fixture
 *
 * Returns the full raw OFL fixture JSON for a single fixture.
 * The client then passes this to `createFixtureFromOfl()` on the frontend.
 *
 * Example: GET /api/fixtures/generic/rgb-fader
 */
export default defineEventHandler(async (event) => {
  const manufacturer = getRouterParam(event, 'manufacturer');
  const fixture = getRouterParam(event, 'fixture');

  if (!manufacturer || !fixture) {
    throw createError({ statusCode: 400, statusMessage: 'Missing manufacturer or fixture key' });
  }

  // Sanitize path segments — only allow alphanum, dash, underscore
  const safeManufacturer = manufacturer.replace(/[^a-zA-Z0-9\-_]/g, '');
  const safeFixture = fixture.replace(/[^a-zA-Z0-9\-_]/g, '');

  if (!safeManufacturer || !safeFixture) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid fixture path' });
  }

  const filePath = path.join(OFL_FIXTURES_DIR, safeManufacturer, `${safeFixture}.json`);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const oflFixture = JSON.parse(raw) as OflFixture;

    // Validate it's a real fixture definition, not a redirect
    if (!oflFixture.availableChannels || !oflFixture.modes) {
      throw createError({ statusCode: 404, statusMessage: 'Fixture is a redirect or invalid' });
    }

    return oflFixture;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw createError({ statusCode: 404, statusMessage: `Fixture not found: ${safeManufacturer}/${safeFixture}` });
    }
    throw err;
  }
});
