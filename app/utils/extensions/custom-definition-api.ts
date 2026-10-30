/**
 * Host side of `saveCustomFixtureDefinition` (extension API 1.4): stores a
 * fixture definition an extension generated (e.g. from a device's RDM slot
 * descriptions) as a new custom fixture of the user, so it shows up in the
 * custom fixture editor and can be edited like any other.
 *
 * Goes through the custom fixture accessor only (plan D11), which stores
 * it in the user's synced `custom-fixture` records (ADR 0004 D21).
 */
import type { FixtureDefinitionKey, Json } from '@pixelmapper/extension-api';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import { parseOflFixtureJson } from '~/utils/fixture-definitions/ofl-import';
import { addCustomFixture, customFixtureKey } from '~/utils/fixture-definitions/custom-fixtures';

/**
 * Validates `definition` (OFL fixture JSON, same lenient rules as the
 * editor's import), checks that every mode builds, and adds it as a new
 * custom fixture (never replacing an existing one; a taken name gets a
 * numeric suffix). Resolves its definition key `'custom/<id>'`.
 *
 * @throws (rejects) Error with a readable message when the definition is invalid.
 */
export async function saveCustomFixtureDefinition(definition: Json): Promise<FixtureDefinitionKey> {
  const parsed = parseOflFixtureJson(JSON.stringify(definition ?? null));
  if (!parsed.ok) throw new Error(`saveCustomFixtureDefinition: ${parsed.error}`);
  // Guard: every mode must build, otherwise adding the fixture fails later.
  parsed.fixture.modes.forEach((mode, index) => {
    try {
      createFixtureFromOfl(parsed.fixture, index, `custom-definition-check-${index}`);
    }
    catch (err) {
      throw new Error(`saveCustomFixtureDefinition: mode "${mode.name}" cannot be built (${(err as Error).message ?? err})`);
    }
  });
  return customFixtureKey(await addCustomFixture(parsed.fixture));
}
