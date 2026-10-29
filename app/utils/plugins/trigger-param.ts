/**
 * Host side of `trigger` params (ABI 1.3): applies a press/release edge to a
 * modifier instance's params at the current engine-clock time. Pure (no
 * stores) so the card, live widgets and tests share it; the store-bound
 * wrapper lives in `composables/live-ops/effect-trigger.ts`.
 */
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import type { TriggerValue } from '@pixelmapper/extension-api';
import { multiClickMsOf, triggerEdge } from '@pixelmapper/plugin-toolchain/params';

/** Engine-clock ms (`Frame.timeMs`) at wall time `nowMs` for a clock epoch. */
export function engineClockMs(epochMs: number, nowMs: number = Date.now()): number {
  return nowMs - epochMs;
}

/** True when `key` names a `trigger` param of the manifest. */
export function isTriggerParam(manifest: ContentPluginManifest | undefined, key: string): boolean {
  return manifest?.params.some(p => p.key === key && p.type === 'trigger') ?? false;
}

/**
 * The params after a press (`pressed`) or release of trigger `key` at engine
 * time `clockMs`; null when `key` is not a trigger or the edge changes nothing.
 */
export function paramsAfterTriggerEdge(
  manifest: ContentPluginManifest | undefined,
  params: Record<string, unknown>,
  key: string,
  pressed: boolean,
  clockMs: number,
): Record<string, unknown> | null {
  const def = manifest?.params.find(p => p.key === key);
  if (def?.type !== 'trigger') return null;
  const prev = params[key] as TriggerValue | undefined;
  const next = triggerEdge(prev, pressed, clockMs, multiClickMsOf(def));
  return next === prev ? null : { ...params, [key]: next };
}
