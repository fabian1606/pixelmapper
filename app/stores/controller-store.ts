import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { BaseControllerDriver } from '~/utils/controllers/base-controller-driver';
import { getControllerDefinition } from '~/utils/controllers/catalog';

/**
 * One driver per LiveControllerInstance, keyed by instanceId.
 * Multiple instances of the same definitionKey (e.g. 2× APC Mini) are supported.
 */
export const useControllerStore = defineStore('controller', () => {
  const drivers = reactive(new Map<string, BaseControllerDriver>());

  function getBindingFor(instanceId: string): BaseControllerDriver | null {
    return drivers.get(instanceId) ?? null;
  }

  function createDriver(instanceId: string, definitionKey: string): BaseControllerDriver | null {
    const existing = drivers.get(instanceId);
    if (existing) return existing;
    const def = getControllerDefinition(definitionKey);
    if (!def) return null;
    const driver = def.driverFactory(instanceId);
    drivers.set(instanceId, driver);
    return driver;
  }

  async function removeDriver(instanceId: string) {
    const driver = drivers.get(instanceId);
    if (!driver) return;
    try { await driver.disconnect(); } catch (e) { console.warn('[controller-store] disconnect failed:', e); }
    drivers.delete(instanceId);
  }

  async function reset() {
    const all = [...drivers.entries()];
    drivers.clear();
    for (const [, d] of all) {
      try { await d.disconnect(); } catch (e) { console.warn('[controller-store] reset disconnect failed:', e); }
    }
  }

  return { drivers, getBindingFor, createDriver, removeDriver, reset };
});
