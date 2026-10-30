/**
 * Observation entry point (ADR 0002 §6, plan M2 "observe-lite").
 *
 * `observe(request)` captures a trace (`preview`: one modifier instance in a
 * private headless engine; `live`: the running output), extracts features,
 * evaluates the request's expectations against the feature JSON and renders
 * the compact text report. The `observe` tool (WP-F) calls this through
 * `AgentHost.observe`.
 *
 * See `architecture/observability.md` for modes, JSON paths and limits.
 */
import {
  errorFinding,
  evaluateExpectations,
  infoFinding,
  ObserveRequestSchema,
  warningFinding,
  type Finding,
  type ObserveReport,
  type ObserveRequest,
} from '@pixelmapper/agent-kit';
import { useEngineStore } from '~/stores/engine-store';
import type { Fixture } from '~/utils/engine/core/fixture';
import { createModifier } from '~/utils/engine/modifiers';
import type { ModifierInstance, Signature } from '~/utils/engine/types';
import { roomFromPoints } from '~/utils/engine/room';
import { liveHub } from '~/utils/extensions/live-hub';
import { fixtureInfo, fixtureSignatures, readApi, type CoreReadApi } from '~/utils/operations/read-api';
import { pluginNotFound, resolvePlugin } from '~/utils/operations/core/plugin-ref';
import { getManifest, loadWasm } from '~/utils/plugins/plugin-store';
import { captureLive, type CaptureHub } from './capture';
import { analyzeTrace } from './features';
import { renderPreview, type PreviewPlugins } from './preview';
import { renderReport } from './report';
import { headSamples, pickSignature, resolveTargets, type ResolvedTargets } from './targets';
import { parseTimeRef, type Trace } from './types';

export type { Trace, TraceSample, TracePoint, TraceSource } from './types';
export type { ObservationJson, GroupFeatures, FixtureFeatures } from './features';
export { setPreviewCoreLoader } from './preview-core';

// ── Options ─────────────────────────────────────

/** Injectable dependencies (defaults: app stores, live hub, plugin store). */
export interface ObserveDeps {
  read?: CoreReadApi;
  /** All fixtures in layout order (default: the engine store's flat fixtures). */
  layout?: () => readonly Fixture[];
  hub?: CaptureHub;
  plugins?: PreviewPlugins;
  /** Live capture timing (tests). */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Default frame rate and window (ADR §6.1). */
const DEFAULT_FPS = 30;
const DEFAULT_DURATION_S = 2;
/** Upper bound of frames per observation (keeps reports cheap). */
const MAX_FRAMES = 3600;
/** Windows shorter than this are snapshots: a constant / stuck output is expected. */
const SNAPSHOT_WINDOW_S = 0.5;

// ── Helpers ─────────────────────────────────────

/** Report without a trace (invalid request, unknown modifier, …). */
function failed(findings: Finding[]): ObserveReport {
  const text = ['observe · failed', ...findings.map(f => `${f.level.toUpperCase()} ${f.code}: ${f.message}`)].join('\n');
  return { text, json: {}, expectations: [], findings };
}

/** Short title of the targets for the report header. */
function targetTitle(req: ObserveRequest, resolved: ResolvedTargets): string {
  if (req.targets === 'all' || req.targets === 'selection') return req.targets;
  if (resolved.groups.length > 0) return resolved.groups.map(g => g.name).join(', ');
  return `${resolved.fixtures.length} fixture${resolved.fixtures.length === 1 ? '' : 's'}`;
}

/** First manifest signature that every target offers (else the manifest's first). */
function instanceSignature(signatures: readonly string[], fixtures: readonly Fixture[], requested?: string): Signature {
  if (requested && signatures.includes(requested)) return requested as Signature;
  const offered = fixtures.map(fixtureSignatures);
  const fit = signatures.find(s => offered.every(list => list.includes(s as Signature)));
  return (fit ?? signatures[0] ?? 'scalar') as Signature;
}

/**
 * The instance a preview renders: an existing modifier (optionally with a
 * replacement plugin and param overrides) or a fresh instance of a plugin.
 */
async function previewInstance(req: ObserveRequest, read: CoreReadApi, targets: readonly Fixture[], findings: Finding[]): Promise<ModifierInstance | null> {
  let base: ModifierInstance | null = null;
  if (req.modifierId) {
    base = read.modifier(req.modifierId);
    if (!base) {
      findings.push(errorFinding('modifier-not-found', `modifier "${req.modifierId}" does not exist (see the project digest for modifier ids)`, [`modifier:${req.modifierId}`]));
      return null;
    }
  }
  if (!req.plugin) return base;
  const plugin = await resolvePlugin(req.plugin.ref);
  if (!plugin) {
    findings.push(errorFinding('plugin-not-found', pluginNotFound(req.plugin.ref)));
    return null;
  }
  const params = (req.plugin.params ?? {}) as ModifierInstance['params'];
  if (base) {
    // Same instance (distribution, speed, targets), other plugin version / params.
    return { ...base, plugin: plugin.hash, params: { ...base.params, ...params } };
  }
  const allTargets = req.targets === 'all';
  return createModifier(plugin.hash, {
    signature: instanceSignature(plugin.manifest.signatures, targets, req.plugin.signature),
    params,
    targetFixtureIds: allTargets ? undefined : targets.map(f => f.id),
  });
}

/**
 * Mirror lines of the `mirror` feature: the center of the engine's room box
 * (bounding box of every head in the layout, `Sample.u/v = 0.5`), overridden
 * per axis by the request.
 */
function mirrorAxes(layout: readonly Fixture[], requested?: { x?: number; y?: number }): { x: number; y: number } {
  const room = roomFromPoints(headSamples(layout, layout, () => []));
  return {
    x: requested?.x ?? room.minX + room.width / 2,
    y: requested?.y ?? room.minY + room.depth / 2,
  };
}

/**
 * Why a constant / stuck output is intended by the request, or null:
 * - a snapshot window (< 0.5 s, e.g. "is it a full flash right now?");
 * - a preview that freezes a trigger state through `plugin.params`
 *   (held = blinder / blackout is a constant state by design);
 * - every expectation of the request passed (the caller asserted the
 *   state it wanted — a stuck-at-0 blackout check is not a problem).
 */
function intendedHold(req: ObserveRequest, durationS: number, triggerKeys: readonly string[], expectations: ReturnType<typeof evaluateExpectations>): string | null {
  if (durationS < SNAPSHOT_WINDOW_S) return `snapshot window (${durationS}s < ${SNAPSHOT_WINDOW_S}s)`;
  const frozen = triggerKeys.filter(k => req.plugin?.params && k in req.plugin.params);
  if (frozen.length > 0) return `frozen trigger state (${frozen.join(', ')})`;
  if (expectations.length > 0 && expectations.every(e => e.pass)) return 'all expectations passed';
  return null;
}

/**
 * Downgrades `observe-stuck` to info when the hold is intended (see
 * `intendedHold`); the issues stay in the JSON and the report's issues line.
 */
function relaxIntendedHolds(findings: Finding[], reason: string | null): Finding[] {
  if (!reason) return findings;
  return findings.map(f => (f.code === 'observe-stuck' && f.level === 'warning'
    ? { ...f, level: 'info', message: `${f.message} Expected here: ${reason}.` }
    : f));
}

// ── Observe ─────────────────────────────────────

/** Runs one observation (see module docs). Never throws for bad input: problems become findings. */
export async function observe(request: ObserveRequest, deps: ObserveDeps = {}): Promise<ObserveReport> {
  const parsed = ObserveRequestSchema.safeParse(request);
  if (!parsed.success) return failed([errorFinding('invalid-input', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))]);
  const req = parsed.data as ObserveRequest;

  const read = deps.read ?? readApi;
  const layout = deps.layout?.() ?? (useEngineStore().flatFixtures as Fixture[]);
  const bpm = read.bpm();
  const findings: Finding[] = [];
  const fps = req.fps ?? DEFAULT_FPS;
  const durationS = Math.min(parseTimeRef(req.window?.duration, bpm, DEFAULT_DURATION_S), MAX_FRAMES / fps);
  const fromS = parseTimeRef(req.window?.from, bpm, 0);
  const hasInstance = !!(req.modifierId || req.plugin);
  let mode = req.mode ?? (hasInstance ? 'preview' : 'live');
  if (mode === 'sim') {
    findings.push(infoFinding('observe-sim-unavailable', `mode "sim" is not implemented yet; using ${hasInstance ? 'preview' : 'live'}`));
    mode = hasInstance ? 'preview' : 'live';
  }
  if (mode === 'preview' && !hasInstance) return failed([errorFinding('invalid-input', 'preview needs `modifierId` or `plugin`')]);

  const resolved = resolveTargets(req.targets, { fixtures: layout, groups: read.groups(), selection: read.selection().fixtureIds });
  for (const id of resolved.unknown) findings.push(warningFinding('observe-unknown-target', `target "${id}" is neither a fixture nor a group`));
  const groupIds = (f: Fixture) => fixtureInfo(f).groupIds;
  const points = req.points?.map((p, i) => ({ key: `p${i}`, x: p.x, y: p.y }));

  let trace: Trace;
  /** Trigger param keys of the previewed plugin (frozen-state detection). */
  let triggerKeys: string[] = [];
  try {
    if (mode === 'preview') {
      const modifier = await previewInstance(req, read, resolved.fixtures, findings);
      if (!modifier) return failed(findings);
      const plugins = deps.plugins ?? { getManifest, loadWasm };
      triggerKeys = (plugins.getManifest(modifier.plugin)?.params ?? []).filter(p => p.type === 'trigger').map(p => p.key);
      trace = await renderPreview(
        { layout, targets: resolved.fixtures, modifier, bpm, fromS, durationS, fps, points, groupIds },
        plugins,
      );
    }
    else {
      const signature = pickSignature(resolved.fixtures, typeof req.targets === 'object' && !Array.isArray(req.targets) ? req.targets.signature : undefined);
      const wait = deps.wait ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
      if (fromS > 0) await wait(fromS * 1000); // live cannot look ahead: wait for the window start
      trace = await captureLive(
        { fixtures: resolved.fixtures, signature, durationS, fps, bpm, groupIds, wait, now: deps.now },
        deps.hub ?? liveHub,
      );
      if (points) trace.points = points;
    }
  }
  catch (err) {
    console.error('[observe] capture failed:', err);
    return failed([...findings, errorFinding('observe-failed', (err as Error).message)]);
  }

  trace.mirrorAxes = mirrorAxes(layout, req.mirror);
  const analysis = analyzeTrace(trace, { detail: req.detail, groups: resolved.groups });
  const expectations = evaluateExpectations(analysis.json, req.expect ?? []);
  findings.push(...relaxIntendedHolds(analysis.findings, intendedHold(req, durationS, triggerKeys, expectations)));
  const text = renderReport(trace, analysis.json, expectations, findings, { title: targetTitle(req, resolved), detail: req.detail });
  return { text, json: analysis.json as unknown as Record<string, unknown>, expectations, findings };
}
