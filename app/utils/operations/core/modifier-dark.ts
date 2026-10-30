/**
 * Dark-base check of a modifier (WP-L item 2).
 *
 * Only `absolute` outputs set channel values themselves. `scale` (Waveform,
 * Noise, Sequencer chases and pulses) and `bipolar` outputs are a fraction /
 * modulation of the programmed base value, and blend `multiply` multiplies
 * with the layers below. On a fixture whose DIMMER base is 0, or whose color
 * base is black, such a modifier stays dark — silently, unless we say so.
 *
 * `darkTargetFindings` returns one `dark-base` warning per cause with a
 * ready-to-copy fix (`channels.set` or the `color` option of
 * `modifiers.add`). Used by the `modifiers.*` end-of-batch verification and
 * by `observe`.
 */
import type { Finding } from '@pixelmapper/agent-kit';
import type { ChannelView } from '@pixelmapper/extension-api';
import type { ModifierInstance } from '~/utils/engine/types';
import { getManifest } from '~/utils/plugins/plugin-store';
import type { CoreReadApi } from '../read-api';
import { offers, targetFixtures } from './modifier-build';

// ── Channel classes ─────────────────────────────

/** Additive light-emitting color channels (black = all of them at 0). */
const EMITTERS = new Set(['RED', 'GREEN', 'BLUE', 'WHITE', 'WARM_WHITE', 'COOL_WHITE', 'AMBER', 'UV', 'LIME', 'INDIGO']);
/** Color systems the black check cannot judge (subtractive / wheels). */
const OTHER_COLOR = new Set(['CYAN', 'MAGENTA', 'YELLOW', 'COLOR_WHEEL', 'COLOR_PRESET']);

/** Max fixture ids named in a message (the fix JSON lists all). */
const MAX_NAMED = 6;

// ── Helpers ─────────────────────────────────────

/** True when the instance's output lights the driven channels by itself. */
function setsOwnValue(m: ModifierInstance): boolean {
  const output = getManifest(m.plugin)?.output;
  return output === 'absolute' && m.blendMode !== 'multiply';
}

/** True when `m` drives the color (rgb) or the given scalar channel type. */
function drives(m: ModifierInstance, kind: 'DIMMER' | 'color'): boolean {
  if (kind === 'color') return m.signature === 'rgb';
  return m.signature === 'scalar' && m.targetChannels.includes('DIMMER');
}

/** True when `m` targets fixture `id`. */
function targetsFixture(m: ModifierInstance, id: string | number): boolean {
  return !m.targetFixtureIds || m.targetFixtureIds.some(t => String(t) === String(id));
}

/** Short id list for messages. */
function named(ids: readonly string[]): string {
  return ids.length <= MAX_NAMED ? ids.join(', ') : `${ids.slice(0, MAX_NAMED).join(', ')}, … (${ids.length} fixtures)`;
}

/** Non-fine channels of a fixture (empty when unknown). */
function channelsOf(read: CoreReadApi, id: string | number): ChannelView[] {
  return (read.fixtureDetail(id)?.channels ?? []).filter(c => !c.isFine);
}

// ── Check ───────────────────────────────────────

/**
 * `dark-base` warnings for the target fixtures of `m` that stay dark under
 * it: DIMMER base 0, or an all-zero (black) color base — unless `m` itself
 * (absolute output) or a layer below it in `stack` sets that channel.
 */
export function darkTargetFindings(read: CoreReadApi, m: ModifierInstance, stack: readonly ModifierInstance[] = read.modifiers()): Finding[] {
  const manifest = getManifest(m.plugin);
  if (!manifest || m.signature === 'panTilt') return [];
  const below = stack.slice(0, Math.max(0, stack.findIndex(x => x.id === m.id)));
  /** `kind` is lit by `m` itself or an absolute layer below for fixture `id`. */
  const litByLayer = (id: string | number, kind: 'DIMMER' | 'color') =>
    (drives(m, kind) && setsOwnValue(m)) || below.some(x => targetsFixture(x, id) && drives(x, kind) && setsOwnValue(x));

  const dimmerZero: string[] = [];
  const colorBlack: string[] = [];
  for (const f of targetFixtures(read, m.targetFixtureIds)) {
    if (!offers(f, m.signature, m.targetChannels)) continue;
    const channels = channelsOf(read, f.id);
    const dimmers = channels.filter(c => c.type === 'DIMMER');
    if (dimmers.length && dimmers.every(c => c.value === 0) && !litByLayer(f.id, 'DIMMER')) dimmerZero.push(String(f.id));
    const colors = channels.filter(c => EMITTERS.has(c.type));
    const judgeable = colors.length > 0 && !channels.some(c => OTHER_COLOR.has(c.type));
    if (judgeable && colors.every(c => c.value === 0) && !litByLayer(f.id, 'color')) colorBlack.push(String(f.id));
  }

  const why = setsOwnValue(m)
    ? `"${manifest.name}" sets only its own channels`
    : m.blendMode === 'multiply'
      ? `blend "multiply" multiplies with the value below`
      : `"${manifest.name}" has ${manifest.output} output (a fraction of the programmed base value)`;
  const out: Finding[] = [];
  const entityIds = [`modifier:${m.id}`];
  if (dimmerZero.length) {
    const fix = JSON.stringify({ op: 'channels.set', input: { writes: [{ fixtureIds: dimmerZero, channelType: 'DIMMER', value: 1 }] } });
    out.push({
      level: 'warning', code: 'dark-base', entityIds,
      message: `stays dark on ${named(dimmerZero)}: their DIMMER base is 0 and ${why}. Set the dimmer first: ${fix} (or pass "color": "#rrggbb" to modifiers.add/update, which also raises a zero dimmer to full).`,
    });
  }
  if (colorBlack.length) {
    const fix = JSON.stringify({ op: 'channels.set', input: { writes: [{ fixtureIds: colorBlack, color: '#ffffff' }] } });
    out.push({
      level: 'warning', code: 'dark-base', entityIds,
      message: `stays dark on ${named(colorBlack)}: their color base is black (all color channels 0) and ${why}. Set the color first: ${fix} (or pass "color": "#rrggbb" to modifiers.add/update).`,
    });
  }
  return out;
}
