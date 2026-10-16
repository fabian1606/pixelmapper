import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { defineExtension, type ExtensionManifest } from '@pixelmapper/extension-api';
import {
  ExtensionValidationError,
  getContributions,
  getExtensions,
  registerExtension,
  registryVersion,
  resetRegistry,
  validateManifest,
} from './registry';

/** Builds a valid manifest; individual tests override fields. */
function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return defineExtension({
    id: 'color-picker',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    displayName: 'Color Picker',
    description: 'A color picker.',
    ...overrides,
  });
}

/** Asserts that registering throws and returns the readable errors. */
function rejectErrors(m: ExtensionManifest): string[] {
  try {
    registerExtension(m, 'test');
  }
  catch (e) {
    expect(e).toBeInstanceOf(ExtensionValidationError);
    return (e as ExtensionValidationError).errors;
  }
  throw new Error('expected registration to fail');
}

const Dummy = defineComponent({ render: () => null });

describe('extension registry', () => {
  beforeEach(() => resetRegistry());

  it('registers a valid extension and bumps the version', () => {
    const v = registryVersion.value;
    registerExtension(manifest(), 'test');
    expect(getExtensions().map(e => e.manifest.id)).toEqual(['color-picker']);
    expect(registryVersion.value).toBeGreaterThan(v);
  });

  it('rejects a duplicate id', () => {
    registerExtension(manifest(), 'test');
    expect(rejectErrors(manifest())).toContain('an extension with id "color-picker" is already registered');
  });

  it('rejects a non-kebab id', () => {
    expect(rejectErrors(manifest({ id: 'ColorPicker' }))[0]).toMatch(/must be kebab-case/);
  });

  it('rejects bad semver', () => {
    expect(rejectErrors(manifest({ version: '1.0' }))).toContain(
      'version "1.0" is not valid semver (e.g. "1.0.0")',
    );
  });

  it('rejects an invalid apiVersion range', () => {
    expect(rejectErrors(manifest({ apiVersion: 'banana' }))[0]).toMatch(/not a valid semver range/);
  });

  it('rejects an incompatible apiVersion', () => {
    expect(rejectErrors(manifest({ apiVersion: '^2.0.0' }))[0]).toMatch(/incompatible with the host extension API/);
  });

  it('rejects un-namespaced command types', () => {
    const errors = rejectErrors(manifest({
      contributes: {
        commands: [
          { type: 'other/do' as const, fromPayload: () => ({ description: '', execute() {}, undo() {} }) },
          { type: 'reshape' as `${string}/${string}`, fromPayload: () => ({ description: '', execute() {}, undo() {} }) },
        ],
      },
    }));
    expect(errors).toEqual([
      'command type "other/do" must be namespaced as "color-picker/<name>"',
      'command type "reshape" must be namespaced as "color-picker/<name>"',
    ]);
  });

  it('rejects a duplicate replacement within one extension', () => {
    const errors = rejectErrors(manifest({
      contributes: {
        replaces: [
          { replaces: 'pm.colorInput', component: Dummy },
          { replaces: 'pm.colorInput', component: Dummy },
        ],
      },
    }));
    expect(errors).toContain('replaces "pm.colorInput" more than once');
  });

  it('rejects un-namespaced live widget types', () => {
    const errors = validateManifest(manifest({
      contributes: {
        liveWidgets: [{ type: 'wheel', label: 'W', icon: 'x', component: Dummy, defaultConfig: () => ({}) }],
      },
    }));
    expect(errors).toEqual(['live widget type "wheel" must be namespaced as "color-picker/<name>"']);
  });

  it('collects all errors at once', () => {
    expect(rejectErrors(manifest({ id: 'Bad Id', version: 'x', description: '' })).length).toBe(3);
  });

  it('returns contributions tagged with their owner, ordered by extension id', () => {
    registerExtension(manifest({ id: 'zeta', contributes: { slots: [{ slot: 'a:actions', component: Dummy }] } }), 'test');
    registerExtension(manifest({ id: 'alpha', contributes: { slots: [{ slot: 'b:actions', component: Dummy }] } }), 'test');
    expect(getContributions('slots').map(c => [c.extensionId, c.contribution.slot])).toEqual([
      ['alpha', 'b:actions'],
      ['zeta', 'a:actions'],
    ]);
  });
});
