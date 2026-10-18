/**
 * OFL fixture library of the running platform (ADR 0004 D18): the Nitro
 * routes on the web, the bundled offline copy in the desktop app. Which one
 * is decided by the `#platform` import (ADR 0003 D3), not at runtime.
 */
import { getFixtureLibrary } from '#platform';
import type { FixtureLibrary } from '~/platform/fixture-library';

/** One instance per app, so the bundled index is fetched only once. */
let library: FixtureLibrary | null = null;

/** Returns the shared fixture library. */
export function useFixtureLibrary(): FixtureLibrary {
  library ??= getFixtureLibrary();
  return library;
}
