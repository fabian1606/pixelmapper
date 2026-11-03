// Tests for key bindings and the shortcut override store.
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingFromEvent, formatBinding, matchesBinding } from '~/utils/shortcuts/key-binding';
import { assignBinding, getBindings, isCustomized, resetBindings, setBindings } from '~/composables/use-shortcut-bindings';

/** A keydown with the given key and modifiers. */
function key(k: string, mods: Partial<Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>> = {}) {
  return new KeyboardEvent('keydown', { key: k, ...mods });
}

describe('key-binding', () => {
  it('matches ⌘ and Ctrl as mod, with exact modifiers', () => {
    const b = { key: 'z', mod: true };
    expect(matchesBinding(key('z', { metaKey: true }), b)).toBe(true);
    expect(matchesBinding(key('z', { ctrlKey: true }), b)).toBe(true);
    expect(matchesBinding(key('Z', { metaKey: true, shiftKey: true }), b)).toBe(false);
    expect(matchesBinding(key('z'), b)).toBe(false);
  });

  it('records shifted letters lowercase and ignores lone modifiers', () => {
    expect(bindingFromEvent(key('P', { shiftKey: true }))).toEqual({ key: 'p', shift: true });
    expect(bindingFromEvent(key('Shift', { shiftKey: true }))).toBeNull();
  });

  it('formats for macOS and other systems', () => {
    expect(formatBinding({ key: 'g', mod: true, shift: true }, true)).toBe('⇧⌘G');
    expect(formatBinding({ key: 'g', mod: true, shift: true }, false)).toBe('Ctrl+Shift+G');
    expect(formatBinding({ key: 'Backspace' }, true)).toBe('⌫');
  });
});

describe('shortcut bindings', () => {
  beforeEach(() => resetBindings());

  it('starts with the registry defaults', () => {
    expect(getBindings('edit.delete')).toEqual([{ key: 'Backspace' }, { key: 'Delete' }]);
    expect(isCustomized('edit.delete')).toBe(false);
  });

  it('replaces a binding at an index and persists it', () => {
    assignBinding('design.savePreset', { key: 'n', shift: true }, 0);
    expect(getBindings('design.savePreset')).toEqual([{ key: 'n', shift: true }]);
    expect(JSON.parse(localStorage.getItem('pm.shortcuts.v1')!)).toHaveProperty('design.savePreset');
  });

  it('takes a key away from a conflicting shortcut on the same page', () => {
    const takenFrom = assignBinding('design.addFixture', { key: 'z', mod: true }, null);
    expect(takenFrom).toEqual(['Undo']);
    expect(getBindings('edit.undo')).toEqual([]);
    expect(getBindings('design.addFixture')).toEqual([{ key: 'a', shift: true }, { key: 'z', mod: true }]);
  });

  it('leaves shortcuts of the other page alone', () => {
    const takenFrom = assignBinding('live.copy', { key: 'a', shift: true }, null);
    expect(takenFrom).toEqual([]);
    expect(getBindings('design.addFixture')).toEqual([{ key: 'a', shift: true }]);
  });

  it('resets a single shortcut', () => {
    setBindings('edit.undo', []);
    resetBindings('edit.undo');
    expect(getBindings('edit.undo')).toEqual([{ key: 'z', mod: true }]);
  });
});
