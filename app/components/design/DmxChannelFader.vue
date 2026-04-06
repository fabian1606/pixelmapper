<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import type { ChannelInfo } from '~/composables/use-universe-inspector';
import { getIconForChannel } from '~/utils/engine/channel-categories';
import { SlidersHorizontal } from 'lucide-vue-next';
import { useEngineStore } from '~/stores/engine-store';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

const props = defineProps<{
  channelInfo: ChannelInfo;
  isOverridden: boolean;
  active?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:value', value: number): void;
  (e: 'clear-override'): void;
}>();

const engineStore = useEngineStore();

const isDragging = ref(false);
const sliderRef = ref<HTMLInputElement>();
const valueInputRef = ref<HTMLInputElement>();

// Displayed value: override → engine output (gated by active prop)
const displayValue = computed(() => {
  if (!props.active) return 0;
  engineStore.bufferRevision; // reactive tick
  const buf = engineStore.getOutputBuffer();
  const idx = props.channelInfo.bufferIndex;
  return idx < buf.length ? buf[idx]! : 0;
});

watchEffect(() => {
  const slider = sliderRef.value;
  const input = valueInputRef.value;
  if (!props.active || isDragging.value || !slider || !input) return;
  
  const v = displayValue.value;
  const vStr = String(v);
  if (slider.value !== vStr) slider.value = vStr;
  if (input.value !== vStr) input.value = vStr;
});

function onPointerDown() {
  isDragging.value = true;
  emit('update:value', displayValue.value);
}

function onPointerUp() {
  isDragging.value = false;
}

function onSliderInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10);
  emit('update:value', val);
}

function onValueChange(e: Event) {
  let val = parseInt((e.target as HTMLInputElement).value, 10);
  if (isNaN(val)) val = 0;
  val = Math.max(0, Math.min(255, val));
  emit('update:value', val);
}

function onDoubleClick() {
  emit('clear-override');
}

const icon = computed(() => {
  const ch = props.channelInfo.channel;
  if (!ch) return SlidersHorizontal;
  return getIconForChannel(ch.type, ch.role);
});

const typeColor = computed(() => {
  const ch = props.channelInfo.channel;
  if (!ch) return null;
  if (ch.role === 'COLOR' || ch.role === 'DIMMER') {
    return ch.colorValue && ch.colorValue !== '#000000' ? ch.colorValue : '#FFFFFF';
  }
  return null;
});

const label = computed(() => {
  const ch = props.channelInfo.channel;
  if (!ch) return '—';
  return ch.oflChannelName ?? ch.type.replace(/_/g, ' ');
});

const capabilities = computed(() => {
  return props.channelInfo.channel?.oflCapabilities ?? [];
});

function selectCapability(cap: any) {
  if (!cap.dmxRange) return;
  // Set value to the middle of the capability range
  const midValue = Math.floor((cap.dmxRange[0] + cap.dmxRange[1]) / 2);
  emit('update:value', midValue);
}

const previewStyle = computed(() => {
  if (!props.channelInfo.isAssigned) return {};
  
  const opacity = displayValue.value / 255;
  if (typeColor.value) {
    return {
      backgroundColor: typeColor.value,
      opacity: 0.2 + opacity * 0.8,
    };
  }
  
  return {
    backgroundColor: `rgba(255, 255, 255, ${0.1 + opacity * 0.7})`,
  };
});

const isSelected = computed(() => {
  const fid = props.channelInfo.fixture?.id;
  return fid !== undefined && engineStore.selectedIds.has(fid);
});

const sliderStyle = computed(() => {
  const percent = (displayValue.value / 255) * 100;
  return {
    '--value-percent': `${percent}%`,
    '--track-color': props.isOverridden 
      ? 'rgba(251, 191, 36, 0.1)' 
      : 'color-mix(in srgb, var(--muted) 40%, transparent)',
    '--fill-color': props.isOverridden 
      ? 'rgba(251, 191, 36, 0.4)' 
      : 'color-mix(in srgb, var(--muted-foreground) 35%, transparent)'
  };
});
</script>

<template>
  <div
    class="dmx-fader flex flex-col items-center select-none shrink-0 rounded transition-colors pb-1"
    :class="[
      isOverridden ? 'is-overridden bg-amber-400/5' : '',
      isSelected ? 'is-selected bg-amber-400/5' : ''
    ]"
  >
    <!-- Preview Box with Popover -->
    <div class="px-1 py-1 w-full flex justify-center">
      <Popover v-if="capabilities.length > 1">
        <PopoverTrigger as-child>
          <button
            class="preview-box w-7 h-7 rounded border border-border/40 flex items-center justify-center transition-all relative overflow-hidden group hover:border-primary/50 cursor-pointer"
            :style="previewStyle"
            title="Einstellmöglichkeiten anzeigen"
          >
            <component
              v-if="!typeColor"
              :is="icon"
              class="w-4 h-4 relative z-10 text-foreground drop-shadow-sm"
            />
            <!-- Triangle indicator for multiple capabilities -->
            <div class="absolute bottom-0 right-0 w-0 h-0 border-l-[5px] border-l-transparent border-b-[5px] border-b-foreground/50 opacity-60"></div>
          </button>
        </PopoverTrigger>

        <PopoverContent v-if="capabilities.length > 0" class="w-64 p-0" align="start" side="right" :side-offset="10">
          <div class="p-2 border-b bg-muted/30">
            <h4 class="text-xs font-semibold">{{ label }} Capabilities</h4>
          </div>
          <ScrollArea class="h-64">
            <div class="p-1">
              <button
                v-for="(cap, i) in capabilities"
                :key="i"
                class="w-full text-left px-2 py-1.5 text-[11px] hover:bg-primary/10 rounded-sm transition-colors flex justify-between items-center group"
                @click="selectCapability(cap)"
              >
                <span class="truncate pr-2">
                  {{ (cap as any).name || (cap as any).comment || cap.type }}
                </span>
                <span v-if="cap.dmxRange" class="text-[9px] text-muted-foreground tabular-nums opacity-50 group-hover:opacity-100">
                  {{ cap.dmxRange[0] }}-{{ cap.dmxRange[1] }}
                </span>
              </button>
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      <button
        v-else
        class="preview-box w-7 h-7 rounded border border-border/40 flex items-center justify-center transition-all relative overflow-hidden"
        :class="channelInfo.isAssigned ? 'cursor-default' : 'opacity-40 cursor-default'"
        :style="previewStyle"
        :disabled="!channelInfo.isAssigned"
      >
        <template v-if="channelInfo.isAssigned">
          <component
            v-if="!typeColor"
            :is="icon"
            class="w-4 h-4 relative z-10 text-foreground drop-shadow-sm"
          />
        </template>
        <span v-else class="text-[10px] font-bold text-muted-foreground/60 relative z-10 tabular-nums">
          {{ channelInfo.localAddress }}
        </span>
      </button>
    </div>

    <!-- Channel Name Label -->
    <div
      class="text-[9px] leading-tight text-center truncate px-0.5 w-full mb-1 h-3 flex items-center justify-center"
      :class="channelInfo.isAssigned ? 'text-muted-foreground' : 'text-muted-foreground/20'"
      :title="label"
    >
      {{ label }}
    </div>

    <!-- Vertical Slider -->
    <div class="fader-track flex items-center justify-center flex-1 w-full py-1 pt-3 pb-3">
      <input
        ref="sliderRef"
        type="range"
        orient="vertical"
        min="0"
        max="255"
        class="fader-range"
        :class="isOverridden ? 'overridden' : ''"
        :style="sliderStyle"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @input="onSliderInput"
        @dblclick="onDoubleClick"
      />
    </div>

    <!-- Editable Numeric Value Block -->
    <div class="px-1 w-full mt-1">
      <input
        ref="valueInputRef"
        type="number"
        min="0"
        max="255"
        class="value-input w-full bg-transparent text-[10px] tabular-nums text-center rounded border border-transparent hover:border-border/40 focus:border-primary/50 focus:bg-muted/30 outline-none transition-all py-0.5"
        :class="isOverridden ? 'text-amber-400 font-bold' : 'text-muted-foreground/70'"
        @input="onValueChange"
        @focus="($event.target as HTMLInputElement).select()"
      />
    </div>
  </div>
</template>

<style scoped>
.dmx-fader {
  width: 36px;
  min-height: 220px;
}

.fader-range {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  height: 110px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  /* Make internal logic vertical */
  writing-mode: vertical-lr;
  direction: rtl;
}

/* Track styling for Chrome/Safari/Edge */
.fader-range::-webkit-slider-runnable-track {
  width: 6px; /* Width becomes thickness in vertical-lr */
  height: 100%; /* Height becomes length */
  background: linear-gradient(
    to top,
    var(--fill-color) 0%,
    var(--fill-color) var(--value-percent),
    var(--track-color) var(--value-percent),
    var(--track-color) 100%
  );
  border-radius: 99px;
  border: 1px solid var(--border);
}

/* Thumb styling for Chrome/Safari/Edge */
.fader-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  height: 14px; /* Physical length of thumb */
  width: 22px; /* Physical width of thumb perpendicular to track */
  border-radius: 2px;
  background: var(--muted-foreground);
  border: 1px solid color-mix(in srgb, var(--foreground) 20%, transparent);
  margin-left: -9px; /* Center horizontally: (6px track width)/2 - (22px width)/2 = -8px */
  margin-top: 0;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
  transition: all 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28);
}

.fader-range::-webkit-slider-thumb:hover {
  background: var(--foreground);
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.5);
  cursor: grab;
}

.fader-range::-webkit-slider-thumb:active {
  cursor: grabbing;
  transform: scale(0.95);
}

.dmx-fader.is-overridden {
  box-shadow: inset 0 0 10px rgba(251, 191, 36, 0.05);
}

.dmx-fader.is-selected {
  box-shadow: inset 0 0 10px rgba(251, 191, 36, 0.05);
  background-color: rgba(251, 191, 36, 0.03);
}

/* Overridden and Selected thumb states */
.fader-range.overridden::-webkit-slider-thumb {
  background: rgb(251 191 36); /* amber-400 */
  border-color: rgb(245 158 11); /* amber-500 */
  box-shadow: 0 0 15px rgba(251, 191, 36, 0.4);
}

.dmx-fader.is-selected:not(.is-overridden) .fader-range::-webkit-slider-thumb {
  background: var(--muted-foreground);
  border-color: color-mix(in srgb, var(--foreground) 20%, transparent);
}

.fader-range.overridden::-webkit-slider-thumb:hover {
  background: rgb(252 211 77); /* amber-300 */
}

/* Firefox styles */
.fader-range::-moz-range-track {
  width: 6px;
  height: 100%;
  background: linear-gradient(
    to top,
    var(--fill-color) 0%,
    var(--fill-color) var(--value-percent),
    var(--track-color) var(--value-percent),
    var(--track-color) 100%
  );
  border-radius: 99px;
  border: 1px solid var(--border);
}
.fader-range::-moz-range-thumb {
  height: 14px;
  width: 22px;
  border-radius: 2px;
  background: var(--muted-foreground);
  border: 1px solid color-mix(in srgb, var(--foreground) 20%, transparent);
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
}
.fader-range.overridden::-moz-range-thumb {
  background: rgb(251 191 36);
}

/* Chrome/Safari: hide spin buttons */
.value-input::-webkit-outer-spin-button,
.value-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox: hide spin buttons */
.value-input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

.preview-box:disabled {
  cursor: default;
}

.dmx-fader:not(.is-overridden):not(.is-selected) .fader-range {
  opacity: 0.6;
}

.dmx-fader.is-overridden .fader-range,
.dmx-fader.is-selected .fader-range {
  opacity: 1;
}
</style>
