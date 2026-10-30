<script setup lang="ts">
/**
 * Popover of a Mismatch badge (plan D15): what differs, and the two ways
 * to resolve it — *Write to device* (the fixture's mode and address go to
 * the device) or *Take from device* (the fixture takes the device's; one
 * undo step). Nothing is overwritten automatically.
 *
 * Teleported to `<body>` with `data-overlay-root`, which the core lists in
 * `FLOATING_OVERLAY_SELECTORS`: clicks inside do not close the sidebar the
 * badge sits in. Closes on Escape and on a pointer-down outside.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  /** Bounding box of the badge (viewport coordinates) to place the popover under. */
  anchor: { left: number; bottom: number };
  /** Differences, e.g. "Device address 100, fixture 1". */
  reasons: string[];
  write: () => Promise<void>;
  take: () => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();

const root = ref<HTMLElement | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

/** Runs a resolution; closes on success, shows the error otherwise. */
async function run(action: () => Promise<void>) {
  busy.value = true;
  error.value = null;
  try {
    await action();
    emit('close');
  }
  catch (err) {
    error.value = (err as Error).message ?? String(err);
  }
  finally {
    busy.value = false;
  }
}

/** Outside pointer-down closes (the badge itself toggles). */
function onPointerDown(e: PointerEvent) {
  if (root.value && e.target instanceof Node && root.value.contains(e.target)) return;
  if (e.target instanceof Element && e.target.closest('[data-rdm-badge]')) return;
  emit('close');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      data-overlay-root
      role="dialog"
      aria-label="Device mismatch"
      class="fixed z-[150] w-64 rounded-md border border-border bg-popover text-popover-foreground shadow-md p-2 flex flex-col gap-1.5 text-xs"
      :style="{ left: `${props.anchor.left}px`, top: `${props.anchor.bottom + 4}px` }"
      @click.stop
    >
      <div class="font-medium">The device reports a different patch</div>
      <ul class="text-[11px] text-muted-foreground list-disc pl-4">
        <li v-for="r in reasons" :key="r">{{ r }}</li>
      </ul>
      <div class="flex gap-1.5">
        <button
          class="flex-1 px-2 py-1 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          :disabled="busy"
          title="Send the fixture's mode and address to the device"
          @click="run(write)"
        >
          Write to device
        </button>
        <button
          class="flex-1 px-2 py-1 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
          :disabled="busy"
          title="Set the fixture to the device's address and mode"
          @click="run(take)"
        >
          Take from device
        </button>
      </div>
      <p v-if="error" class="text-[11px] text-destructive">{{ error }}</p>
    </div>
  </Teleport>
</template>
