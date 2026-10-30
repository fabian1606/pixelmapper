<script setup lang="ts">
/**
 * RDM status of a linked fixture in the scene list (plan D15, M6.7; slot
 * `scene/fixture:badges`, only for fixtures with an RDM link): Connected,
 * Mismatch (click → *Write to device* / *Take from device*), Offline,
 * Unlinked. Tooltip: why, UID, firmware, last seen.
 */
import { computed, ref } from 'vue';
import { useScope } from '@pixelmapper/extension-api';
import { getDeviceRuntime, type DeviceRuntime } from '../devices/device-runtime';
import { fixtureLinkState } from '../devices/fixture-link-state';
import type { LinkStatusKind } from '../devices/link-status';
import { takeFromDevice, writeToDevice } from '../devices/patch-sync';
import MismatchPopover from './MismatchPopover.vue';

const props = defineProps<{
  /** Runtime to use (tests); default the app's. */
  runtime?: DeviceRuntime | null;
}>();

const fixture = useScope('fixture');
const runtime = props.runtime ?? getDeviceRuntime();

/** Link, device and status of the row's fixture (null without link or runtime). */
const state = computed(() => (runtime && fixture.value ? fixtureLinkState(runtime, fixture.value) : null));

/** Text and classes per status (theme tokens only). */
const STYLE: Record<LinkStatusKind, { text: string; cls: string }> = {
  connected: { text: 'Connected', cls: 'bg-primary/15 text-primary' },
  mismatch: { text: 'Mismatch', cls: 'bg-destructive/15 text-destructive hover:bg-destructive/25 cursor-pointer' },
  offline: { text: 'Offline', cls: 'bg-muted text-muted-foreground' },
  unlinked: { text: 'Unlinked', cls: 'border border-dashed border-border text-muted-foreground' },
};

const style = computed(() => (state.value ? STYLE[state.value.status.kind] : null));

/** Native tooltip: status reasons, UID, firmware, last seen. */
const tooltip = computed(() => {
  const s = state.value;
  if (!s) return '';
  const lines = [`RDM: ${STYLE[s.status.kind].text}`, ...s.status.reasons, `UID ${s.link.uid} · ${s.portName}`];
  const d = s.device;
  const fw = d?.description?.softwareVersionLabel ?? (d?.info ? `0x${d.info.softwareVersionId.toString(16)}` : null);
  if (fw) lines.push(`Firmware ${fw}`);
  lines.push(d?.lastSeen ? `Last seen ${new Date(d.lastSeen).toLocaleTimeString()}` : 'Not seen yet');
  if (s.status.kind === 'mismatch') lines.push('Click to resolve');
  return lines.join('\n');
});

const badge = ref<HTMLElement | null>(null);
const anchor = ref<{ left: number; bottom: number } | null>(null);

/** Mismatch: opens/closes the popover (without selecting the row). Other states: a normal row click. */
function onClick(e: MouseEvent) {
  if (state.value?.status.kind !== 'mismatch') return;
  e.stopPropagation();
  if (anchor.value) return void (anchor.value = null);
  const r = badge.value?.getBoundingClientRect();
  anchor.value = { left: r?.left ?? 0, bottom: r?.bottom ?? 0 };
}

/** Resolutions for the popover (bound to this row's fixture). */
const write = () => (runtime && fixture.value ? writeToDevice(runtime, fixture.value.id) : Promise.resolve());
const take = () => (runtime && fixture.value ? takeFromDevice(runtime, fixture.value.id) : Promise.resolve());
</script>

<template>
  <span
    v-if="state && style"
    ref="badge"
    data-rdm-badge
    class="shrink-0 px-1 rounded text-[10px] leading-4 select-none"
    :class="style.cls"
    :title="tooltip"
    @click="onClick"
  >
    {{ style.text }}
  </span>
  <MismatchPopover
    v-if="anchor && state?.status.kind === 'mismatch'"
    :anchor="anchor"
    :reasons="state.status.reasons"
    :write="write"
    :take="take"
    @close="anchor = null"
  />
</template>
