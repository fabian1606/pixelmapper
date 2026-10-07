/**
 * Tests for the TS modifier model (plan P3.11): instance creation from
 * manifests, cloning, naming and the TYPE_MODIFIERS_BIN encoder.
 */
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { BUILTIN_ALIASES, builtinHash, cloneModifier, createModifier, modifierName } from './modifiers';
import { buildModifiersBin, TYPE_MODIFIERS_BIN } from '~/utils/connectors/binary-encoder';
import { getManifest } from '~/utils/plugins/plugin-store';

describe('modifier instances', () => {
  it('creates instances with manifest param defaults', () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.sequencer), { targetChannels: ['DIMMER'] });
    expect(m.signature).toBe('scalar');
    expect(m.params.patternType).toBe('split');
    expect(m.params.origin).toEqual({ x: 0.5, y: 0.5 });
    expect(m.targetChannels).toEqual(['DIMMER']);
  });

  it('rejects unknown plugins', () => {
    expect(() => createModifier('sha256:00')).toThrow();
  });

  it('clones deeply (also reactive proxies)', () => {
    const m = reactive(createModifier(builtinHash(BUILTIN_ALIASES.sequencer)));
    const c = cloneModifier(m);
    (c.params.origin as { x: number }).x = 0.9;
    expect((m.params.origin as { x: number }).x).toBe(0.5);
  });

  it('names instances by manifest name and first enum label', () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.sequencer), { params: { patternType: 'checkerboard' } });
    expect(modifierName(m)).toBe('Sequencer · Checkerboard');
  });
});

describe('buildModifiersBin', () => {
  it('encodes known plugins and builds the plugin table', () => {
    const wave = builtinHash(BUILTIN_ALIASES.waveform);
    const mods = [
      createModifier(wave, { targetChannels: ['DIMMER'] }),
      createModifier(wave, { targetChannels: ['RED'] }),
    ];
    const { packet, plugins } = buildModifiersBin(mods, [], getManifest);
    expect(plugins).toEqual([wave]);
    expect(packet[0]).toBe(0xaa);
    expect(packet[1]).toBe(0x55);
    expect(packet[2]).toBe(TYPE_MODIFIERS_BIN);
    // Payload: version 1, count 2.
    expect(packet[5]).toBe(1);
    expect(packet[6] | (packet[7]! << 8)).toBe(2);
  });

  it('skips instances whose manifest is unknown', () => {
    const m = { ...createModifier(builtinHash(BUILTIN_ALIASES.waveform)), plugin: 'sha256:missing' };
    const { packet, plugins } = buildModifiersBin([m], [], getManifest);
    expect(plugins).toEqual([]);
    expect(packet[6]).toBe(0);
  });
});
