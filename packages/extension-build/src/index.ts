/**
 * @pixelmapper/extension-build (ADR §5.9, plan P6.5)
 *
 * Bundles an extension layer for runtime distribution:
 *   <outDir>/<id>/<version>/index.js       ESM, default export = manifest
 *   <outDir>/<id>/<version>/style.css      Tailwind utilities used by the extension
 *   <outDir>/<id>/<version>/extension.json metadata (no components)
 *
 * `vue`, `pinia` and `@pixelmapper/extension-api` are NOT bundled: imports
 * resolve to virtual modules that read `globalThis.__PIXELMAPPER_SHARED__`
 * (installed by the host before any bundle loads), so a bundle never ships
 * its own Vue. CSS contains utilities only (no preflight) and maps colors to
 * the host's theme variables.
 *
 * Runs under Bun (the manifest metadata step imports the built bundle).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { InlineConfig, Plugin } from 'vite';

/** Modules provided by the host. */
export const SHARED_MODULES = {
  'vue': 'vue',
  'pinia': 'pinia',
  '@pixelmapper/extension-api': 'api',
} as const;

/** Options of one extension build. */
export interface ExtensionBuildOptions {
  /** Extension folder (contains `extension.ts`). */
  root: string;
  /** Entry relative to `root`. Default `extension.ts`. */
  entry?: string;
  /** Catalog output folder; the bundle goes to `<outDir>/<id>/<version>/`. */
  outDir: string;
  /** Minify (default true). */
  minify?: boolean;
}

/** Serializable metadata of a built extension (`extension.json`). */
export interface ExtensionBundleInfo {
  id: string;
  version: string;
  apiVersion: string;
  displayName: string;
  description: string;
  /** Contribution summary. */
  contributes: {
    fixtureKinds: { id: string; version: string; label: string; requiredWhenUsed: boolean }[];
    connectors: { type: string; label: string; direction: string }[];
    controllers: { id: string; label: string }[];
    liveWidgets: { type: string; label: string }[];
    slots: string[];
    replaces: string[];
    commands: string[];
  };
  /** Files in the bundle folder. */
  files: { js: string; css: string | null };
  /** Build time (ISO). */
  builtAt: string;
}

const VIRTUAL_PREFIX = '\0pm-shared:';

/**
 * Rewrites shared module imports to virtual modules exporting the host's
 * instances. Named exports are enumerated from the real modules at build
 * time so `import { ref } from 'vue'` keeps working.
 */
export function sharedModulesPlugin(exportNames: Record<string, string[]>): Plugin {
  return {
    name: 'pm-shared-modules',
    enforce: 'pre',
    resolveId(id) {
      return id in SHARED_MODULES ? VIRTUAL_PREFIX + id : null;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;
      const name = id.slice(VIRTUAL_PREFIX.length) as keyof typeof SHARED_MODULES;
      const key = SHARED_MODULES[name];
      const names = (exportNames[name] ?? []).filter(n => n !== 'default' && /^[A-Za-z_$][\w$]*$/.test(n));
      return [
        `const shared = globalThis.__PIXELMAPPER_SHARED__;`,
        `if (!shared) throw new Error('[extension] host shared globals missing — load bundles through the extension loader');`,
        `const m = shared.${key};`,
        `export default m;`,
        ...names.map(n => `export const ${n} = m[${JSON.stringify(n)}];`),
      ].join('\n');
    },
  };
}

/** Theme tokens of the host as Tailwind colors (utilities only use variables). */
const THEME_CSS = `@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}`;

/** Export names of the shared modules (enumerated from the real modules). */
export async function sharedExportNames(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const name of Object.keys(SHARED_MODULES)) out[name] = Object.keys(await import(name));
  return out;
}

/**
 * Vite config of one extension build (library mode). `entryFile` imports
 * the extension's manifest and its Tailwind style entry and re-exports the
 * manifest.
 */
export function defineExtensionBuild(opts: ExtensionBuildOptions & { entryFile: string; outFolder: string; plugins: Plugin[] }): InlineConfig {
  const root = resolve(opts.root);
  return {
    configFile: false,
    root,
    logLevel: 'warn',
    plugins: opts.plugins,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: opts.outFolder,
      emptyOutDir: true,
      minify: opts.minify ?? true,
      cssCodeSplit: false,
      lib: { entry: opts.entryFile, formats: ['es'], fileName: () => 'index.js', cssFileName: 'style' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  };
}

/** Summarizes a manifest for `extension.json`. */
export function summarizeManifest(m: Record<string, any>, files: ExtensionBundleInfo['files']): ExtensionBundleInfo {
  const c = m.contributes ?? {};
  return {
    id: m.id,
    version: m.version,
    apiVersion: m.apiVersion,
    displayName: m.displayName,
    description: m.description,
    contributes: {
      fixtureKinds: (c.fixtureKinds ?? []).map((k: any) => ({ id: k.id, version: k.version, label: k.label, requiredWhenUsed: k.requiredWhenUsed !== false })),
      connectors: (c.connectors ?? []).map((k: any) => ({ type: k.type, label: k.label, direction: k.direction })),
      controllers: (c.controllers ?? []).map((k: any) => ({ id: k.id, label: k.label })),
      liveWidgets: (c.liveWidgets ?? []).map((k: any) => ({ type: k.type, label: k.label })),
      slots: (c.slots ?? []).map((k: any) => k.slot),
      replaces: (c.replaces ?? []).map((k: any) => k.replaces),
      commands: (c.commands ?? []).map((k: any) => k.type),
    },
    files,
    builtAt: new Date().toISOString(),
  };
}

/**
 * Builds one extension into `<outDir>/<id>/<version>/`. The id/version come
 * from the built manifest, so the bundle is built into a staging folder and
 * moved afterwards.
 */
export async function buildExtension(opts: ExtensionBuildOptions): Promise<ExtensionBundleInfo> {
  const { build } = await import('vite');
  const vue = (await import('@vitejs/plugin-vue')).default;
  const tailwind = (await import('@tailwindcss/vite')).default;

  const root = resolve(opts.root);
  const staging = join(resolve(opts.outDir), `.staging-${Date.now()}`);
  await mkdir(staging, { recursive: true });
  try {
    const styleEntry = join(staging, 'style.entry.css');
    // Absolute path: Tailwind resolves imports relative to the CSS file.
    const utilities = createRequire(import.meta.url).resolve('tailwindcss/utilities.css');
    await writeFile(styleEntry, `@import ${JSON.stringify(utilities)} source(none);\n@source ${JSON.stringify(root)};\n${THEME_CSS}\n`);

    const entryFile = join(staging, 'entry.ts');
    await writeFile(entryFile, `import manifest from ${JSON.stringify(join(root, opts.entry ?? 'extension.ts'))};\nimport ${JSON.stringify(styleEntry)};\nexport default manifest;\n`);

    const plugins = [sharedModulesPlugin(await sharedExportNames()), vue(), tailwind()] as Plugin[];
    const outFolder = join(staging, 'out');
    await build(defineExtensionBuild({ ...opts, entryFile, outFolder, plugins }));

    // Read the manifest from the built bundle with the shared modules installed.
    const shared = globalThis as unknown as { __PIXELMAPPER_SHARED__?: unknown };
    const previous = shared.__PIXELMAPPER_SHARED__;
    shared.__PIXELMAPPER_SHARED__ = { vue: await import('vue'), pinia: await import('pinia'), api: await import('@pixelmapper/extension-api') };
    let manifest: Record<string, any>;
    try {
      manifest = (await import(`${pathToFileURL(join(outFolder, 'index.js')).href}?t=${Date.now()}`)).default;
    }
    finally {
      shared.__PIXELMAPPER_SHARED__ = previous;
    }
    if (!manifest?.id || !manifest?.version) throw new Error(`${root}: bundle has no manifest default export`);

    const target = join(resolve(opts.outDir), manifest.id, manifest.version);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const hasCss = existsSync(join(outFolder, 'style.css'));
    await writeFile(join(target, 'index.js'), await readFile(join(outFolder, 'index.js')));
    if (hasCss) await writeFile(join(target, 'style.css'), await readFile(join(outFolder, 'style.css')));
    const info = summarizeManifest(manifest, { js: 'index.js', css: hasCss ? 'style.css' : null });
    await writeFile(join(target, 'extension.json'), JSON.stringify(info, null, 2));
    return info;
  }
  finally {
    await rm(staging, { recursive: true, force: true });
  }
}
