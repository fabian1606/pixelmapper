import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect, BlendMode } from '~/utils/engine/types';
import { buildLayoutBin, buildChannelsBin, buildEffectsBin, buildStripSlotsPacket } from './binary-encoder';

// Builds binary packets scoped to a single fixture — used by the
// WebSocketConnector so each ESP32-S3 node only renders the DMX channels
// belonging to its assigned LED strip.
//
// Two things change compared to the full-scene encoder:
//  1. The fixture's `startAddress` is rebased to 1, so DMX indices on the
//     ESP32 start at 0 and its buffer stays small (engine resizes via
//     sync_layout).
//  2. Effects are filtered to those that target this fixture (or all
//     fixtures). Their `targetFixtureIds` is rewritten to the single scoped
//     fixture's id so the bitmask in buildEffectsBin selects bit 0.

export interface ScopedPackets {
  layoutPacket:    Uint8Array;
  channelsPacket:  Uint8Array;
  effectsPacket:   Uint8Array;
  stripSlotsPacket?: Uint8Array;
  /** When an extraFixture (ESP-NOW broadcast) was included, this describes
   *  where the firmware should read its R/G/B/Dimmer bytes in the DMX buffer. */
  espNowLayout?: { dmxStart: number; rIdx: number; gIdx: number; bIdx: number; dimIdx: number };
}

export interface FixtureSlotInput {
  fixture: Fixture;
  pin: number | null;
}

function effectTargetsFixture(effect: Effect, fixtureId: string | number): boolean {
  // Empty/missing targetFixtureIds means "all fixtures"
  if (!effect.targetFixtureIds || effect.targetFixtureIds.length === 0) return true;
  return effect.targetFixtureIds.includes(fixtureId);
}

export function buildScopedPackets(
  fixture: Fixture,
  allEffects: Effect[],
  blendMode: BlendMode,
): ScopedPackets {
  // Shallow-clone the fixture and rebase its startAddress. Channels keep their
  // addressOffset; the encoder computes dmx_index = startAddress - 1 + addressOffset,
  // so dmx_index will start at addressOffset (usually 0).
  const scopedFixture: Fixture = Object.assign(
    Object.create(Object.getPrototypeOf(fixture)),
    fixture,
    { startAddress: 1 },
  );

  const scopedEffects: Effect[] = allEffects
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
    effectsPacket:  buildEffectsBin(scopedEffects, [scopedFixture], blendMode),
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
  allEffects: Effect[],
  blendMode: BlendMode,
  extraFixture: Fixture | null = null,
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

  // Append the ESP-NOW broadcast fixture (non-strip) after the strip slots.
  // It participates in layout/channels/effects so the engine renders it, but
  // it is NOT added to stripSlotsPacket — no GPIO, no LED strip.
  let scopedExtra: Fixture | null = null;
  let espNowLayout: ScopedPackets['espNowLayout'] | undefined;
  if (extraFixture) {
    const span = extraFixture.channels.reduce(
      (max, ch) => Math.max(max, ch.addressOffset + 1), 0,
    );
    scopedExtra = Object.assign(
      Object.create(Object.getPrototypeOf(extraFixture)),
      extraFixture,
      { startAddress: nextStart },
    );
    const dmxStart = nextStart - 1; // 0-based
    const findOffset = (type: string) =>
      extraFixture.channels.find(c => c.type === type)?.addressOffset ?? 0;
    espNowLayout = {
      dmxStart,
      rIdx:   findOffset('RED'),
      gIdx:   findOffset('GREEN'),
      bIdx:   findOffset('BLUE'),
      dimIdx: findOffset('DIMMER'),
    };
    nextStart += span;
  }

  const allScopedFixtures = scopedExtra ? [...scopedFixtures, scopedExtra] : scopedFixtures;

  // Effects that target at least one fixture in this scope (slots OR extra).
  const sourceFixtureIds = [
    ...slots.map(s => s.fixture.id),
    ...(extraFixture ? [extraFixture.id] : []),
  ];
  const scopedEffects: Effect[] = allEffects
    .filter(fx => sourceFixtureIds.some(id => effectTargetsFixture(fx, id)))
    .map(fx => ({
      ...fx,
      targetFixtureIds: allScopedFixtures
        .filter((_, i) => effectTargetsFixture(fx, sourceFixtureIds[i]!))
        .map(f => f.id),
    }));

  const stripSlotsPacket = buildStripSlotsPacket(
    slots.map((s, i) => {
      const sc = scopedFixtures[i]!.stripConfig;
      return {
        pin:          s.pin ?? 0,
        chipType:     sc?.chipType     ?? 'WS2812B',
        ledCount:     sc?.ledCount     ?? 0,
        groupSize:    sc?.groupSize    ?? 1,
        ledsPerMeter: sc?.ledsPerMeter ?? 60,
      };
    }),
  );

  return {
    layoutPacket:    buildLayoutBin(allScopedFixtures),
    channelsPacket:  buildChannelsBin(allScopedFixtures),
    effectsPacket:   buildEffectsBin(scopedEffects, allScopedFixtures, blendMode),
    stripSlotsPacket,
    espNowLayout,
  };
}

/**
 * Cheap fingerprint over the scoped inputs. Used by the connector to skip
 * rebuilding/sending unchanged packets without doing the full encode.
 */
export function scopedFingerprint(
  fixture: Fixture,
  allEffects: Effect[],
  blendMode: BlendMode,
): { layout: string; channels: string; effects: string } {
  let layout = `${fixture.id};${fixture.fixturePosition.x};${fixture.fixturePosition.y};${fixture.rotation ?? 0};${fixture.fixtureSize.x};${fixture.fixtureSize.y};`;
  if (fixture.stripConfig) {
    layout += `s${fixture.stripConfig.lengthMeters}:${fixture.stripConfig.ledCount}:${fixture.stripConfig.groupSize}:`;
    for (const p of fixture.stripConfig.points) layout += `${p.x},${p.y};`;
  }
  let channels = '';
  for (const ch of fixture.channels) {
    layout   += `${ch.addressOffset};${ch.type};${ch.beamId ?? ''};`;
    const cc = ch.chaserConfig;
    channels += `${cc.stepsCount}:${cc.isPlaying ? 1 : 0}:${cc.activeEditStep}:`;
    channels += `${cc.stepDuration.mode}|${cc.stepDuration.timeMs}|${cc.stepDuration.beatValue}|${cc.stepDuration.beatOffset};`;
    channels += `${cc.fadeDuration.mode}|${cc.fadeDuration.timeMs}|${cc.fadeDuration.beatValue}|${cc.fadeDuration.beatOffset};`;
    channels += cc.stepValues.slice(0, cc.stepsCount).join(',') + '|';
  }

  let effects = blendMode + '|';
  for (const fx of allEffects) {
    if (!effectTargetsFixture(fx, fixture.id)) continue;
    effects += `${fx.id}:${fx.targetChannels?.join(',') ?? ''}:${fx.direction}:${fx.originX}:${fx.originY}:${fx.angle}:${fx.strength}:${fx.reverse ? 1 : 0}:${fx.fanning}:`;
    effects += `${fx.speed?.mode}|${fx.speed?.timeMs}|${fx.speed?.beatValue}|${fx.speed?.beatOffset};`;
    const wf = (fx as any).waveformShape;
    const wp = (fx as any).waveformParams ?? {};
    effects += `${wf}:${wp.param}:${wp.start}:${wp.end}:${wp.offset};`;
    const np = (fx as any).noiseParams;
    if (np) effects += `n:${np.noiseType}:${np.scale}:${np.channelMode}:${np.colorVariation}:${np.fade}:${np.threshold};`;
    const sp = (fx as any).sequencerParams;
    if (sp) effects += `s:${sp.patternType}:${sp.originX}:${sp.originY}:${sp.angle}:${sp.scale}:${sp.count}:${sp.density}:${sp.densityVariation}:${sp.invert ? 1 : 0};`;
    const cp = (fx as any).colorParams;
    if (cp) effects += `c:${cp.hueShift}:${cp.saturation}:${cp.hueRange}:${cp.satRange};`;
    effects += '|';
  }

  return { layout, channels, effects };
}

/** Fingerprint for multi-slot connections. */
export function multiScopedFingerprint(
  slots: FixtureSlotInput[],
  allEffects: Effect[],
  blendMode: BlendMode,
  extraFixture: Fixture | null = null,
): { layout: string; channels: string; effects: string; strip: string; espNow: string } {
  let strip = '';
  let combined = { layout: '', channels: '', effects: '' };
  for (const { fixture, pin } of slots) {
    const fp = scopedFingerprint(fixture, allEffects, blendMode);
    combined.layout   += fp.layout   + '|';
    combined.channels += fp.channels + '|';
    combined.effects   = fp.effects; // blendMode-part same; last one wins, effects accumulate per slot below
    strip += `${fixture.id}:pin${pin ?? 0}:${fixture.stripConfig?.chipType}:${fixture.stripConfig?.ledCount}:${fixture.stripConfig?.groupSize}:${fixture.stripConfig?.ledsPerMeter}|`;
  }
  let espNow = '';
  if (extraFixture) {
    const fp = scopedFingerprint(extraFixture, allEffects, blendMode);
    combined.layout   += fp.layout   + '|';
    combined.channels += fp.channels + '|';
    // dmxStart depends on strip channel counts → fold those into the fingerprint
    let totalStripChannels = 0;
    for (const { fixture } of slots) {
      totalStripChannels += fixture.channels.reduce((max, ch) => Math.max(max, ch.addressOffset + 1), 0);
    }
    espNow = `${extraFixture.id}:start${totalStripChannels}`;
  }
  // Rebuild effects fingerprint across all slots + extra
  const sourceFixtures = [
    ...slots.map(s => s.fixture),
    ...(extraFixture ? [extraFixture] : []),
  ];
  let effects = blendMode + '|';
  for (const fx of allEffects) {
    if (!sourceFixtures.some(f => effectTargetsFixture(fx, f.id))) continue;
    effects += `${fx.id}:${fx.targetChannels?.join(',') ?? ''}:${fx.direction}:${fx.originX}:${fx.originY}:${fx.angle}:${fx.strength}:${fx.reverse ? 1 : 0}:${fx.fanning}:`;
    effects += `${fx.speed?.mode}|${fx.speed?.timeMs}|${fx.speed?.beatValue}|${fx.speed?.beatOffset};`;
    const wf = (fx as any).waveformShape;
    const wp = (fx as any).waveformParams ?? {};
    effects += `${wf}:${wp.param}:${wp.start}:${wp.end}:${wp.offset};`;
    const np = (fx as any).noiseParams;
    if (np) effects += `n:${np.noiseType}:${np.scale}:${np.channelMode}:${np.colorVariation}:${np.fade}:${np.threshold};`;
    const sp = (fx as any).sequencerParams;
    if (sp) effects += `s:${sp.patternType}:${sp.originX}:${sp.originY}:${sp.angle}:${sp.scale}:${sp.count}:${sp.density}:${sp.densityVariation}:${sp.invert ? 1 : 0};`;
    const cp = (fx as any).colorParams;
    if (cp) effects += `c:${cp.hueShift}:${cp.saturation}:${cp.hueRange}:${cp.satRange};`;
    effects += '|';
  }
  return { layout: combined.layout, channels: combined.channels, effects, strip, espNow };
}
