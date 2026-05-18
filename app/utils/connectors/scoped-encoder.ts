import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect, BlendMode } from '~/utils/engine/types';
import { buildLayoutBin, buildChannelsBin, buildEffectsBin } from './binary-encoder';

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
  layoutPacket:   Uint8Array;
  channelsPacket: Uint8Array;
  effectsPacket:  Uint8Array;
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
    effects += `${wf}:${wp.param}:${wp.start}:${wp.end}:${wp.startLevel}:${wp.endLevel};`;
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
