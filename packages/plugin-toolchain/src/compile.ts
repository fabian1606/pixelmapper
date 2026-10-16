/**
 * In-memory AssemblyScript compilation (ADR D2/D3, §6.6).
 *
 * Compiles a plugin's `modifier.ts` against the embedded SDK without touching
 * the file system, so it runs unchanged in Bun, the browser and (later) Tauri.
 * A synthetic entry re-exports the SDK's ABI; `modifier.ts` is a second entry.
 */
import asc from 'assemblyscript/asc';
import { SDK_SOURCES } from './sdk-sources.generated';

/** Exact compiler identity recorded in packages (`toolchain` field). */
export const ASC_VERSION = '0.28.20';

/** Flags (ADR §6.6 / plan P3.2). */
export const COMPILE_FLAGS: readonly string[] = [
  '-O3',
  '--importMemory',
  '--maximumMemory', '256',
  '--runtime', 'incremental',
  '--noColors',
];

/** One compiler diagnostic. */
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

/** Result of `compile`. */
export interface CompileResult {
  /** Compiled module (null on errors). */
  wasm: Uint8Array | null;
  diagnostics: Diagnostic[];
}

/** Input of `compile`: plugin source files by name (`modifier.ts` required). */
export interface CompileInput {
  files: Record<string, string>;
}

const ENTRY = '__pm_entry.ts';
const SDK_PREFIX = 'node_modules/@pixelmapper/plugin-sdk/';

/** Builds the virtual file system seen by the compiler. */
function virtualFiles(files: Record<string, string>): Map<string, string> {
  const fs = new Map<string, string>();
  for (const [name, src] of Object.entries(files)) fs.set(name, src);
  // Synthetic entry with the ABI exports. `modifier.ts` is a second entry file:
  // AssemblyScript only runs (and compiles) top-level code of entry files, so
  // a side-effect import would never execute `register(...)`.
  fs.set(ENTRY, [
    '// Synthetic entry: ABI exports of the SDK.',
    'export { pm_abi_version, pm_alloc, pm_prepare, pm_render } from "@pixelmapper/plugin-sdk";',
    '',
  ].join('\n'));
  for (const [name, src] of Object.entries(SDK_SOURCES)) fs.set(`${SDK_PREFIX}assembly/${name}`, src);
  fs.set(`${SDK_PREFIX}package.json`, JSON.stringify({ name: '@pixelmapper/plugin-sdk', ascMain: 'assembly/index.ts' }));
  return fs;
}

/** Normalizes compiler-requested paths (`./x`, `/x`, `a/../b`). */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Resolves a compiler-requested path in the virtual FS. asc probes package
 * files through nested `node_modules/…/node_modules/…` paths, so any path
 * containing the SDK prefix maps to the embedded SDK (with or without the
 * `assembly/` folder).
 */
function lookup(fs: Map<string, string>, path: string): string | null {
  const direct = fs.get(path);
  if (direct !== undefined) return direct;
  const at = path.lastIndexOf(SDK_PREFIX);
  if (at < 0) return null;
  const rest = path.slice(at + SDK_PREFIX.length);
  return fs.get(SDK_PREFIX + rest) ?? fs.get(`${SDK_PREFIX}assembly/${rest}`) ?? null;
}

/** Parses asc's textual diagnostics into structured entries. */
function parseDiagnostics(text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const block of text.split(/\n(?=(?:ERROR|WARNING|INFO) )/)) {
    const m = /^(ERROR|WARNING|INFO)\b/.exec(block.trim());
    if (!m) continue;
    out.push({ severity: m[1]!.toLowerCase() as Diagnostic['severity'], message: block.trim() });
  }
  return out;
}

/** Compiles `modifier.ts` (+ helper files) to a WebAssembly module. */
export async function compile({ files }: CompileInput): Promise<CompileResult> {
  if (!files['modifier.ts']) {
    return { wasm: null, diagnostics: [{ severity: 'error', message: 'modifier.ts is missing' }] };
  }
  const fs = virtualFiles(files);
  let wasm: Uint8Array | null = null;
  let stderr = '';

  const result = await asc.main([ENTRY, 'modifier.ts', '--outFile', 'out.wasm', ...COMPILE_FLAGS], {
    readFile: (name: string, baseDir: string) => lookup(fs, normalize(`${baseDir}/${name}`)) ?? lookup(fs, normalize(name)),
    writeFile: (name: string, contents: Uint8Array | string) => {
      if (name.endsWith('.wasm') && contents instanceof Uint8Array) wasm = contents;
    },
    listFiles: (dir: string, baseDir: string) => {
      const prefix = `${normalize(`${baseDir}/${dir}`)}/`;
      return [...fs.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(k => k.slice(prefix.length));
    },
    stdout: asc.createMemoryStream(),
    stderr: asc.createMemoryStream((chunk) => { stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk); }),
  });

  const diagnostics = parseDiagnostics(stderr);
  if (result.error && !diagnostics.some(d => d.severity === 'error')) {
    diagnostics.push({ severity: 'error', message: result.error.message });
  }
  const failed = !!result.error || diagnostics.some(d => d.severity === 'error');
  return { wasm: failed ? null : wasm, diagnostics };
}
