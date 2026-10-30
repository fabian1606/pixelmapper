/**
 * Identify of the node itself (ArtAddress LED Locate; plan D8) for the
 * card header (WP13, moved from the Device section): on/off as the node
 * reports it (`status.indicator`, D5), “Turn display on” after LED Mute,
 * and switched off again when the card closes if this card switched it on.
 */
import { computed, onBeforeUnmount, type ComputedRef, type Ref } from 'vue';
import type { NodeContext } from '../node-config/use-node-context';
import { useCommandRunner } from '../node-config/use-node-context';

/** What `useNodeIdentify` returns. */
export interface NodeIdentify {
  /** The node reports LED Locate. */
  on: ComputedRef<boolean>;
  /** The node reports LED Mute (display off). */
  muted: ComputedRef<boolean>;
  busy: Ref<string | null>;
  error: Ref<string | null>;
  /** Switches Locate on or off. */
  set: (on: boolean) => Promise<void>;
  /** Turns the display on again after LED Mute. */
  unmute: () => Promise<void>;
}

/** Identify of node `nodeId()` (call in a component's setup). */
export function useNodeIdentify(ctx: NodeContext, nodeId: () => string): NodeIdentify {
  const runner = useCommandRunner();
  /** This card switched identify on (and switches it off when it closes). */
  let started = false;

  const on = computed(() => ctx.node.value?.status.indicator === 'locate');
  const muted = computed(() => ctx.node.value?.status.indicator === 'mute');

  async function set(value: boolean) {
    const ok = await runner.run('identify', () => ctx.backend.request('artAddress', { nodeId: nodeId(), indicator: value ? 'locate' : 'normal' }));
    if (ok) started = value;
  }

  async function unmute() {
    await runner.run('identify', () => ctx.backend.request('artAddress', { nodeId: nodeId(), indicator: 'normal' }));
  }

  // Identify ends when the card closes (fire-and-forget; the card is gone).
  onBeforeUnmount(() => {
    if (!started || !ctx.connected.value) return;
    ctx.backend.request('artAddress', { nodeId: nodeId(), indicator: 'normal' }).catch((err) => {
      console.warn('[artnet] switching identify off failed:', err);
    });
  });

  return { on, muted, busy: runner.busy, error: runner.error, set, unmute };
}
