/**
 * Builds the offline OFL library of the desktop app (ADR 0004 D18).
 *
 * Reads `<manufacturer>/<fixture>.json` from `ofl-data/fixtures` overlaid with
 * Pixelmapper's own `fixture-library/` and writes
 * - `<outDir>/ofl/index.json` — `OflLibraryIndex` (manufacturers, summaries, RDM IDs),
 * - `<outDir>/ofl/fixtures/<manufacturer>/<fixture>.json` — valid definitions
 *   (redirect files are skipped, like the Nitro route answers 404 for them).
 *
 * `nuxt.config.ts` runs this only for Tauri builds and serves `outDir` as an
 * extra public directory, so web bundles stay unaffected. Summaries use the
 * same code as `/api/fixtures` (`app/utils/ofl/library-query.ts`).
 *
 * CLI: `bun run scripts/tauri/ofl-bundle.ts [outDir] [srcDir...]`
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FixtureSummary, ManufacturerSummary, OflFixture, OflManufacturers } from '../../app/utils/ofl/types';
import { buildFixtureSummary, sortByName, type OflLibraryIndex, type OflRdmEntry } from '../../app/utils/ofl/library-query';
import { isRdmId } from '../../app/utils/fixture-definitions/ofl-rdm-index';

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
 * Collects `<manufacturer>/<fixture>.json` paths and the merged
 * `manufacturers.json` of all source dirs; later dirs override earlier ones
 * (same file, same manufacturer entry). `null` when no source dir exists.
 */
async function collectSources(srcDirs: readonly string[]): Promise<{
  names: OflManufacturers;
  files: Map<string, Map<string, string>>;
} | null> {
  const names: OflManufacturers = {};
  /** Manufacturer key → fixture file name → absolute path. */
  const files = new Map<string, Map<string, string>>();
  let found = false;

  for (const srcDir of srcDirs) {
    let entries;
    try {
      entries = await readdir(srcDir, { withFileTypes: true });
    }
    catch {
      continue;
    }
    found = true;
    Object.assign(names, await readJson<OflManufacturers>(join(srcDir, 'manufacturers.json')) ?? {});
    for (const dir of entries) {
      if (!dir.isDirectory()) continue;
      const byFile = files.get(dir.name) ?? new Map<string, string>();
      for (const file of await readdir(join(srcDir, dir.name))) {
        if (file.endsWith('.json')) byFile.set(file, join(srcDir, dir.name, file));
      }
      files.set(dir.name, byFile);
    }
  }
  return found ? { names, files } : null;
}

/**
 * Writes the bundle into `<outDir>/ofl` (replacing an older one) from one or
 * more OFL-layout source dirs (OFL clone first, then overlays such as
 * `fixture-library/`). Returns `null` if no source dir exists.
 */
export async function buildOflBundle(srcDirs: string | readonly string[], outDir: string): Promise<OflBundleStats | null> {
  const sources = await collectSources(typeof srcDirs === 'string' ? [srcDirs] : srcDirs);
  if (!sources) return null;
  const { names, files: filesByManufacturer } = sources;

  const target = join(outDir, OFL_BUNDLE_PREFIX);
  await rm(target, { recursive: true, force: true });

  const manufacturers: ManufacturerSummary[] = [];
  const fixtures: FixtureSummary[] = [];
  const rdm: OflRdmEntry[] = [];
  let bytes = 0;

  for (const [mfKey, byFile] of filesByManufacturer) {
    const mfName = names[mfKey]?.name ?? mfKey;
    const rdmId = names[mfKey]?.rdmId;
    if (byFile.size === 0) continue;
    // Same count as the Nitro route: every file, redirects included.
    manufacturers.push({ key: mfKey, name: mfName, fixtureCount: byFile.size });

    await mkdir(join(target, 'fixtures', mfKey), { recursive: true });
    for (const [file, path] of byFile) {
      const raw = await readFile(path, 'utf8');
      let fixture: OflFixture;
      try {
        fixture = JSON.parse(raw) as OflFixture;
      }
      catch {
        continue;
      }
      const fixtureKey = file.replace(/\.json$/, '');
      const summary = buildFixtureSummary(mfKey, mfName, fixtureKey, fixture);
      if (!summary) continue;
      fixtures.push(summary);
      const modelId = fixture.rdm?.modelId;
      if (isRdmId(rdmId) && isRdmId(modelId)) rdm.push({ manufacturerId: rdmId, modelId, key: `${mfKey}/${fixtureKey}` });
      await writeFile(join(target, 'fixtures', mfKey, file), raw);
      bytes += raw.length;
    }
  }

  rdm.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const index: OflLibraryIndex = { manufacturers: sortByName(manufacturers), fixtures: sortByName(fixtures), rdm };
  const indexJson = JSON.stringify(index);
  await writeFile(join(target, 'index.json'), indexJson);
  bytes += indexJson.length;
  return { manufacturers: manufacturers.length, fixtures: fixtures.length, bytes };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** Default source dirs: the OFL clone, overlaid with Pixelmapper's own library. */
export const DEFAULT_FIXTURE_SOURCES = ['ofl-data/fixtures', 'fixture-library'] as const;

if (import.meta.main) {
  const [out = '.tauri-public', ...srcArgs] = process.argv.slice(2);
  const src = srcArgs.length > 0 ? srcArgs : DEFAULT_FIXTURE_SOURCES;
  const stats = await buildOflBundle(src, out);
  if (!stats) console.warn(`[ofl-bundle] ${src.join(', ')} not found — run ./scripts/setup-ofl.sh`);
  else console.log(`[ofl-bundle] ${stats.fixtures} fixtures, ${stats.manufacturers} manufacturers, ${(stats.bytes / 1e6).toFixed(1)} MB → ${out}/${OFL_BUNDLE_PREFIX}`);
}
