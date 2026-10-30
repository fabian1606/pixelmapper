/**
 * Which signature(s) a `live` observation captures (WP-M item 1).
 *
 * A fixture with RGB and scalar channels offers several signatures; the
 * default pick (`pickSignature`: rgb → panTilt → scalar) reads RGB, so a
 * moving DIMMER (scalar) layer used to look `constant`. Without an
 * explicit `targets.signature`, the live capture therefore takes the
 * signatures of the modifiers that act on the observed fixtures, captures
 * all of them in one window, reports the moving one and names the others
 * in findings (see `index.ts`).
 */
import { infoFinding, type Finding } from '@pixelmapper/agent-kit';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ModifierInstance, Signature } from '~/utils/engine/types';
import { fixtureSignatures } from '~/utils/operations/read-api';
import type { ObservationJson } from './features';
import { temporalText } from './report';
import { pickSignature } from './targets';

// ── Stack ───────────────────────────────────────

/** Modifiers (strength > 0) whose targets include any of the observed fixtures. */
export function layersOn(modifiers: readonly ModifierInstance[], fixtures: readonly Fixture[]): ModifierInstance[] {
  const observed = new Set(fixtures.map(f => String(f.id)));
  return modifiers.filter(m => m.strength > 0 && (!m.targetFixtureIds || m.targetFixtureIds.some(id => observed.has(String(id)))));
}

/**
 * Speed clock shared by the layers of one signature: `beat` when every
 * layer runs in beat mode, `time` when none does, unknown when mixed.
 */
export function stackClock(layers: readonly ModifierInstance[], signature: Signature): 'beat' | 'time' | undefined {
  const modes = layers.filter(m => m.signature === signature).map(m => m.speed.mode);
  if (modes.length === 0) return undefined;
  if (modes.every(m => m === 'beat')) return 'beat';
  if (modes.every(m => m !== 'beat')) return 'time';
  return undefined;
}

// ── Plan ────────────────────────────────────────

/** Signatures to capture, in preference order (first = report when nothing moves). */
export interface LiveSignaturePlan {
  signatures: Signature[];
  /** Default pick without modifiers (`pickSignature`). */
  fallback: Signature;
  /** True when the signatures come from the modifier stack (not requested / default). */
  fromStack: boolean;
}

/**
 * Plans the live signatures. A requested signature wins. Otherwise the
 * signatures of the layers on the targets (that at least one target
 * offers), the default pick first when it is among them; no layers → the
 * default pick.
 */
export function planLiveSignatures(fixtures: readonly Fixture[], layers: readonly ModifierInstance[], requested?: string): LiveSignaturePlan {
  const fallback = pickSignature(fixtures);
  if (requested === 'rgb' || requested === 'panTilt' || requested === 'scalar') return { signatures: [requested], fallback, fromStack: false };
  const offered = new Set(fixtures.flatMap(fixtureSignatures));
  const stack: Signature[] = [];
  for (const m of layers) if (offered.has(m.signature) && !stack.includes(m.signature)) stack.push(m.signature);
  if (stack.length === 0) return { signatures: [fallback], fallback, fromStack: false };
  const ordered = stack.includes(fallback) ? [fallback, ...stack.filter(s => s !== fallback)] : stack;
  return { signatures: ordered, fallback, fromStack: true };
}

/** Index of the trace to report: the first whose group output moves, else 0. */
export function primaryIndex(analyses: readonly ObservationJson[]): number {
  const moving = analyses.findIndex(a => a.group.temporal.kind !== 'constant');
  return moving < 0 ? 0 : moving;
}

// ── Findings ────────────────────────────────────

/** `modifier ids` of the layers of one signature (max 4). */
function layerIds(layers: readonly ModifierInstance[], signature: Signature): string {
  const ids = layers.filter(m => m.signature === signature).map(m => m.id);
  return ids.slice(0, 4).join(', ') + (ids.length > 4 ? ', …' : '');
}

/**
 * Findings that explain the signature choice: which signature the report
 * shows and why, and one line per other captured signature with its
 * verdict, each naming the `signature` filter that observes it in detail.
 */
export function signatureFindings(plan: LiveSignaturePlan, layers: readonly ModifierInstance[], analyses: readonly ObservationJson[], primary: number): Finding[] {
  if (!plan.fromStack) return [];
  const findings: Finding[] = [];
  const shown = plan.signatures[primary]!;
  const hint = (s: Signature) => `pass \`signature: '${s}'\` in the targets filter (e.g. targets: { ids: [...], signature: '${s}' })`;
  if (shown !== plan.fallback || plan.signatures.length > 1) {
    findings.push(infoFinding(
      'observe-signature',
      `This report shows the ${shown} signature: a ${shown} modifier is active on these targets (${layerIds(layers, shown)}). To choose explicitly, ${hint(shown)}.`,
    ));
  }
  plan.signatures.forEach((s, i) => {
    if (i === primary) return;
    const group = analyses[i]?.group;
    const verdict = group ? `${temporalText(group.temporal)} · range ${group.range.min.toFixed(2)}–${group.range.max.toFixed(2)}` : 'no samples';
    findings.push(infoFinding(
      'observe-other-signature',
      `A ${s} modifier is also active on these targets (${layerIds(layers, s)}); ${s}: ${verdict}. To observe it in detail, ${hint(s)}.`,
    ));
  });
  return findings;
}
