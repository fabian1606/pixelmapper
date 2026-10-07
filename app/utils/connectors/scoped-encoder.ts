import type { Fixture } from '~/utils/engine/core/fixture';
import type { ModifierInstance, BlendMode } from '~/utils/engine/types';
import { buildLayoutBin, buildChannelsBin, buildModifiersBin, buildStripSlotsPacket } from './binary-encoder';
import { stripOf } from './strip-kind';
import { getManifest } from '~/utils/plugins/plugin-store';

// Builds binary packets scoped to a single fixture — used by the
// WebSocketConnector so each ESP32-S3 node only renders the DMX channels
// belonging to its assigned LED strip.
//
// Two things change compared to the full-scene encoder:
//  1. The fixture's `startAddress` is rebased to 1, so DMX indices on the
//     ESP32 start at 0 and its buffer stays small (engine resizes via
//     sync_layout).
//  2. Modifiers are filtered to those that target this fixture (or all
//     fixtures). Their `targetFixtureIds` is rewritten to the scoped
//     fixtures' ids so the bitmask in buildModifiersBin selects them.
// The blend mode argument is unused (blend modes are per modifier instance);
// on-device rendering is replaced by streamed frames in plan P6.2.

export interface ScopedPackets {
  layoutPacket:    Uint8Array;
  channelsPacket:  Uint8Array;
  effectsPacket:   Uint8Array;
  stripSlotsPacket?: Uint8Array;
}

export interface FixtureSlotInput {
  fixture: Fixture;
  pin: number | null;
  /** Start-LED-Index dieses Strips auf dem (ggf. geteilten) Pin. Default 0. */
  ledOffset?: number;
}

function effectTargetsFixture(effect: ModifierInstance, fixtureId: string | number): boolean {
  // Empty/missing targetFixtureIds means "all fixtures"
  if (!effect.targetFixtureIds || effect.targetFixtureIds.length === 0) return true;
  return effect.targetFixtureIds.includes(fixtureId);
}

export function buildScopedPackets(
  fixture: Fixture,
  allEffects: ModifierInstance[],
  _blendMode: BlendMode,
): ScopedPackets {
  // Shallow-clone the fixture and rebase its startAddress. Channels keep their
  // addressOffset; the encoder computes dmx_index = startAddress - 1 + addressOffset,
  // so dmx_index will start at addressOffset (usually 0).
  const scopedFixture: Fixture = Object.assign(
    Object.create(Object.getPrototypeOf(fixture)),
    fixture,
    { startAddress: 1 },
  );

  const scopedEffects: ModifierInstance[] = allEffects
    .filter(fx => effectTargetsFixture(fx, fixture.id))
    .map(fx => ({
      ...fx,
      // Rewrite to the scoped fixture's id so buildEffectsBin's idToIndex map
      // resolves to index 0 (the only fixture in the scope).
      targetFixtureIds: [scopedFixture.id],
    }));

  return {
    layoutPacket:   buildLayoutBin([scopedFixture]),
    channelsPacket: buildChannelsBin([scopedFixture]),
    effectsPacket:  buildModifiersBin(scopedEffects, [scopedFixture], getManifest).packet,
  };
}

/**
 * Build packets for an ESP32 that drives multiple LED strips on different GPIO
 * pins. Fixtures are rebased sequentially so their DMX indices are contiguous
 * starting at 0. A TYPE_STRIP_SLOTS packet is included so the firmware knows
 * which pin to drive for each LED range.
 */
export function buildMultiScopedPackets(
  slots: FixtureSlotInput[],
  allEffects: ModifierInstance[],
  _blendMode: BlendMode,
): ScopedPackets {
  // Rebase each fixture so its DMX indices follow on from the previous slot.
  let nextStart = 1;
  const scopedFixtures: Fixture[] = slots.map(({ fixture }) => {
    const span = fixture.channels.reduce(
      (max, ch) => Math.max(max, ch.addressOffset + 1), 0,
    );
    const rebased: Fixture = Object.assign(
      Object.create(Object.getPrototypeOf(fixture)),
      fixture,
      { startAddress: nextStart },
    );
    nextStart += span;
    return rebased;
  });

  const allScopedFixtures = scopedFixtures;

  // Effects that target at least one fixture in this scope.
  const sourceFixtureIds = slots.map(s => s.fixture.id);
  const scopedEffects: ModifierInstance[] = allEffects
    .filter(fx => sourceFixtureIds.some(id => effectTargetsFixture(fx, id)))
    .map(fx => ({
      ...fx,
      targetFixtureIds: allScopedFixtures
        .filter((_, i) => effectTargetsFixture(fx, sourceFixtureIds[i]!))
        .map(f => f.id),
    }));

  const stripSlotsPacket = buildStripSlotsPacket(
    slots.map((s, i) => {
      const sc = stripOf(scopedFixtures[i]);
      return {
        pin:          s.pin ?? 0,
        chipType:     sc?.chipType     ?? 'WS2812B',
        ledCount:     sc?.ledCount     ?? 0,
        groupSize:    sc?.groupSize    ?? 1,
        ledsPerMeter: sc?.ledsPerMeter ?? 60,
        ledOffset:    Math.max(0, Math.round(s.ledOffset ?? 0)),
      };
    }),
  );

  return {
    layoutPacket:    buildLayoutBin(allScopedFixtures),
    channelsPacket:  buildChannelsBin(allScopedFixtures),
    effectsPacket:   buildModifiersBin(scopedEffects, allScopedFixtures, getManifest).packet,
    stripSlotsPacket,
  };
}

/**
 * Cheap fingerprint over the scoped inputs. Used by the connector to skip
 * rebuilding/sending unchanged packets without doing the full encode.
 */
export function scopedFingerprint(
  fixture: Fixture,
  allEffects: ModifierInstance[],
  blendMode: BlendMode,
): { layout: string; channels: string; effects: string } {
  let layout = `${fixture.id};${fixture.fixturePosition.x};${fixture.fixturePosition.y};${fixture.rotation ?? 0};${fixture.fixtureSize.x};${fixture.fixtureSize.y};`;
  // Kind geometry (e.g. strip curves) changes beam positions.
  if (fixture.kind) layout += `k${JSON.stringify(fixture.kind.config)};`;
  let channels = '';
  for (const ch of fixture.channels) {
    layout   += `${ch.addressOffset};${ch.type};${ch.beamId ?? ''};`;
    const cc = ch.chaserConfig;
    channels += `${cc.stepsCount}:${cc.isPlaying ? 1 : 0}:${cc.activeEditStep}:`;
    channels += `${cc.stepDuration.mode}|${cc.stepDuration.timeMs}|${cc.stepDuration.beatValue}|${cc.stepDuration.beatOffset};`;
    channels += `${cc.fadeDuration.mode}|${cc.fadeDuration.timeMs}|${cc.fadeDuration.beatValue}|${cc.fadeDuration.beatOffset};`;
    channels += cc.stepValues.slice(0, cc.stepsCount).join(',') + '|';
  }

  let effects = '';
  for (const fx of allEffects) {
    if (!effectTargetsFixture(fx, fixture.id)) continue;
    effects += `${JSON.stringify(fx)}|`;
  }

  return { layout, channels, effects };
}

/** Fingerprint for multi-slot connections. */
export function multiScopedFingerprint(
  slots: FixtureSlotInput[],
  allEffects: ModifierInstance[],
  blendMode: BlendMode,
): { layout: string; channels: string; effects: string; strip: string } {
  let strip = '';
  let combined = { layout: '', channels: '', effects: '' };
  for (const { fixture, pin, ledOffset } of slots) {
    const fp = scopedFingerprint(fixture, allEffects, blendMode);
    combined.layout   += fp.layout   + '|';
    combined.channels += fp.channels + '|';
    combined.effects   = fp.effects; // blendMode-part same; last one wins, effects accumulate per slot below
    const sc = stripOf(fixture);
    strip += `${fixture.id}:pin${pin ?? 0}:off${ledOffset ?? 0}:${sc?.chipType}:${sc?.ledCount}:${sc?.groupSize}:${sc?.ledsPerMeter}|`;
  }
  // Rebuild effects fingerprint across all slots
  const sourceFixtures = slots.map(s => s.fixture);
  let effects = '';
  for (const fx of allEffects) {
    if (!sourceFixtures.some(f => effectTargetsFixture(fx, f.id))) continue;
    effects += `${JSON.stringify(fx)}|`;
  }
  return { layout: combined.layout, channels: combined.channels, effects, strip };
}
