/**
 * Builds the offline OFL library of the desktop app (ADR 0004 D18).
 *
 * Reads `ofl-data/fixtures/<manufacturer>/<fixture>.json` and writes
 * - `<outDir>/ofl/index.json` — `OflLibraryIndex` (manufacturers + summaries),
 * - `<outDir>/ofl/fixtures/<manufacturer>/<fixture>.json` — valid definitions
 *   (redirect files are skipped, like the Nitro route answers 404 for them).
 *
 * `nuxt.config.ts` runs this only for Tauri builds and serves `outDir` as an
 * extra public directory, so web bundles stay unaffected. Summaries use the
 * same code as `/api/fixtures` (`app/utils/ofl/library-query.ts`).
 *
 * CLI: `bun run scripts/tauri/ofl-bundle.ts [srcDir] [outDir]`
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FixtureSummary, ManufacturerSummary, OflFixture, OflManufacturers } from '../../app/utils/ofl/types';
import { buildFixtureSummary, sortByName, type OflLibraryIndex } from '../../app/utils/ofl/library-query';

/** Sub-path of the bundle inside the public dir (must match `OFL_BASE` in app/platform/tauri). */
export const OFL_BUNDLE_PREFIX = 'ofl';

/** Result counts for logging. */
export interface OflBundleStats {
  manufacturers: number;
  fixtures: number;
  bytes: number;
}

/** Reads and parses a JSON file; `null` if unreadable. */
async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  }
  catch (err) {
    console.warn(`[ofl-bundle] skipping ${path}:`, (err as Error).message);
    return null;
  }
}

/**
 * Writes the bundle into `<outDir>/ofl` (replacing an older one).
 * Returns `null` if `srcDir` does not exist (OFL data not set up).
 */
export async function buildOflBundle(srcDir: string, outDir: string): Promise<OflBundleStats | null> {
  let entries;
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  }
  catch {
    return null;
  }

  const target = join(outDir, OFL_BUNDLE_PREFIX);
  await rm(target, { recursive: true, force: true });

  const names = await readJson<OflManufacturers>(join(srcDir, 'manufacturers.json')) ?? {};
  const manufacturers: ManufacturerSummary[] = [];
  const fixtures: FixtureSummary[] = [];
  let bytes = 0;

  for (const dir of entries) {
    if (!dir.isDirectory()) continue;
    const mfKey = dir.name;
    const mfName = (names as OflManufacturers)[mfKey]?.name ?? mfKey;
    const files = (await readdir(join(srcDir, mfKey))).filter(f => f.endsWith('.json'));
    if (files.length === 0) continue;
    // Same count as the Nitro route: every file, redirects included.
    manufacturers.push({ key: mfKey, name: mfName, fixtureCount: files.length });

    await mkdir(join(target, 'fixtures', mfKey), { recursive: true });
    for (const file of files) {
      const raw = await readFile(join(srcDir, mfKey, file), 'utf8');
      let fixture: OflFixture;
      try {
        fixture = JSON.parse(raw) as OflFixture;
      }
      catch {
        continue;
      }
      const summary = buildFixtureSummary(mfKey, mfName, file.replace(/\.json$/, ''), fixture);
      if (!summary) continue;
      fixtures.push(summary);
      await writeFile(join(target, 'fixtures', mfKey, file), raw);
      bytes += raw.length;
    }
  }

  const index: OflLibraryIndex = { manufacturers: sortByName(manufacturers), fixtures: sortByName(fixtures) };
  const indexJson = JSON.stringify(index);
  await writeFile(join(target, 'index.json'), indexJson);
  bytes += indexJson.length;
  return { manufacturers: manufacturers.length, fixtures: fixtures.length, bytes };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const [src = 'ofl-data/fixtures', out = '.tauri-public'] = process.argv.slice(2);
  const stats = await buildOflBundle(src, out);
  if (!stats) console.warn(`[ofl-bundle] ${src} not found — run ./scripts/setup-ofl.sh`);
  else console.log(`[ofl-bundle] ${stats.fixtures} fixtures, ${stats.manufacturers} manufacturers, ${(stats.bytes / 1e6).toFixed(1)} MB → ${out}/${OFL_BUNDLE_PREFIX}`);
}
