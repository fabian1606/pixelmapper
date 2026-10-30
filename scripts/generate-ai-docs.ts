/**
 * Generated API reference for humans and AI agents (ADR D25, plan P7.2):
 *
 *   docs/ai/extension-api.d.ts   bundled declarations of @pixelmapper/extension-api
 *   docs/ai/plugin-sdk.d.ts      bundled declarations of @pixelmapper/plugin-sdk (AssemblyScript)
 *   docs/ai/index.json           pm.* contracts, scopes, slot ids (observed at runtime), param types,
 *                                signatures, ABI fields, core operation catalog (ADR 0002, plan A1.9)
 *
 * Declarations come from TypeScript's isolated-declaration emit per file,
 * merged into one `declare module` block. Slot ids are collected at runtime
 * by mounting the core surfaces in the extension-host integration test
 * (`PM_COLLECT_SLOTS=1`), so they reflect what the layout primitives really
 * render; documented patterns for surfaces not mounted there are listed too.
 *
 * The operation catalog (id, kind, namespace, one-line summary) is collected
 * the same way: the core operations import app code with Nuxt aliases and
 * Vite-only features, which Bun cannot resolve, so
 * `scripts/ai-docs-operations.test.ts` builds the registry under Vitest
 * (`PM_COLLECT_OPERATIONS=1`) and writes it for this script. Without that
 * env var the same test checks that `index.json` is up to date.
 *
 * The output is deterministic (no timestamps; every list is sorted or in
 * source order), so regenerating without changes produces no diff.
 *
 * Usage: bun run scripts/generate-ai-docs.ts [--skip-collect]
 * (`--skip-collect` reuses the previous operation catalog and drops observed slots.)
 */
import ts from 'typescript';
import { listShapes } from '../packages/plugin-toolchain/src/curve-shapes';
import { ABI_VERSION, CTX, SAMPLE } from '../packages/plugin-toolchain/src/runtime';
import { $ } from 'bun';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '@pixelmapper/extension-api';

const ROOT = join(import.meta.dir, '..');
const OUT = join(ROOT, 'docs', 'ai');
const COLLECTED = join(OUT, '.slots.collected.json');
const COLLECTED_OPERATIONS = join(OUT, '.operations.collected.json');

/** Operation catalog entry in `index.json` (see `scripts/ai-docs-operations.test.ts`). */
interface OperationEntry { id: string; kind: string; namespace: string; summary: string }

/** Slot patterns of surfaces not mounted by the collector (architecture/extensions.md). */
const DOCUMENTED_SLOT_PATTERNS = [
  'scene:header|before|after', 'scene/fixture:badges|actions', 'scene/group:badges|actions', 'selection:after',
  'properties:header|before|after', 'properties/<category>:actions|before|after|items', 'properties/<category>/channel:badges|actions',
  'modifiers:header|before|after', 'modifiers/modifier:badges|actions', 'modifiers/add:items',
  'presets:header|before|after', 'presets/preset:badges|actions',
  'library:header|before|after', 'library/categories:items', 'library/<manufacturer>:items', 'add-fixture/sources:items',
  'header:start|end', 'live:start|end', 'connections/outputs:before', 'context-menu/<fixture|group|channel|preset>:items',
];

// ── Declarations ─────────────────────────────────

/** Emits a file's declarations (isolated, no type checking). */
function declarationsOf(path: string): string {
  const res = ts.transpileDeclaration(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { declaration: true, isolatedDeclarations: true, removeComments: false },
    reportDiagnostics: true,
  });
  if (res.diagnostics?.length) {
    throw new Error(`${path}: ${res.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
  }
  return res.outputText;
}

/**
 * Merges per-file declarations into one ambient module: relative imports and
 * re-exports vanish (everything lives in the module), external type imports
 * are hoisted and deduplicated.
 */
function bundle(moduleName: string, files: string[], prelude = ''): string {
  const external = new Map<string, Set<string>>();
  const bodies: string[] = [];
  for (const file of files) {
    let text = declarationsOf(file);
    text = text.replace(/^import (type )?\{([^}]*)\} from ['"]([^'"]+)['"];?\s*$/gm, (_m, _t, names: string, from: string) => {
      if (!from.startsWith('.')) {
        const set = external.get(from) ?? new Set<string>();
        for (const n of names.split(',').map(x => x.trim().replace(/^type\s+/, '')).filter(Boolean)) set.add(n);
        external.set(from, set);
      }
      return '';
    });
    text = text.replace(/^export \* from ['"]\.[^'"]+['"];?\s*$/gm, '');
    text = text.replace(/^export (type )?\{[^}]*\} from ['"]\.[^'"]+['"];?\s*$/gm, '');
    text = text.replace(/^export \{\};?\s*$/gm, '');
    text = text.replace(/\bdeclare (?=(const|function|class|abstract|enum|let|var)\b)/g, '');
    // Inside an ambient module, global augmentations are written `global { … }`.
    text = text.replace(/^declare global \{/gm, 'global {');
    const rel = file.replace(`${ROOT}/`, '');
    bodies.push(`  // ── ${rel} ${'─'.repeat(Math.max(4, 60 - rel.length))}\n${text.trim().split('\n').map(l => (l ? `  ${l}` : l)).join('\n')}`);
  }
  const imports = [...external].map(([from, names]) => `  import type { ${[...names].sort().join(', ')} } from '${from}';`).join('\n');
  return [
    `// Generated by scripts/generate-ai-docs.ts — do not edit.`,
    `// Bundled declarations of ${moduleName}. Source: ${files[0]!.replace(`${ROOT}/`, '').replace(/\/[^/]+$/, '/')}`,
    prelude,
    `declare module '${moduleName}' {`,
    imports,
    bodies.join('\n\n'),
    `}`,
    '',
  ].filter(x => x !== '').join('\n');
}

/** Source files of a folder in a stable order (index last). */
function sources(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.generated.ts'))
    .sort((a, b) => (a === 'index.ts' ? 1 : b === 'index.ts' ? -1 : a.localeCompare(b)))
    .map(f => join(dir, f));
}

/** AssemblyScript built-in types for reading the SDK declarations. */
const AS_PRELUDE = `// AssemblyScript primitive types (for reading; not a compilable shim).
type i8 = number; type i16 = number; type i32 = number; type i64 = bigint; type isize = number;
type u8 = number; type u16 = number; type u32 = number; type u64 = bigint; type usize = number;
type f32 = number; type f64 = number; type bool = boolean;`;

// ── Index (TypeScript AST) ───────────────────────

/** A documented member of an interface. */
interface Member { name: string; type: string; optional: boolean; doc?: string }

/** Members of exported interfaces (including `extends` chains within the file set). */
function interfaces(files: string[]): Map<string, { extends: string[]; members: Member[]; doc?: string }> {
  const out = new Map<string, { extends: string[]; members: Member[]; doc?: string }>();
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const docOf = (node: ts.Node) => ts.getJSDocCommentsAndTags(node).map(d => (typeof d.comment === 'string' ? d.comment : '')).filter(Boolean).join(' ') || undefined;
    sf.forEachChild((node) => {
      if (!ts.isInterfaceDeclaration(node)) return;
      out.set(node.name.text, {
        extends: (node.heritageClauses ?? []).flatMap(h => h.types.map(t => t.expression.getText(sf))),
        doc: docOf(node),
        members: node.members.filter(ts.isPropertySignature).map(m => ({
          name: m.name.getText(sf).replace(/['"]/g, ''),
          type: m.type?.getText(sf) ?? 'unknown',
          optional: !!m.questionToken,
          doc: docOf(m),
        })),
      });
    });
  }
  return out;
}

/** All members of an interface including inherited ones. */
function allMembers(name: string, ifs: ReturnType<typeof interfaces>): Member[] {
  const i = ifs.get(name);
  if (!i) return [];
  return [...i.extends.flatMap(e => allMembers(e.replace(/<.*>$/, ''), ifs)), ...i.members];
}

// ── Operation catalog ────────────────────────────

/**
 * Collected operation catalog, or (with `--skip-collect`) the catalog of the
 * previous `index.json`, so a quick run never drops it.
 */
function operationCatalog(): OperationEntry[] {
  if (existsSync(COLLECTED_OPERATIONS)) return JSON.parse(readFileSync(COLLECTED_OPERATIONS, 'utf8')) as OperationEntry[];
  const previous = join(OUT, 'index.json');
  if (!existsSync(previous)) return [];
  return (JSON.parse(readFileSync(previous, 'utf8')) as { operations?: OperationEntry[] }).operations ?? [];
}

/** `103` → `'1.3.0'` (the toolchain encodes ABI major·100 + minor). */
function abiVersionString(v: number): string {
  return `${Math.floor(v / 100)}.${v % 100}.0`;
}

// ── Main ─────────────────────────────────────────

async function main() {
  mkdirSync(OUT, { recursive: true });

  if (!process.argv.includes('--skip-collect')) {
    await $`bunx vitest run app/components/extension-host/debug-slots.integration.test.ts`.env({ ...process.env, PM_COLLECT_SLOTS: '1' }).quiet();
    await $`bunx vitest run scripts/ai-docs-operations.test.ts`.env({ ...process.env, PM_COLLECT_OPERATIONS: '1' }).quiet();
  }
  const observed = existsSync(COLLECTED) ? JSON.parse(readFileSync(COLLECTED, 'utf8')) as Record<string, string[]> : {};

  const apiFiles = sources(join(ROOT, 'packages/extension-api/src'));
  writeFileSync(join(OUT, 'extension-api.d.ts'), bundle('@pixelmapper/extension-api', apiFiles));
  writeFileSync(join(OUT, 'plugin-sdk.d.ts'), bundle('@pixelmapper/plugin-sdk', sources(join(ROOT, 'packages/plugin-sdk/assembly')), AS_PRELUDE));

  const ifs = interfaces(apiFiles);
  const toolchainIfs = interfaces([join(ROOT, 'packages/plugin-toolchain/src/types.ts')]);
  const contractOf: Record<string, string> = {};
  const contractsIf = ifs.get('PmInputContracts');
  for (const m of contractsIf?.members ?? []) contractOf[m.name] = m.type;
  const pmInputs = api.PM_INPUT_NAMES.map((name) => {
    const contract = contractOf[name] ?? '';
    const props = /props:\s*([A-Za-z]+)/.exec(contract)?.[1];
    const emits = /emits:\s*([A-Za-z<>]+)/.exec(contract)?.[1];
    return { name, contract, props: props ? allMembers(props, ifs) : [], emits: emits ?? null };
  });
  const scopeMap = ifs.get('ScopeMap')?.members ?? [];
  const scopes = scopeMap.map(s => ({ name: s.name, type: s.type, doc: s.doc, fields: allMembers(s.type, ifs) }));

  const operations = operationCatalog();
  const index = {
    apiVersion: api.API_VERSION,
    note: 'Generated by scripts/generate-ai-docs.ts. Declarations: extension-api.d.ts, plugin-sdk.d.ts. Guides: architecture/guides/. Operations: architecture/operations.md.',
    contributions: allMembers('ExtensionContributions', ifs).map(m => ({ key: m.name, type: m.type })),
    pmInputs,
    scopes,
    slots: {
      observed: Object.entries(observed).map(([id, scopeNames]) => ({ id, scopes: scopeNames })),
      globalScopes: ['project', 'selection', 'viewport'],
      documentedPatterns: DOCUMENTED_SLOT_PATTERNS,
      positions: api.PRIMITIVE_SLOT_POSITIONS,
    },
    params: Object.keys(api.PARAM_WIRE_SLOTS).map(type => ({
      type,
      wireSlots: api.PARAM_WIRE_SLOTS[type as keyof typeof api.PARAM_WIRE_SLOTS],
      defaultInput: api.PARAM_DEFAULT_INPUT[type as keyof typeof api.PARAM_DEFAULT_INPUT],
    })),
    signatures: api.SIGNATURE_ARITY,
    // Content-plugin manifest (ADR §6.2, A20): fields, recipes, editors, curves.
    pluginManifest: {
      fields: allMembers('ContentPluginManifest', toolchainIfs),
      distribution: allMembers('ManifestDistribution', toolchainIfs),
      preset: allMembers('ManifestPreset', toolchainIfs),
      presetWhen: allMembers('PresetWhen', toolchainIfs),
      editor: allMembers('ManifestEditor', toolchainIfs),
      paramCommon: allMembers('ParamBase', ifs),
      // Canvas hints (plan M4): object form of a param's `ui` with a draggable canvas handle.
      paramUi: allMembers('ParamUiOptions', ifs),
      canvasHints: {
        kinds: [
          { canvas: 'point', paramType: 'point', value: '{ x, y } normalized world space, clamped to 0–1' },
          { canvas: 'radius', paramType: 'number', requires: 'anchor = key of a point param', value: 'radius in normalized world-x units (1 = world width), clamped to [min, max]; distance = hypot(dx, dy / worldAspect)' },
        ],
        guide: 'architecture/guides/authoring-content-plugins.md#canvas-handles-uicanvas',
      },
      curveParam: allMembers('CurveParam', ifs),
      curveShapes: listShapes().map(s => ({ id: s.id, label: s.label, domain: s.domain, periodic: s.periodic, args: s.args.map(a => ({ key: a.key, label: a.label, min: a.min, max: a.max, default: a.default, handle: a.handle.kind })) })),
      outputs: ['scale', 'bipolar', 'absolute'],
      distributionModel: allMembers('Distribution', ifs),
    },
    abi: {
      version: abiVersionString(ABI_VERSION),
      frame: Object.keys(CTX),
      sample: Object.keys(SAMPLE),
    },
    coreCommands: (ifs.get('CoreCommandFactory') ? ts.createSourceFile('x.ts', readFileSync(join(ROOT, 'packages/extension-api/src/commands.ts'), 'utf8'), ts.ScriptTarget.Latest, true) : null)
      ?.statements.filter(ts.isInterfaceDeclaration).find(i => i.name.text === 'CoreCommandFactory')
      ?.members.filter(ts.isMethodSignature).map(m => m.getText().replace(/\s+/g, ' ').trim()) ?? [],
    // Core operation catalog (ADR 0002 §4, B12): `describe` over MCP returns full schemas.
    operations,
  };
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  rmSync(COLLECTED, { force: true });
  rmSync(COLLECTED_OPERATIONS, { force: true });

  console.log(`✓ docs/ai: extension-api.d.ts, plugin-sdk.d.ts, index.json (${pmInputs.length} inputs, ${scopes.length} scopes, ${index.slots.observed.length} observed slots, ${operations.length} operations)`);
}

await main();
