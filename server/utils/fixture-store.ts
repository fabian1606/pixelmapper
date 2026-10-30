/**
 * Fixture library storage of the Nitro routes: the OFL clone
 * (`ofl-data/fixtures`, server asset `ofl-fixtures`) overlaid with
 * Pixelmapper's own library (`fixture-library/`, server asset `pm-fixtures`,
 * same layout). Keys present in both come from the own library;
 * `manufacturers.json` is merged entry by entry (own entries win).
 */

/** Storage key of the manufacturer list. */
const MANUFACTURERS_KEY = 'manufacturers.json';

/** The read API the fixture routes use. */
export interface FixtureStore {
  /** Parsed JSON of one key (`'<manufacturer>:<fixture>.json'` or `'manufacturers.json'`), else `null`. */
  getItem<T>(key: string): Promise<T | null>;
  /** All keys of both libraries, without duplicates. */
  getKeys(): Promise<string[]>;
}

/** Merged view of the OFL clone and Pixelmapper's own fixture library. */
export function fixtureStore(): FixtureStore {
  const ofl = useStorage('assets:ofl-fixtures');
  const own = useStorage('assets:pm-fixtures');

  return {
    async getItem<T>(key: string): Promise<T | null> {
      if (key === MANUFACTURERS_KEY) {
        const [base, extra] = await Promise.all([ofl.getItem<object>(key), own.getItem<object>(key)]);
        if (!base && !extra) return null;
        return { ...(base ?? {}), ...(extra ?? {}) } as T;
      }
      return (await own.getItem<T>(key)) ?? (await ofl.getItem<T>(key));
    },

    async getKeys(): Promise<string[]> {
      const [base, extra] = await Promise.all([ofl.getKeys(), own.getKeys()]);
      return [...new Set([...base, ...extra])];
    },
  };
}
