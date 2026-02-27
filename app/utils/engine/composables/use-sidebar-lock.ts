import { ref, provide, inject } from 'vue';

const SIDEBAR_LOCK_KEY = Symbol('sidebarLock');

interface SidebarLock {
  openCount: ReturnType<typeof ref<number>>;
  lock(): void;
  unlock(): void;
}

/**
 * Call this in the sidebar root component to provide a lock mechanism.
 * Any child that opens a floating overlay (dropdown, popover, etc.) should call
 * `lock()` when opening and `unlock()` when closing, preventing the sidebar
 * from auto-closing via onClickOutside.
 */
export function provideSidebarLock(): SidebarLock {
  const openCount = ref(0); // initialized to 0, type is Ref<number>

  const api: SidebarLock = {
    openCount,
    lock() {
      openCount.value++;
    },
    unlock() {
      openCount.value = Math.max(0, openCount.value - 1);
    },
  };

  provide(SIDEBAR_LOCK_KEY, api);
  return api;
}

/**
 * Call this in any child component that opens a floating UI.
 */
export function useSidebarLock(): SidebarLock {
  const api = inject<SidebarLock>(SIDEBAR_LOCK_KEY);
  // No-op fallback when used outside a sidebar context
  const noop: SidebarLock = {
    openCount: ref(0),
    lock() { },
    unlock() { },
  };
  return api ?? noop;
}
