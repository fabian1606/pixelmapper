/**
 * Channel operation: `channels.set` (ADR 0002 §4.2).
 *
 * Writes the programmed (base) value of fixture channels — what the fixture
 * outputs before modifiers. Values are normalized 0–1 (→ DMX 0–255).
 */
import { z } from 'zod';
import type { Command } from '~/components/engine/composables/use-history';
import { createCoreCommandFactory } from '~/utils/extensions/core-command-factory';
import { defineCoreOperation } from '../define';
import type { CoreReadApi } from '../read-api';
import { FixtureIdSchema, fixtureNotFound } from './shared';

/** Parses `#rrggbb` into normalized RGB. */
function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** One channel write request. */
const WriteSchema = z.object({
  fixtureIds: z.array(FixtureIdSchema).min(1).describe('Fixtures to write (ids from fixtures.find).'),
  channelType: z.string().optional().describe('Channel type, e.g. "DIMMER", "RED", "WHITE", "PAN". Applies to every head\'s channel of that type.'),
  channelIndex: z.number().int().min(0).optional().describe('Exact channel index (fixtures.get shows indices). Alternative to channelType.'),
  value: z.number().min(0).max(1).optional().describe('Normalized value 0–1 (→ DMX 0–255).'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Shortcut for rgb fixtures: "#rrggbb" sets RED/GREEN/BLUE of every head.'),
});

/** DMX writes per channel index for one fixture. */
function writesFor(read: CoreReadApi, fixtureId: string | number, w: z.infer<typeof WriteSchema>): { channelIndex: number; value: number }[] {
  const detail = read.fixtureDetail(fixtureId);
  if (!detail) throw new Error(fixtureNotFound(fixtureId));
  const dmx = (v: number) => Math.round(v * 255);
  if (w.color) {
    const [r, g, b] = parseHex(w.color);
    const byType: Record<string, number> = { RED: r, GREEN: g, BLUE: b };
    const out = detail.channels.filter(c => !c.isFine && c.type in byType).map(c => ({ channelIndex: c.index, value: dmx(byType[c.type]!) }));
    if (out.length === 0) throw new Error(`fixture "${String(fixtureId)}" has no RGB channels`);
    return out;
  }
  if (w.value === undefined) throw new Error('channels.set needs `value` (0–1) or `color`');
  if (w.channelIndex !== undefined) {
    if (!detail.channels[w.channelIndex]) throw new Error(`fixture "${String(fixtureId)}" has no channel ${w.channelIndex}`);
    return [{ channelIndex: w.channelIndex, value: dmx(w.value) }];
  }
  if (!w.channelType) throw new Error('channels.set needs `channelType` or `channelIndex`');
  const out = detail.channels.filter(c => !c.isFine && c.type === w.channelType).map(c => ({ channelIndex: c.index, value: dmx(w.value!) }));
  if (out.length === 0) throw new Error(`fixture "${String(fixtureId)}" has no ${w.channelType} channel`);
  return out;
}

/** One channel write (`channels.set` entry). */
export type ChannelWrite = z.infer<typeof WriteSchema>;

/**
 * `SetChannelValues` commands for `writes`, merged into one command per
 * fixture (later writes win). Throws on unknown fixtures / channels.
 * Shared with `modifiers.add` / `update` (`color` sets the base color).
 */
export function channelWriteCommands(read: CoreReadApi, writes: readonly ChannelWrite[]): { commands: Command[]; written: number } {
  const perFixture = new Map<string | number, Map<number, number>>();
  for (const w of writes) {
    for (const raw of w.fixtureIds) {
      const id = read.fixtures().find(f => String(f.id) === String(raw))?.id;
      if (id === undefined) throw new Error(fixtureNotFound(raw));
      const map = perFixture.get(id) ?? new Map<number, number>();
      for (const { channelIndex, value } of writesFor(read, id, w)) map.set(channelIndex, value);
      perFixture.set(id, map);
    }
  }
  const factory = createCoreCommandFactory();
  const commands: Command[] = [];
  let written = 0;
  for (const [fixtureId, map] of perFixture) {
    const values = [...map].map(([channelIndex, value]) => ({ channelIndex, value }));
    written += values.length;
    commands.push(factory.setChannelValues({ fixtureId, values, description: 'Set channel values' }) as Command);
  }
  return { commands, written };
}

/** `channels.set`. */
export const channelsSet = defineCoreOperation({
  id: 'channels.set',
  kind: 'mutation',
  description: [
    'Set the programmed base value of fixture channels (the static look before modifiers). Values are normalized 0–1 (→ DMX 0–255).',
    'Address channels by `channelType` (all heads) or `channelIndex`; `color: "#rrggbb"` sets RED/GREEN/BLUE at once. Several writes in one call.',
    'Scale effects (Waveform, Noise, Sequencer chases/pulses) dim this programmed value: a fixture whose DIMMER or color base is 0 stays dark under them. For a colored effect, `modifiers.add { color: "#rrggbb" }` sets the base color (and a zero dimmer to full) in the same op.',
  ].join('\n'),
  input: z.object({ writes: z.array(WriteSchema).min(1) }),
  output: z.object({ written: z.number().int().describe('Number of channel values written.') }),
  produces: ['SetChannelValues'],
  examples: [
    { input: { writes: [{ fixtureIds: ['fx-1', 'fx-2'], channelType: 'DIMMER', value: 1 }] }, note: 'Full dimmer.' },
    { input: { writes: [{ fixtureIds: ['fx-1'], color: '#ff8000' }] }, note: 'Orange base color.' },
  ],
  run(ctx, input) {
    const { commands, written } = channelWriteCommands(ctx.read, input.writes);
    return { kind: 'mutation', commands, value: { written } };
  },
});

/** All channel operations. */
export const channelOperations = [channelsSet];
