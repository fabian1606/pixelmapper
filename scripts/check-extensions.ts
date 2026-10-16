/**
 * check-extensions — CI / `bun run check:extensions` (ADR §10).
 *
 * For every first-party extension in `extensions/<id>/extension.ts`:
 * - validates the manifest (unique id, semver, compatible apiVersion,
 *   namespaced command types, unique kinds/connectors, …),
 * - rejects relative imports that leave the extension folder,
 * - rejects two first-party extensions replacing the same `pm.*` input.
 *
 * Manifests import `.vue` components, so they are loaded through Vite's SSR
 * module loader with the Vue plugin. Exits with code 1 on any error.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import type { ExtensionManifest } from '@pixelmapper/extension-api';
import { validateManifest, type RegisteredExtension } from '../app/utils/extensions/registry';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = join(ROOT, 'extensions');

/** Recursively lists `.ts`/`.vue` source files (skipping node_modules/dist). */
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(p));
    else if (/\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Import specifiers of a source file (static, re-exports and dynamic). */
function importSpecifiers(code: string): string[] {
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  return [...code.matchAll(re)].map(m => m[1] ?? m[2] ?? m[3]!).filter(Boolean);
}

/** Relative imports that resolve outside `extRoot`. */
async function escapingImports(extRoot: string): Promise<string[]> {
  const errors: string[] = [];
  for (const file of await sourceFiles(extRoot)) {
    const code = await readFile(file, 'utf8');
    for (const spec of importSpecifiers(code)) {
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (target !== extRoot && !target.startsWith(extRoot + sep)) {
        errors.push(`${relative(ROOT, file)}: import "${spec}" leaves the extension folder`);
      }
    }
  }
  return errors;
}

/** Lists extension folders that contain an `extension.ts`. */
async function extensionFolders(): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(EXT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryFile = join(EXT_DIR, entry.name, 'extension.ts');
    if (await stat(entryFile).then(() => true, () => false)) out.push(join(EXT_DIR, entry.name));
  }
  return out.sort();
}

async function main(): Promise<number> {
  const folders = await extensionFolders();
  const errors: string[] = [];

  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    plugins: [vue()],
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });

  const registered = new Map<string, RegisteredExtension>();
  const replacedBy = new Map<string, string>();

  try {
    for (const folder of folders) {
      const name = relative(ROOT, folder);
      errors.push(...await escapingImports(folder));

      let manifest: ExtensionManifest;
      try {
        const mod = await server.ssrLoadModule(join(folder, 'extension.ts'));
        manifest = mod.default as ExtensionManifest;
      }
      catch (err) {
        errors.push(`${name}: failed to load extension.ts — ${(err as Error).message}`);
        continue;
      }
      if (!manifest?.id) {
        errors.push(`${name}: extension.ts has no default-exported manifest`);
        continue;
      }

      for (const e of validateManifest(manifest, registered)) errors.push(`${name}: ${e}`);
      if (`extensions${sep}${manifest.id}` !== name) {
        errors.push(`${name}: folder name must equal the extension id "${manifest.id}"`);
      }

      for (const r of manifest.contributes?.replaces ?? []) {
        const other = replacedBy.get(r.replaces);
        if (other) errors.push(`${name}: replaces "${r.replaces}", already replaced by first-party extension "${other}"`);
        else replacedBy.set(r.replaces, manifest.id);
      }

      registered.set(manifest.id, { manifest, source: 'layer', order: registered.size });
    }
  }
  finally {
    await server.close();
  }

  if (errors.length > 0) {
    console.error(`✗ check-extensions: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`);
    return 1;
  }
  console.log(`✓ check-extensions: ${folders.length} extension(s) OK (${[...registered.keys()].join(', ') || 'none'})`);
  return 0;
}

process.exit(await main());
