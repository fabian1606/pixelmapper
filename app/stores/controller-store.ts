import { defineStore } from 'pinia';
import { reactive, shallowReactive } from 'vue';
import type { BaseControllerDriver } from '~/utils/controllers/base-controller-driver';
import { getControllerDefinition } from '~/utils/controllers/catalog';

/**
 * Tracks live hardware-driver instances and a per-tab map of which twin widget
 * is bound to which driver. Bindings are intentionally NOT serialized into the
 * project document — different users see the same twin layout but each binds
 * to their own physical device (or none).
 */
export const useControllerStore = defineStore('controller', () => {
  const instances = shallowReactive<BaseControllerDriver[]>([]);
  /** widgetId → driver.id. */
  const bindings = reactive(new Map<string, string>());

  function addInstance(definitionKey: string): BaseControllerDriver | null {
    const def = getControllerDefinition(definitionKey);
    if (!def) return null;
    const id = crypto.randomUUID();
    const driver = def.driverFactory(id);
    instances.push(driver);
    return driver;
  }

  async function removeInstance(id: string) {
    const idx = instances.findIndex(d => d.id === id);
    if (idx === -1) return;
    const driver = instances[idx];
    try { await driver.disconnect(); } catch (e) { console.warn('[controller-store] disconnect failed:', e); }
    instances.splice(idx, 1);
    // Drop any bindings pointing at this instance.
    for (const [widgetId, instanceId] of bindings) {
      if (instanceId === id) bindings.delete(widgetId);
    }
  }

  function getInstance(id: string): BaseControllerDriver | null {
    return instances.find(d => d.id === id) ?? null;
  }

  function instancesForKey(definitionKey: string): BaseControllerDriver[] {
    return instances.filter(d => d.definitionKey === definitionKey);
  }

  function bindWidget(widgetId: string, instanceId: string | null) {
    if (instanceId === null) bindings.delete(widgetId);
    else bindings.set(widgetId, instanceId);
  }

  function getBindingFor(widgetId: string): BaseControllerDriver | null {
    const instanceId = bindings.get(widgetId);
    if (!instanceId) return null;
    return getInstance(instanceId);
  }

  async function reset() {
    // Disconnect every driver and clear bindings — called when switching projects
    // so MIDI / HID ports don't leak across project loads.
    const all = [...instances];
    instances.splice(0, instances.length);
    bindings.clear();
    for (const driver of all) {
      try { await driver.disconnect(); } catch (e) { console.warn('[controller-store] reset disconnect failed:', e); }
    }
  }

  return {
    instances,
    bindings,
    addInstance,
    removeInstance,
    getInstance,
    instancesForKey,
    bindWidget,
    getBindingFor,
    reset,
  };
});
