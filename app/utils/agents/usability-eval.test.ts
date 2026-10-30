// @vitest-environment node
/**
 * Usability eval harness for the agent tools (WP-J item 4).
 *
 * Not a regular test: every case is skipped unless its env var is set.
 *
 * - `PM_EVAL_DUMP=<dir>` writes what an MCP client sees for a seeded stage
 *   (21 LED bars + 1 moving head, scattered): the tool list (names,
 *   descriptions, input schemas), the `operations` output, the
 *   `inspect { selector: "project" }` digest and one `describe` output per
 *   operation. A reviewer agent without repo knowledge reads these files.
 * - `PM_EVAL_CALLS=<calls.json>` runs a JSON array of `{ tool, input }`
 *   calls (comma-separated files are concatenated) in order against a fresh copy of the same stage and writes every
 *   output (text, isError) to `PM_EVAL_OUT` (default `<calls>.out.txt`).
 *   An `isError` result counts as a failed first try.
 *
 * `observe` renders headless previews through the real `rs-engine-core`
 * (needs `bun run build:wasm && bun run build:plugins`; without them observe
 * reports itself unavailable). Live mode has no running engine here.
 *
 * Usage: PM_EVAL_DUMP=/tmp/eval bunx vitest run app/utils/agents/usability-eval.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { createTools, findTool, toolDescriptor, type AgentHost, type ToolOutput } from '@pixelmapper/agent-kit';
import { enginePkgDir } from '~~/scripts/engine-packages';
import { observe, setPreviewCoreLoader } from '~/utils/observability';
import { eventLog } from '~/utils/observability/event-log';
import type { HeadlessCore } from '~/utils/observability/preview-core';
import { createOperationRegistry, registerCoreOperations } from '~/utils/operations';
import { resetOperationState, seedScene, stubOperationGlobals, type FixtureSpec } from '~/utils/operations/test-utils';
import { getManifest, isBuiltin, loadWasm } from '~/utils/plugins/plugin-store';
import { createAppAgentHost } from './host';

const ROOT = join(__dirname, '../../..');
const CORE = enginePkgDir('rs-engine-core', ROOT);
/** The headless engine and the built-in plugins are built: observe previews work. */
const engineReady = existsSync(join(CORE, 'rs_engine_core_bg.wasm')) && existsSync(join(ROOT, 'public/plugins'));

/** Built-ins from `public/plugins`, built plugins from the store. */
const plugins = {
  getManifest,
  loadWasm: async (hash: string) => (isBuiltin(hash)
    ? new Uint8Array(readFileSync(join(ROOT, 'public/plugins', `${hash.slice(7)}.wasm`)))
    : loadWasm(hash)),
};

const DUMP_DIR = process.env.PM_EVAL_DUMP;
const CALLS_FILE = process.env.PM_EVAL_CALLS;
const tools = createTools();
/** Output budget per call, as the MCP bridge default (`DEFAULT_MAX_OUTPUT_CHARS`). */
const MAX_OUTPUT_CHARS = 40_000;
let host: AgentHost;

/** Deterministic pseudo-random numbers (mulberry32) for the scattered stage. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The eval stage: 21 LED bars and one moving head at random positions. */
export function evalStage(): FixtureSpec[] {
  const rnd = seededRandom(7);
  const pos = () => Number((0.1 + rnd() * 0.8).toFixed(3));
  const bars = Array.from({ length: 21 }, (_, i) => ({ id: `bar-${i + 1}`, name: `LED Bar ${i + 1}`, x: pos(), y: pos() }));
  return [...bars, { id: 'mh-1', name: 'Moving Head', x: pos(), y: pos() }];
}

/** Runs a tool by name (unknown tool names are reported like an MCP client would). */
async function run(name: string, input: unknown): Promise<ToolOutput> {
  const tool = findTool(tools, name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool "${name}"` }], isError: true };
  return tool.run(host, input, { actor: 'agent:mcp:eval' });
}

/** All content items as text (JSON items pretty-printed, as MCP clients show them). */
function render(out: ToolOutput): string {
  return out.content.map(c => (c.type === 'text' ? c.text : c.type === 'json' ? JSON.stringify(c.json, null, 2) : '[image]')).join('\n\n');
}

beforeAll(() => {
  stubOperationGlobals();
  // Built-in plugin sources (`/plugins/<hash>.json`) come from `public/`.
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => (typeof url === 'string' && url.startsWith('/plugins/')
    ? Promise.resolve(new Response(readFileSync(join(ROOT, 'public', url), 'utf8')))
    : realFetch(url, init)));
  if (engineReady) {
    setPreviewCoreLoader(async () => {
      const core = await import(join(CORE, 'rs_engine_core.js'));
      await core.default({ module_or_path: readFileSync(join(CORE, 'rs_engine_core_bg.wasm')) });
      return core as unknown as HeadlessCore;
    });
  }
});
afterAll(() => setPreviewCoreLoader(null));
beforeEach(() => {
  // Deterministic ids, so a replayed session addresses the same modifier ids.
  let uuid = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`);
  resetOperationState();
  eventLog.clear();
  seedScene(evalStage());
  host = createAppAgentHost({
    registry: registerCoreOperations(createOperationRegistry()),
    observe: async () => (engineReady ? (req, opts) => observe(req, { plugins, ...opts }) : null),
  });
});

describe('agent tool usability eval', () => {
  it.skipIf(!DUMP_DIR)('dumps the tool surface', async () => {
    const dir = DUMP_DIR!;
    mkdirSync(join(dir, 'describe'), { recursive: true });
    const toolText = tools.map(toolDescriptor).map(t =>
      `## ${t.name}\n\n${t.description}\n\nInput schema:\n${JSON.stringify(t.inputSchema, null, 2)}\n`).join('\n');
    writeFileSync(join(dir, 'tools.md'), `# MCP tools\n\n${toolText}`);
    writeFileSync(join(dir, 'operations.txt'), render(await run('operations', {})).split('\n\n[')[0]!);
    writeFileSync(join(dir, 'inspect-project.txt'), render(await run('inspect', { selector: 'project' })));
    for (const op of host.listOperations()) {
      writeFileSync(join(dir, 'describe', `${op.id.replace('/', '__')}.txt`), render(await run('describe', { id: op.id })));
    }
  });

  it.skipIf(!CALLS_FILE)('runs recorded calls', async () => {
    // Comma-separated files are concatenated (one session, e.g. task A then task B).
    const calls = CALLS_FILE!.split(',').flatMap(f => JSON.parse(readFileSync(f, 'utf8')) as { tool: string; input: unknown }[]);
    const lines: string[] = [];
    let errors = 0;
    for (const [i, call] of calls.entries()) {
      const out = await run(call.tool, call.input);
      if (out.isError) errors++;
      lines.push(`### call ${i + 1}: ${call.tool} ${out.isError ? 'ERROR' : 'ok'}\n${render(out).slice(0, MAX_OUTPUT_CHARS)}\n`);
    }
    lines.unshift(`${calls.length} call(s), ${errors} error(s)\n`);
    writeFileSync(process.env.PM_EVAL_OUT ?? `${CALLS_FILE!.split(',')[0]}.out.txt`, lines.join('\n'));
  }, 600_000); // long sessions with observe previews exceed the 5 s default
});
