/**
 * Fixture definition keys (plan M4).
 *
 * One string identifies the definition a fixture is created from:
 * - OFL library fixtures: `'<manufacturer>/<fixture>'` (e.g. `'cameo/flat-pro-18'`),
 * - custom fixtures: `'custom/<id>'` (e.g. `'custom/custom-1729800000000'`).
 *
 * The same format is used by the add dialog (recent fixtures, custom list),
 * `Fixture.source`, `commands.addFixtures` and `findFixtureDefinitionByRdm`.
 */

/** Prefix of custom fixture keys. */
export const CUSTOM_KEY_PREFIX = 'custom/';

/** A parsed definition key. */
export type ParsedDefinitionKey =
  | { source: 'custom'; id: string }
  | { source: 'ofl'; manufacturer: string; fixture: string };

/** Key of a stored custom fixture. */
export function customDefinitionKey(id: string): string {
  return `${CUSTOM_KEY_PREFIX}${id}`;
}

/** True for custom fixture keys. */
export function isCustomDefinitionKey(key: string): boolean {
  return key.startsWith(CUSTOM_KEY_PREFIX);
}

/**
 * Parses a definition key. Returns `null` for malformed keys (no `/`, empty
 * segments).
 */
export function parseDefinitionKey(key: string): ParsedDefinitionKey | null {
  if (isCustomDefinitionKey(key)) {
    const id = key.slice(CUSTOM_KEY_PREFIX.length);
    return id ? { source: 'custom', id } : null;
  }
  const [manufacturer, fixture, ...rest] = key.split('/');
  if (!manufacturer || !fixture || rest.length > 0) return null;
  return { source: 'ofl', manufacturer, fixture };
}
