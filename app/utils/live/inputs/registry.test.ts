/**
 * Input source registry: binding identity, labels and the read-only
 * hardware address of controller pads.
 */
import { describe, expect, it } from 'vitest';
import type { ControllerControl, ControllerDefinition } from '~/utils/controllers/types';
import { bindingKey, bindingLabel, getInputSource, learnPrompt, nativeInputLabel, registerInputSource } from './registry';

const PAD: ControllerControl = {
  id: 'pad-0-3',
  type: 'button',
  rect: { x: 0, y: 0, w: 1, h: 1 },
  input: { source: 'midi', address: { type: 'note', channel: 1, number: 3 } },
};

/** Minimal controller definition (only what the registry reads). */
const CONTROLLER = { key: 'test-pad', label: 'Test Pad', controls: [PAD] } as unknown as ControllerDefinition;

describe('input registry', () => {
  it('has the built-in key and MIDI sources', () => {
    expect(getInputSource('key')?.title).toBe('Key');
    expect(getInputSource('midi')?.title).toBe('MIDI');
  });

  it('identifies bindings by source and address, regardless of key order', () => {
    const a = { source: 'midi', address: { type: 'note', channel: 1, number: 36 } };
    const b = { source: 'midi', address: { number: 36, channel: 1, type: 'note' } };
    expect(bindingKey(a)).toBe(bindingKey(b));
    expect(bindingKey(a)).not.toBe(bindingKey({ ...a, source: 'other' }));
  });

  it('labels bindings, also from unknown sources', () => {
    expect(bindingLabel({ source: 'key', address: 'KeyB' })).toBe('Key · B');
    expect(bindingLabel({ source: 'midi', address: { type: 'cc', channel: 10, number: 7 } })).toBe('MIDI · CC 7 · Ch 10');
    expect(bindingLabel({ source: 'gone', address: 1 })).toBe('gone (unavailable)');
  });

  it('shows a controller pad its hardware address', () => {
    expect(nativeInputLabel(CONTROLLER, PAD)).toBe('Test Pad · Note 3 · Ch 1');
    expect(nativeInputLabel(CONTROLLER, { ...PAD, input: undefined })).toBe('Test Pad');
    expect(nativeInputLabel(null, PAD)).toBeNull();
  });

  it('builds the learn prompt from available sources, including new ones', () => {
    registerInputSource({
      id: 'deck',
      title: 'Deck',
      learnHint: 'press a deck key',
      isAvailable: () => true,
      format: a => String(a),
      listen: () => () => {},
    });
    expect(learnPrompt()).toMatch(/^Press a key.* or press a deck key…$/);
    expect(bindingLabel({ source: 'deck', address: 4 })).toBe('Deck · 4');
  });
});
