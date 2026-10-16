/**
 * Custom panel bridge (plan P4.6, ADR §6.9).
 *
 * A content plugin may ship `ui.ts` exporting `mount(el, api)`. The host runs
 * it in `<iframe sandbox="allow-scripts" srcdoc>` (opaque origin, CSP without
 * network) and proxies the `PanelApi` over `postMessage` on a per-instance
 * channel id. This module builds the `srcdoc` (theme variables + the bridge
 * runtime + the transpiled panel) and validates every message the iframe
 * sends against the plugin's param schema.
 *
 * `api.render` is synchronous: the iframe receives the plugin's own
 * (budget-instrumented) wasm and instantiates it locally.
 */
import type { GradientValue, ParamDef, ParamSchema, ParamValue } from '@pixelmapper/extension-api';
import { validateCurveValue } from '@pixelmapper/plugin-toolchain/manifest-curve';
import { checkGradient, checkSteps, normalizeGradient } from '@pixelmapper/plugin-toolchain/param-structs';

// ── Messages ─────────────────────────────────────

/** Protocol marker of every message. */
export const PANEL_PROTOCOL = 'pm-panel/1';

/** Host → iframe. */
export type HostToPanel =
  | { type: 'init'; params: Record<string, ParamValue>; encoded: Float32Array; theme: Record<string, string>; wasm: ArrayBuffer | null }
  | { type: 'params'; params: Record<string, ParamValue>; encoded: Float32Array }
  | { type: 'frame'; timeMs: number; beatTime: number; bpm: number };

/** Iframe → host (after validation). */
export type PanelToHost =
  | { type: 'ready' }
  | { type: 'set-param'; key: string; value: ParamValue }
  | { type: 'scrub'; phase: 'begin' | 'end' }
  | { type: 'frames'; enabled: boolean }
  | { type: 'resize'; height: number }
  | { type: 'error'; message: string };

/** Envelope on the wire. */
interface Envelope { protocol: typeof PANEL_PROTOCOL; channel: string; msg: unknown }

/** Wraps a host message. */
export function envelope(channel: string, msg: HostToPanel): Envelope {
  return { protocol: PANEL_PROTOCOL, channel, msg };
}

// ── Validation ───────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isUnit = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1;

/** Validates (and clamps) a param value against its definition; null if invalid. */
export function coerceParam(def: ParamDef, value: unknown): ParamValue | null {
  switch (def.type) {
    case 'number':
      return isNum(value) ? Math.min(def.max, Math.max(def.min, value)) : null;
    case 'int':
      return isNum(value) ? Math.round(Math.min(def.max, Math.max(def.min, value))) : null;
    case 'bool':
      return typeof value === 'boolean' ? value : null;
    case 'enum':
      return typeof value === 'string' && def.options.includes(value) ? value : null;
    case 'angle':
      return isNum(value) ? value : null;
    case 'color': {
      const c = value as { r?: unknown; g?: unknown; b?: unknown } | null;
      return c && isUnit(c.r) && isUnit(c.g) && isUnit(c.b) ? { r: c.r, g: c.g, b: c.b } : null;
    }
    case 'point': {
      const p = value as { x?: unknown; y?: unknown } | null;
      return p && isUnit(p.x) && isUnit(p.y) ? { x: p.x, y: p.y } : null;
    }
    case 'gradient':
      return checkGradient(value) ? null : (normalizeGradient(value as GradientValue) as ParamValue);
    case 'steps':
      return checkSteps(value) ? null : (JSON.parse(JSON.stringify(value)) as ParamValue);
    case 'curve': {
      // v2 values (`{ shape, args }`, `{ points }`) are checked by the shared curve validator.
      if (!Array.isArray(value)) {
        const errors: string[] = [];
        validateCurveValue(value, 'value', def.domain ?? 'cycle', errors, []);
        return errors.length === 0 && JSON.stringify(value).length < 16_384 ? JSON.parse(JSON.stringify(value)) as ParamValue : null;
      }
      if (value.length < 2 || value.length > 64) return null;
      const pts = value.map(p => ({ x: (p as { x: unknown }).x, y: (p as { y: unknown }).y }));
      if (!pts.every(p => isUnit(p.x) && isUnit(p.y))) return null;
      if (pts.some((p, i) => i > 0 && (p.x as number) <= (pts[i - 1]!.x as number))) return null;
      return pts as { x: number; y: number }[];
    }
  }
}

/**
 * Validates a raw message from the iframe: protocol, channel, type and
 * payload shape; `set-param` values against the schema. Returns null for
 * anything unexpected (dropped silently by the host).
 */
export function parsePanelMessage(data: unknown, channel: string, schema: ParamSchema): PanelToHost | null {
  const env = data as Partial<Envelope> | null;
  if (!env || env.protocol !== PANEL_PROTOCOL || env.channel !== channel) return null;
  const msg = env.msg as Record<string, unknown> | null;
  if (!msg || typeof msg.type !== 'string') return null;
  switch (msg.type) {
    case 'ready':
      return { type: 'ready' };
    case 'set-param': {
      const def = schema.find(p => p.key === msg.key);
      if (!def) return null;
      const value = coerceParam(def, msg.value);
      return value === null ? null : { type: 'set-param', key: def.key, value };
    }
    case 'scrub':
      return msg.phase === 'begin' || msg.phase === 'end' ? { type: 'scrub', phase: msg.phase } : null;
    case 'frames':
      return typeof msg.enabled === 'boolean' ? { type: 'frames', enabled: msg.enabled } : null;
    case 'resize':
      return isNum(msg.height) ? { type: 'resize', height: Math.min(600, Math.max(24, Math.round(msg.height))) } : null;
    case 'error':
      return typeof msg.message === 'string' ? { type: 'error', message: msg.message.slice(0, 500) } : null;
    default:
      return null;
  }
}

// ── Theme ────────────────────────────────────────

/** CSS custom properties forwarded to panels. */
export const THEME_VARS = [
  '--background', '--foreground', '--card', '--card-foreground', '--popover', '--popover-foreground',
  '--primary', '--primary-foreground', '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
  '--accent', '--accent-foreground', '--destructive', '--border', '--input', '--ring', '--radius',
] as const;

/** Resolved theme variables of an element (defaults to the document root). */
export function resolveTheme(el: Element = document.documentElement): Record<string, string> {
  const style = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const v of THEME_VARS) {
    const value = style.getPropertyValue(v).trim();
    if (value) out[v] = value;
  }
  return out;
}

// ── srcdoc ───────────────────────────────────────

/**
 * Bridge runtime (plain JS, runs inside the iframe). Defines `PanelApi`,
 * the local plugin instance for `api.render`, auto-resize and frame
 * subscriptions, then calls the panel's `mount`.
 */
const RUNTIME_JS = String.raw`
(function () {
  var CHANNEL = __PM_CHANNEL__;
  var PROTOCOL = 'pm-panel/1';
  var params = {};
  var paramCbs = [];
  var frameCbs = [];
  var plugin = null;
  var unmount = null;

  function send(msg, transfer) { parent.postMessage({ protocol: PROTOCOL, channel: CHANNEL, msg: msg }, '*', transfer || []); }
  function fail(e) { send({ type: 'error', message: String(e && e.message || e) }); }

  // Minimal ABI v1 host for api.render (mirrors plugin-toolchain/runtime).
  function instantiate(bytes) {
    var module = new WebAssembly.Module(bytes);
    var memImport = WebAssembly.Module.imports(module).find(function (i) { return i.module === 'env' && i.name === 'memory'; });
    var min = (memImport && memImport.type && memImport.type.minimum) || 1;
    var memory = new WebAssembly.Memory({ initial: Math.max(1, min), maximum: 256 });
    var budget = { left: 1e9 };
    var exp = null;
    var imports = {
      env: {
        memory: memory,
        abort: function () { throw new Error('plugin aborted'); },
      },
      pm: {
        budget: function () { if (--budget.left < 0) throw new Error('plugin budget exceeded'); },
        log: function () {},
      },
    };
    if (!memImport) delete imports.env.memory;
    var inst = new WebAssembly.Instance(module, imports);
    exp = inst.exports;
    var mem = memImport ? memory : exp.memory;
    var regions = {};
    function region(name, slots) {
      var r = regions[name];
      if (r && r.cap >= slots) return r;
      var cap = Math.max(16, slots, (r ? r.cap : 0) * 2);
      budget.left = 1e12;
      regions[name] = r = { ptr: exp.pm_alloc(cap * 4), cap: cap };
      return r;
    }
    return {
      prepare: function (p) {
        var r = region('params', Math.max(1, p.length));
        new Float32Array(mem.buffer, r.ptr, p.length).set(p);
        budget.left = 50000;
        exp.pm_prepare(r.ptr, p.length);
      },
      render: function (ctx, samples, count) {
        var arity = Math.max(1, Math.round(ctx[4] || 1));
        var c = region('ctx', 16), s = region('samples', count * 16), o = region('out', count * arity);
        new Float32Array(mem.buffer, c.ptr, 16).set(ctx.subarray(0, 16));
        new Float32Array(mem.buffer, s.ptr, count * 16).set(samples.subarray(0, count * 16));
        budget.left = 50000 + 2000 * count;
        exp.pm_render(c.ptr, s.ptr, count, o.ptr);
        return new Float32Array(mem.buffer, o.ptr, count * arity).slice();
      },
    };
  }

  // Params encoded by the host (plugin-toolchain encodeParams).
  var encoded = new Float32Array(0);

  var api = {
    get params() { return Object.freeze(Object.assign({}, params)); },
    onParams: function (cb) { paramCbs.push(cb); },
    setParam: function (key, value) { params[key] = value; send({ type: 'set-param', key: key, value: value }); },
    beginScrub: function () { send({ type: 'scrub', phase: 'begin' }); },
    endScrub: function () { send({ type: 'scrub', phase: 'end' }); },
    onFrame: function (cb) { frameCbs.push(cb); if (frameCbs.length === 1) send({ type: 'frames', enabled: true }); },
    render: function (samples, count) {
      if (!plugin) throw new Error('plugin not available in this panel');
      var ctx = new Float32Array(16); ctx[4] = 1;
      plugin.prepare(encoded);
      return plugin.render(ctx, samples, count);
    },
    theme: {},
  };

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var env = e.data;
    if (!env || env.protocol !== PROTOCOL || env.channel !== CHANNEL || !env.msg) return;
    var m = env.msg;
    try {
      if (m.type === 'init') {
        params = m.params || {};
        encoded = m.encoded || encoded;
        api.theme = m.theme || {};
        if (m.wasm) plugin = instantiate(m.wasm);
        unmount = mount(document.getElementById('root'), api) || null;
      } else if (m.type === 'params') {
        params = m.params || {};
        encoded = m.encoded || encoded;
        paramCbs.forEach(function (cb) { cb(api.params); });
      } else if (m.type === 'frame') {
        frameCbs.forEach(function (cb) { cb({ timeMs: m.timeMs, beatTime: m.beatTime, bpm: m.bpm }); });
      }
    } catch (err) { fail(err); }
  });

  new ResizeObserver(function () { send({ type: 'resize', height: document.documentElement.scrollHeight }); }).observe(document.body);
  window.addEventListener('error', function (e) { fail(e.error || e.message); });
  send({ type: 'ready' });
})();
`;

/** Removes ESM `export` keywords so the panel can run as a classic script. */
export function stripExports(js: string): string {
  return js.replace(/^(\s*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, '$1');
}

/** Escapes text for inclusion inside an inline <script>. */
function scriptSafe(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/**
 * Builds the iframe document: CSP (no network, inline scripts + wasm only),
 * theme variables, base styles, the bridge runtime and the panel code.
 */
export function buildPanelSrcdoc(channel: string, uiJs: string, theme: Record<string, string>): string {
  const vars = Object.entries(theme).map(([k, v]) => `${k}:${v.replace(/[;<>{}]/g, '')};`).join('');
  const csp = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
  const panel = `${stripExports(uiJs)}\n;if (typeof mount !== 'function') throw new Error('ui.ts must export mount');`;
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>:root{${vars}}html,body{margin:0;padding:0;background:transparent;color:var(--foreground);`
    + `font:12px/1.4 system-ui,-apple-system,sans-serif;overflow:hidden}*{box-sizing:border-box}</style>`
    + `</head><body><div id="root"></div>`
    + `<script>${scriptSafe(panel)}\n${scriptSafe(RUNTIME_JS.replace('__PM_CHANNEL__', JSON.stringify(channel)))}</script>`
    + `</body></html>`;
}
