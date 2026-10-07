/**
 * Modifier instance helpers (ADR §6.3): creation with manifest defaults,
 * cloning, naming, stable keys.
 */
import { toRaw } from 'vue';
import { defaultParams } from '@pixelmapper/plugin-toolchain/params';
import type { ChannelType, ModifierInstance, Signature } from './types';
import { BUILTIN_BY_ALIAS } from '~/utils/plugins/builtin-index';
import { getManifest } from '~/utils/plugins/plugin-store';

/** Aliases of the built-in plugins. */
export const BUILTIN_ALIASES = {
  waveform: '@pixelmapper/waveform',
  noise: '@pixelmapper/noise',
  sequencer: '@pixelmapper/sequencer',
  colorAdjust: '@pixelmapper/color-adjust',
} as const;

/** Hash of a built-in plugin by alias. */
export function builtinHash(alias: string): string {
  const hash = BUILTIN_BY_ALIAS[alias];
  if (!hash) throw new Error(`unknown built-in plugin ${alias}`);
  return hash;
}

/** New unique id. */
function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11);
}

/** Options for `createModifier`. */
export type ModifierInit = Partial<Omit<ModifierInstance, 'plugin'>> & { targetChannels?: ChannelType[] };

/**
 * Creates an instance of `plugin` with host defaults and the manifest's
 * param defaults. Throws when the plugin is unknown.
 */
export function createModifier(plugin: string, init: ModifierInit = {}): ModifierInstance {
  const manifest = getManifest(plugin);
  if (!manifest) throw new Error(`unknown plugin ${plugin}`);
  return {
    id: newId(),
    plugin,
    signature: (init.signature ?? manifest.signatures[0]) as Signature,
    targetChannels: [],
    blendMode: 'add',
    strength: 1,
    speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
    direction: 'LINEAR',
    originX: 0.5,
    originY: 0.5,
    angle: 0,
    fanning: 0.1,
    reverse: false,
    ...init,
    params: { ...defaultParams(manifest.params), ...(init.params ?? {}) },
  };
}

/** Deep clone (works on reactive proxies). */
export function cloneModifier(m: ModifierInstance): ModifierInstance {
  return JSON.parse(JSON.stringify(toRaw(m))) as ModifierInstance;
}

/** Deep clone of a list. */
export function cloneModifiers(list: readonly ModifierInstance[]): ModifierInstance[] {
  return list.map(cloneModifier);
}

/** Display name: manifest name plus the label of the first enum param's value. */
export function modifierName(m: Pick<ModifierInstance, 'plugin' | 'params'>): string {
  const manifest = getManifest(m.plugin);
  if (!manifest) return 'Unknown modifier';
  const firstEnum = manifest.params.find(p => p.type === 'enum');
  if (firstEnum && firstEnum.type === 'enum') {
    const value = String(m.params[firstEnum.key] ?? firstEnum.default);
    const i = firstEnum.options.indexOf(value);
    const label = firstEnum.optionLabels?.[i] ?? value;
    return `${manifest.name} · ${label}`;
  }
  return manifest.name;
}

/** Stable 32-bit key of an instance id (runtime instance id in the worker). */
export function modifierKey(id: string): number {
  let h = 0x811c9dc5;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}
