<script setup lang="ts">
/**
 * Draggable strip under the transparent macOS title bar for pages without
 * the app header (projects list, auth). Renders nothing in the browser.
 */
import { useWindowChrome } from '~/composables/use-window-chrome';

const { overlayTitleBar, headerMounted } = useWindowChrome();
</script>

<template>
  <div
    v-if="overlayTitleBar && !headerMounted"
    class="fixed inset-x-0 top-0 h-7 z-50"
    data-tauri-drag-region
  />
</template>
