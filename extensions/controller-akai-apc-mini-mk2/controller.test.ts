/**
 * Controllers from extensions (plan P6.4): the core catalog resolves the
 * registered APC Mini mk2 (layout, controls, driver).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { getControllerDefinition, listControllerDefinitions } from '~/utils/controllers/catalog';
import extension from './extension';

beforeEach(() => {
  resetRegistry();
});

describe('controller catalog', () => {
  it('is empty without controller extensions', () => {
    expect(listControllerDefinitions()).toEqual([]);
  });

  it('resolves the APC Mini mk2 from its extension', () => {
    registerExtension(extension);
    const def = getControllerDefinition('akai-apc-mini-mk2')!;
    expect(def.svg).toContain('<svg');
    expect(def.controls).toHaveLength(64 + 8 + 8 + 1 + 9);
    const driver = def.driverFactory('i1');
    expect(driver.definitionKey).toBe('akai-apc-mini-mk2');
    expect(driver.status.value).toBe('disconnected');
  });
});
