import { ref, shallowRef, type Component } from 'vue';
import type { ScopeSnapshot } from '@pixelmapper/extension-api';

export interface ContextMenuItemOption {
  label?: string;
  icon?: Component;
  shortcut?: string;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  action?: () => void;
  isSeparator?: boolean;
  children?: ContextMenuItemOption[]; // For sub-menus
}

/**
 * Extension context of an open menu: `id` names the menu group (extension
 * slot `context-menu/<id>:items`), `scopes` are the opener's scopes captured
 * at open time (the menu itself renders at the app root).
 */
export interface ContextMenuExtensionContext {
  id: string;
  scopes?: ScopeSnapshot;
}

const isOpen = ref(false);
const position = ref({ x: 0, y: 0 });
const options = ref<ContextMenuItemOption[]>([]);
const extensionContext = shallowRef<ContextMenuExtensionContext | null>(null);

/**
 * Composable to manage the Global Context Menu state.
 */
export function useGlobalContextMenu() {
  /**
   * Open the context menu at a specific position with given options.
   * @param event The mouse event to get the position from
   * @param menuOptions UI options for the context menu
   * @param context Optional extension context (menu id + opener scopes)
   */
  function openMenu(event: MouseEvent, menuOptions: ContextMenuItemOption[], context?: ContextMenuExtensionContext) {
    // Prevent default browser context menu
    event.preventDefault();

    position.value = { x: event.clientX, y: event.clientY };
    options.value = menuOptions;
    extensionContext.value = context ?? null;
    isOpen.value = true;
  }

  function closeMenu() {
    isOpen.value = false;
  }

  return {
    isOpen,
    position,
    options,
    extensionContext,
    openMenu,
    closeMenu,
  };
}
