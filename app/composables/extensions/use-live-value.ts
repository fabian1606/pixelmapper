/**
 * `useLiveValue` — host implementation (ADR §5.5).
 *
 * Subscribes to a live target while the calling component is mounted and
 * visible (document visible and, when the component has a root element,
 * intersecting the viewport). Updates are throttled to `fps` (default 30,
 * max 60) and written into a `shallowRef`.
 */
import {
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  toValue,
  watch,
  type MaybeRef,
  type ShallowRef,
} from 'vue';
import type { LiveTarget, LiveValueOf, LiveValueOptions } from '@pixelmapper/extension-api';
import { liveHub, targetKey } from '~/utils/extensions/live-hub';

/** Subscribes to a live value; see module docs. Call during `setup`. */
export function useLiveValue<T extends LiveTarget>(
  target: MaybeRef<T>,
  opts: LiveValueOptions = {},
): Readonly<ShallowRef<LiveValueOf<T> | undefined>> {
  const value = shallowRef(undefined) as ShallowRef<LiveValueOf<T> | undefined>;
  const minInterval = 1000 / Math.min(60, Math.max(1, opts.fps ?? 30));

  let unsubscribe: (() => void) | null = null;
  let lastEmit = 0;
  let mounted = false;
  let docVisible = typeof document === 'undefined' || !document.hidden;
  let inView = true;

  /** (Re)subscribes when active, unsubscribes otherwise. */
  function sync() {
    unsubscribe?.();
    unsubscribe = null;
    if (!mounted || !docVisible || !inView) return;
    lastEmit = 0;
    unsubscribe = liveHub.subscribe(toValue(target), (v) => {
      const now = performance.now();
      if (now - lastEmit < minInterval) return;
      lastEmit = now;
      value.value = v as LiveValueOf<T>;
    });
  }

  // Resubscribe when the target changes (by key, not identity).
  watch(() => targetKey(toValue(target)), sync);

  const onVisibility = () => {
    docVisible = !document.hidden;
    sync();
  };

  let observer: IntersectionObserver | null = null;
  const instance = getCurrentInstance();

  onMounted(() => {
    mounted = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    const el = instance?.proxy?.$el as Element | undefined;
    if (el instanceof Element && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        inView = entries.some(e => e.isIntersecting);
        sync();
      });
      observer.observe(el);
    }
    sync();
  });

  onBeforeUnmount(() => {
    mounted = false;
    observer?.disconnect();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    sync();
  });

  return value;
}
