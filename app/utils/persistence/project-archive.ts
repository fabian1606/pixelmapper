/**
 * `.pmproject` archives (ADR §6.10, plan P6.8): a zip with
 *
 *   project.json                         { format, version, name, exportedAt, snapshot }
 *   plugins/<hex>.pmplugin.json          content plugins referenced anywhere in the snapshot
 *   plugins/<hex>.wasm | <hex>.ui.js     their binaries (informational; imports rebuild from source)
 *   extensions/<id>@<version>/…          bundles of every required extension (index.js, style.css, extension.json)
 *
 * so a project opens offline on another device: plugins are rebuilt and
 * verified against their hash, extension bundles go to the loader cache and
 * are installed after the usual warning.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { CachedBundle } from '~/utils/extensions/extension-cache';
import type { PluginFile } from '~/utils/plugins/import-plugin';

/** Format marker of `project.json`. */
export const ARCHIVE_FORMAT = 'pixelmapper-project';

/** `project.json`. */
export interface ArchiveProject {
  format: typeof ARCHIVE_FORMAT;
  version: 1;
  name: string;
  exportedAt: string;
  snapshot: ProjectSnapshot;
}

/** Contents of an archive. */
export interface ArchiveContents {
  project: ArchiveProject;
  plugins: PluginFile[];
  bundles: CachedBundle[];
}

const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** Every content hash referenced anywhere in a JSON value. */
export function referencedPluginHashes(value: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === 'string') { if (HASH_RE.test(v)) out.add(v); return; }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(value);
  return out;
}

/** Hex part of a hash. */
const hex = (hash: string) => hash.replace(/^sha256:/, '');

/** Builds the zip. */
export function buildProjectArchive(opts: {
  name: string;
  snapshot: ProjectSnapshot;
  /** Full packages of referenced non-built-in plugins. */
  plugins: ContentPluginPackage[];
  /** Bundles of required extensions. */
  bundles: CachedBundle[];
}): Uint8Array {
  const files: Zippable = {};
  const project: ArchiveProject = { format: ARCHIVE_FORMAT, version: 1, name: opts.name, exportedAt: new Date().toISOString(), snapshot: opts.snapshot };
  files['project.json'] = strToU8(JSON.stringify(project));
  for (const p of opts.plugins) {
    const file: PluginFile = { format: 'pixelmapper-plugin', version: 1, hash: p.hash, manifest: p.manifest, source: p.source, toolchain: p.toolchain };
    files[`plugins/${hex(p.hash)}.pmplugin.json`] = strToU8(JSON.stringify(file));
    files[`plugins/${hex(p.hash)}.wasm`] = p.wasm;
    if (p.uiJs) files[`plugins/${hex(p.hash)}.ui.js`] = strToU8(p.uiJs);
  }
  for (const b of opts.bundles) {
    const dir = `extensions/${b.id}@${b.version}`;
    files[`${dir}/index.js`] = strToU8(b.js);
    if (b.css) files[`${dir}/style.css`] = strToU8(b.css);
    files[`${dir}/extension.json`] = strToU8(JSON.stringify(b.info));
  }
  return zipSync(files, { level: 6 });
}

/** Reads and validates a zip. Throws a readable error for non-archives. */
export function readProjectArchive(bytes: Uint8Array): ArchiveContents {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  }
  catch {
    throw new Error('Not a .pmproject file (not a zip archive).');
  }
  const projectFile = files['project.json'];
  if (!projectFile) throw new Error('Not a .pmproject file (project.json missing).');
  const project = JSON.parse(strFromU8(projectFile)) as ArchiveProject;
  if (project.format !== ARCHIVE_FORMAT || project.version !== 1) throw new Error('Unsupported .pmproject format.');

  const plugins = Object.entries(files)
    .filter(([path]) => /^plugins\/[0-9a-f]{64}\.pmplugin\.json$/.test(path))
    .map(([, data]) => JSON.parse(strFromU8(data)) as PluginFile);

  const bundleDirs = new Set(Object.keys(files).map(p => /^extensions\/([^/]+)@([^/]+)\//.exec(p)).filter(Boolean).map(m => `${m![1]}@${m![2]}`));
  const bundles: CachedBundle[] = [...bundleDirs].map((key) => {
    const [id, version] = key.split('@') as [string, string];
    const dir = `extensions/${key}`;
    return {
      key, id, version,
      js: strFromU8(files[`${dir}/index.js`] ?? new Uint8Array()),
      css: files[`${dir}/style.css`] ? strFromU8(files[`${dir}/style.css`]!) : null,
      info: files[`${dir}/extension.json`] ? JSON.parse(strFromU8(files[`${dir}/extension.json`]!)) as Record<string, unknown> : {},
    };
  }).filter(b => b.js);

  return { project, plugins, bundles };
}
