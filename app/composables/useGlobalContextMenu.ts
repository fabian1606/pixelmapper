import { ref, type Component } from 'vue';

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

const isOpen = ref(false);
const position = ref({ x: 0, y: 0 });
const options = ref<ContextMenuItemOption[]>([]);

/**
 * Composable to manage the Global Context Menu state.
 */
export function useGlobalContextMenu() {
  /**
   * Open the context menu at a specific position with given options.
   * @param event The mouse event to get the position from
   * @param menuOptions UI options for the context menu
   */
  function openMenu(event: MouseEvent, menuOptions: ContextMenuItemOption[]) {
    // Prevent default browser context menu
    event.preventDefault();

    position.value = { x: event.clientX, y: event.clientY };
    options.value = menuOptions;
    isOpen.value = true;
  }

  function closeMenu() {
    isOpen.value = false;
  }

  return {
    isOpen,
    position,
    options,
    openMenu,
    closeMenu,
  };
}
