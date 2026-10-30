/**
 * `color` option of `modifiers.add` / `modifiers.update` (WP-L item 1).
 *
 * Scalar effects (Waveform, Noise, Sequencer: chases, pulses, flicker) dim
 * the programmed base value of the targets; their color is the fixtures'
 * base color. `color: "#rrggbb"` sets that base color in the same op, so
 * "a slow blue chase" is ONE `modifiers.add`. A DIMMER base of 0 on those
 * fixtures is raised to full, otherwise the colored effect stays dark.
 * Implemented with the `channels.set` command factory (`channelWriteCommands`).
 */
import { z } from 'zod';
import type { Command } from '~/components/engine/composables/use-history';
import type { CoreReadApi } from '../read-api';
import { channelWriteCommands, type ChannelWrite } from './channels';

/** `#rrggbb` base color input. */
export const BaseColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use "#rrggbb"')
  .describe('Base color "#rrggbb" of the targets (their programmed RED/GREEN/BLUE, the color a scalar effect such as a Waveform chase or pulse dims). Also raises a DIMMER base of 0 to full on those fixtures. E.g. "#0000ff" with plugin waveform, recipe chase = a blue chase.');

/** What the color option wrote (reported in the op output). */
export interface BaseColorResult {
  color: string;
  /** Fixtures whose RGB base was set. */
  fixtureIds: string[];
  /** Fixtures whose DIMMER base was 0 and is now full. */
  dimmerRaised: string[];
}

/**
 * Commands that set the base color of the target fixtures that have RGB
 * channels (and raise a zero DIMMER). Throws when no target has RGB.
 */
export function baseColorCommands(read: CoreReadApi, targetIds: readonly (string | number)[], color: string): { commands: Command[]; result: BaseColorResult } {
  const rgb: (string | number)[] = [];
  const zeroDimmer: (string | number)[] = [];
  for (const id of targetIds) {
    const channels = (read.fixtureDetail(id)?.channels ?? []).filter(c => !c.isFine);
    const types = new Set(channels.map(c => c.type));
    if (!(types.has('RED') && types.has('GREEN') && types.has('BLUE'))) continue;
    rgb.push(id);
    const dimmers = channels.filter(c => c.type === 'DIMMER');
    if (dimmers.length && dimmers.every(c => c.value === 0)) zeroDimmer.push(id);
  }
  if (rgb.length === 0) throw new Error('`color` needs targets with RED/GREEN/BLUE channels; none of the targets has them');
  const writes: ChannelWrite[] = [{ fixtureIds: rgb, color }];
  if (zeroDimmer.length) writes.push({ fixtureIds: zeroDimmer, channelType: 'DIMMER', value: 1 });
  const { commands } = channelWriteCommands(read, writes);
  return { commands, result: { color: color.toLowerCase(), fixtureIds: rgb.map(String), dimmerRaised: zeroDimmer.map(String) } };
}
