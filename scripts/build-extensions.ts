/**
 * Builds the extension catalog (ADR §5.9, plan P6.5): every first-party
 * extension outside the distribution set is bundled into
 * `public/extensions/<id>/<version>/` and listed in
 * `public/extensions/catalog.json` for the runtime loader / install UI.
 *
 * Distribution-set extensions ship inside the app (Nuxt layers) and dev-only
 * extensions (folder prefix `_`) are skipped.
 *
 * Usage: bun run scripts/build-extensions.ts [--only <id>]
 */
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildExtension, type ExtensionBundleInfo } from '@pixelmapper/extension-build';

/** Extensions bundled into the app (ADR §5.9 as amended by A12). */
export const DISTRIBUTION_SET = new Set(['color-picker', 'pan-tilt', 'connector-artnet']);

const ROOT = join(import.meta.dir, '..');
const EXT_DIR = join(ROOT, 'extensions');
const OUT_DIR = join(ROOT, 'public', 'extensions');

/** Catalog entry. */
interface CatalogEntry extends Pick<ExtensionBundleInfo, 'id' | 'version' | 'apiVersion' | 'displayName' | 'description'> {
  /** Folder relative to the catalog root. */
  path: string;
}

async function main() {
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : undefined;
  const folders = (await readdir(EXT_DIR, { withFileTypes: true }))
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && !DISTRIBUTION_SET.has(d.name))
    .map(d => d.name)
    .filter(name => existsSync(join(EXT_DIR, name, 'extension.ts')))
    .filter(name => !only || name === only);

  await mkdir(OUT_DIR, { recursive: true });
  const catalog: CatalogEntry[] = [];
  let failed = 0;
  for (const name of folders) {
    const started = performance.now();
    try {
      const info = await buildExtension({ root: join(EXT_DIR, name), outDir: OUT_DIR });
      catalog.push({ id: info.id, version: info.version, apiVersion: info.apiVersion, displayName: info.displayName, description: info.description, path: `${info.id}/${info.version}` });
      console.log(`✓ ${info.id}@${info.version} (${Math.round(performance.now() - started)} ms)`);
    }
    catch (err) {
      failed++;
      console.error(`✗ ${name}: ${(err as Error).message}`);
    }
  }
  if (!only) await writeFile(join(OUT_DIR, 'catalog.json'), JSON.stringify({ extensions: catalog }, null, 2));
  if (failed) process.exit(1);
}

await main();
