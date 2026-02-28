import type { OflFixture } from '../../../../app/utils/ofl/types';

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

  // In Nitro storage, the key uses ':' as path separator
  const storageKey = `${safeManufacturer}:${safeFixture}.json`;
  const oflFixture = await useStorage('assets:ofl-fixtures').getItem<OflFixture>(storageKey);

  if (!oflFixture) {
    throw createError({ statusCode: 404, statusMessage: `Fixture not found: ${safeManufacturer}/${safeFixture}` });
  }

  // Validate it's a real fixture definition, not a redirect
  if (!oflFixture.availableChannels || !oflFixture.modes) {
    throw createError({ statusCode: 404, statusMessage: 'Fixture is a redirect or invalid' });
  }

  return oflFixture;
});
