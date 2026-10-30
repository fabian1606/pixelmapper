/**
 * Mode changes of fixtures created from a definition (plan M4.3).
 *
 * Builds `SetFixtureModeCommand`s (shared by the inspector's Mode select and
 * the extension API `commands.setFixtureMode`) and lists the modes of a
 * fixture's definition.
 */
import { reactive } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';
import type { SceneNode } from '~/utils/engine/core/group';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import {
  SetFixtureModeCommand,
  captureModeState,
} from '~/components/engine/commands/set-fixture-mode-command';
import { createFixtureFromDefinition, resolveFixtureDefinition, type ResolvedDefinition } from './resolve-definition';

/** One selectable mode of a definition. */
export interface FixtureModeOption {
  /** 0-based mode index. */
  index: number;
  name: string;
  /** Channel count of the mode (matrix inserts expanded). */
  channelCount: number;
}

/**
 * The definition a fixture was built from: the in-session `definition` when
 * present (same key), otherwise resolved by `source.key`. `null` for fixtures
 * without a source or when the definition is unavailable.
 */
export async function definitionOfFixture(fixture: Fixture): Promise<ResolvedDefinition | null> {
  const key = fixture.source?.key;
  if (!key) return null;
  if (fixture.definition) return { key, definition: fixture.definition, manufacturer: fixture.manufacturer };
  return resolveFixtureDefinition(key);
}

/** Modes of a fixture's definition, or `null` when unknown. */
export async function listFixtureModes(fixture: Fixture): Promise<FixtureModeOption[] | null> {
  const resolved = await definitionOfFixture(fixture);
  if (!resolved) return null;
  return resolved.definition.modes.map((mode, index) => {
    let channelCount = mode.channels.length;
    try { channelCount = createFixtureFromOfl(resolved.definition, index).channels.length; }
    catch (err) { console.warn(`[fixture-mode] could not build mode ${index} of "${resolved.key}":`, err); }
    return { index, name: mode.name, channelCount };
  });
}

/** Deep copy of a channel's chaser config (reactive, like freshly built channels). */
function cloneChaser(config: Channel['chaserConfig']): Channel['chaserConfig'] {
  return config ? reactive(JSON.parse(JSON.stringify(config))) : config;
}

/**
 * Carries programmed values from the old channels to the new ones: the k-th
 * channel of a type on a head keeps the chaser config and output range of
 * the k-th channel of the same type on the same head.
 */
export function carryChannelValues(oldChannels: readonly Channel[], newChannels: Channel[]): void {
  const bucketKey = (c: Channel) => `${c.beamId ?? ''}|${c.type}|${c.isFine ? 'f' : 'c'}`;
  const buckets = new Map<string, Channel[]>();
  for (const c of oldChannels) {
    const key = bucketKey(c);
    buckets.set(key, [...(buckets.get(key) ?? []), c]);
  }
  for (const c of newChannels) {
    const match = buckets.get(bucketKey(c))?.shift();
    if (!match) continue;
    c.chaserConfig = cloneChaser(match.chaserConfig);
    c.rangeMin = match.rangeMin;
    c.rangeMax = match.rangeMax;
  }
}

/**
 * Builds the command switching `fixture` to `modeIndex` of its definition.
 * Throws when the fixture has no known source, the definition cannot be
 * loaded or the mode does not exist.
 */
export async function buildSetFixtureModeCommand(
  sceneNodes: readonly SceneNode[],
  fixture: Fixture,
  modeIndex: number,
): Promise<SetFixtureModeCommand> {
  if (!fixture.source) throw new Error(`fixture "${String(fixture.id)}" has no known definition (no source)`);
  const resolved = await definitionOfFixture(fixture);
  if (!resolved) throw new Error(`definition "${fixture.source.key}" of fixture "${String(fixture.id)}" is not available`);
  const built = createFixtureFromDefinition(resolved, modeIndex);
  carryChannelValues(fixture.channels, built.channels);
  const modeName = resolved.definition.modes[modeIndex]?.name ?? String(modeIndex);
  return new SetFixtureModeCommand(
    sceneNodes,
    fixture.id,
    captureModeState(fixture),
    {
      channels: built.channels,
      beams: built.beams,
      source: built.source,
      definition: resolved.definition,
      lensDegreesMinMax: built.lensDegreesMinMax,
    },
    `Set mode of ${fixture.name} to ${modeName}`,
  );
}
