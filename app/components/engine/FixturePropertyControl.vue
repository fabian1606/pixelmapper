<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelType } from '~/utils/engine/types';
import type { OflCapability, OflWheel, OflWheelSlot } from '~/utils/ofl/types';
import { getIconForChannel } from '~/utils/engine/channel-categories';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSidebarLock } from '~/utils/engine/composables/use-sidebar-lock';
import { useHistory } from '~/components/engine/composables/use-history';
import { SetChannelValuesCommand, createSnapshot, type SnapshotMap } from './commands/set-channel-values-command';

const props = defineProps<{
  type: ChannelType;
  fixtures: Fixture[];
  /** When specified, select the exact channel by name (for same-type disambiguation). */
  oflChannelName?: string;
  activeStep: number;
}>();

const emit = defineEmits<{
  (e: 'change', value: number): void;
  /** Fired before any value is written, allowing the parent to pre-sync other fixtures */
  (e: 'before-change', fixtures: Fixture[]): void;
}>();

const { lock, unlock } = useSidebarLock();

// ─── Representative channel ───────────────────────────────────────────────────
const representativeChannel = computed(() => {
  let bestMatch = null;
  let maxScore = -1;
  const targetName = props.oflChannelName?.toLowerCase().trim();

  for (const f of props.fixtures) {
    let ch = f.channels.find(c => c.type === props.type);
    if (targetName) {
      const exactMatch = f.channels.find(
        c => c.type === props.type && (c.oflChannelName ?? c.type).toLowerCase().trim() === targetName
      );
      if (exactMatch) ch = exactMatch;
    }

    if (ch) {
      const hasNonZero = ch.stepValues.some(v => v !== 0);
      const score = (hasNonZero ? 10000 : 0) + ch.stepValues.length;
      
      if (score > maxScore) {
        maxScore = score;
        bestMatch = ch;
      }
    }
  }

  return bestMatch;
});

const rawValue = ref(representativeChannel.value?.stepValues[props.activeStep] ?? 0);

watch(
  () => representativeChannel.value?.stepValues[props.activeStep],
  (newVal) => {
    if (newVal !== undefined && !isDragging.value) {
      rawValue.value = newVal;
    }
  }
);

const colorValue = computed(() => representativeChannel.value?.colorValue ?? '#888888');
const role      = computed(() => representativeChannel.value?.role ?? 'NONE');
const channelLabel = computed(() => props.oflChannelName ?? representativeChannel.value?.oflChannelName ?? props.type);
const channelIcon  = computed(() => getIconForChannel(props.type, role.value));

// ─── Wheel slot resolution ─────────────────────────────────────────────────────

const oflWheels = computed<Record<string, OflWheel>>(
  () => representativeChannel.value?.oflWheels ?? {}
);

/** Given a capability with a wheel name + slotNumber, resolve the OflWheelSlot. */
function resolveSlot(cap: OflCapability): OflWheelSlot | null {
  const wheelName = cap.wheel;
  if (!wheelName) return null;
  const wheel = oflWheels.value[wheelName];
  if (!wheel) return null;
  const slotIdx = (cap.slotNumber ?? 1) - 1; // OFL slots are 1-based
  return wheel.slots[slotIdx] ?? null;
}

// ─── OFL Capabilities ─────────────────────────────────────────────────────────

const capabilities = computed<OflCapability[]>(() =>
  representativeChannel.value?.oflCapabilities ?? []
);

const activeCapability = computed<OflCapability | null>(() => {
  const caps = capabilities.value;
  if (caps.length === 0) return null;
  if (caps.length === 1) return caps[0] ?? null;
  return caps.find(cap => {
    if (!cap.dmxRange) return false;
    return rawValue.value >= cap.dmxRange[0] && rawValue.value <= cap.dmxRange[1];
  }) ?? caps[0] ?? null;
});

/** Human-readable label for a capability, using resolved wheel slot names. */
function capabilityLabel(cap: OflCapability): string {
  if (cap.comment) return cap.comment;
  if (cap.shutterEffect) return cap.shutterEffect;
  if (cap.effectName) return cap.effectName;
  if (cap.effectPreset) return cap.effectPreset;

  // WheelSlot / WheelShake: resolve from the wheel definition
  if (cap.type === 'WheelSlot' || cap.type === 'WheelShake') {
    // Range (between two slots)
    if (cap.slotNumberStart !== undefined && cap.slotNumberEnd !== undefined) {
      const wheelName = cap.wheel ?? '';
      const wheel = oflWheels.value[wheelName];
      if (wheel) {
        const a = wheel.slots[(cap.slotNumberStart - 1)] ?.name ?? `Slot ${cap.slotNumberStart}`;
        const b = wheel.slots[(cap.slotNumberEnd - 1)]?.name ?? `Slot ${cap.slotNumberEnd}`;
        return `${a} → ${b}`;
      }
      return `Slot ${cap.slotNumberStart}–${cap.slotNumberEnd}`;
    }
    // Single slot
    const slot = resolveSlot(cap);
    if (slot) return slot.name ?? slot.type;
    if (cap.slotNumber !== undefined) return `Slot ${cap.slotNumber}`;
  }

  if (cap.type === 'WheelRotation' || cap.type === 'WheelSlotRotation') {
    const dir = cap.speedStart?.includes('CW') ? 'CW' : cap.speedStart?.includes('CCW') ? 'CCW' : '';
    return dir ? `Rotation ${dir}` : 'Rotation';
  }

  if (cap.speedStart && cap.speedEnd) return `${cap.speedStart} → ${cap.speedEnd}`;
  return cap.type;
}

/** Color hex for the currently active wheel slot (for COLOR_WHEEL only). */
const activeSlotColor = computed<string | null>(() => {
  if (props.type !== 'COLOR_WHEEL') return null;
  const cap = activeCapability.value;
  if (!cap) return null;
  const slot = resolveSlot(cap);
  return slot?.colors?.[0] ?? null;
});

const activeCapabilityLabel = computed(() =>
  activeCapability.value ? capabilityLabel(activeCapability.value) : props.type.toLowerCase()
);

// ─── Drag to change value ─────────────────────────────────────────────────────
const isDragging   = ref(false);
const dragStartX   = ref(0);
const dragStartVal = ref(0);

// Visual box style
const containerStyle = computed(() => {
  if (role.value === 'COLOR') {
    return { boxShadow: `inset 0 0 0 2px ${colorValue.value}80` };
  }
  if (role.value === 'DIMMER') {
    return { boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.3)' };
  }
  return { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' };
});

const rectStyle = computed(() => {
  if (props.type === 'COLOR_WHEEL') {
    // Show the actual current slot colour, or fall back to conic gradient
    if (activeSlotColor.value) {
      return { backgroundColor: activeSlotColor.value };
    }
    return {
      background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
      opacity: 0.8,
    };
  }
  if (role.value === 'COLOR') {
    return { backgroundColor: colorValue.value, opacity: rawValue.value / 255 };
  }
  if (role.value === 'DIMMER') {
    return { backgroundColor: '#ffffff', opacity: rawValue.value / 255 };
  }
  return {};
});

// ─── History Snapshots ────────────────────────────────────────────────────────
const history = useHistory();
let currentDragSnapshots: SnapshotMap | null = null;

function captureSnapshots(): SnapshotMap {
  const map: SnapshotMap = new Map();
  // Snapshot all channels on these fixtures because `emit('before-change')` 
  // might synchronize category states across other channels.
  for (const f of props.fixtures) {
    for (let i = 0; i < f.channels.length; i++) {
      const ch = f.channels[i];
      if (!ch) continue;
      map.set({ fixture: f, channelIndex: i }, {
        before: createSnapshot(ch),
        after: null as any
      });
    }
  }
  return map;
}

function finishSnapshots(map: SnapshotMap, description: string) {
  let changed = false;
  for (const [ref, state] of map.entries()) {
    const ch = ref.fixture.channels[ref.channelIndex];
    if (!ch) continue;
    state.after = createSnapshot(ch);
    
    // Quick diff to see if anything actually changed
    if (
      state.before.colorValue !== state.after.colorValue ||
      JSON.stringify(state.before.stepValues) !== JSON.stringify(state.after.stepValues) ||
      JSON.stringify(state.before.chaserConfig) !== JSON.stringify(state.after.chaserConfig)
    ) {
      changed = true;
    }
  }

  if (changed) {
    history.execute(new SetChannelValuesCommand(map, description));
  }
}

function handleValueChange(newVal: number) {
  const clamped = Math.max(0, Math.min(255, Math.round(newVal)));
  
  // If not dragging, we are in a single-click/input scenario.
  // We must snapshot before the change occurs.
  const isSingleClick = !isDragging.value;
  let singleClickSnapshots: SnapshotMap | null = null;
  if (isSingleClick) {
    singleClickSnapshots = captureSnapshots();
  }

  rawValue.value = clamped;

  // Allow parent to sync category state across all fixtures before we write the specific channel
  emit('before-change', props.fixtures);

  for (const f of props.fixtures) {
    let matchedChannels: typeof f.channels = [];
    
    if (props.oflChannelName) {
      const targetName = props.oflChannelName.toLowerCase().trim();
      matchedChannels = f.channels.filter(c => 
        c.type === props.type && (c.oflChannelName ?? c.type).toLowerCase().trim() === targetName
      );
    } 
    
    if (matchedChannels.length === 0) {
      // Fallback: match all channels of this type if no name specified or exact match fails
      matchedChannels = f.channels.filter(c => c.type === props.type);
    }
    
    for (const ch of matchedChannels) {
      while (ch.stepValues.length <= props.activeStep) {
        ch.stepValues.push(ch.stepValues[ch.stepValues.length - 1] ?? 0);
      }
      ch.stepValues[props.activeStep] = clamped;

      // Ensure that adjusting a value on a fixture that didn't have steps yet initializes its chaserConfig
      // so it actually plays the newly padded sequence.
      if (!ch.chaserConfig && props.activeStep > 0) {
         ch.chaserConfig = {
           stepsCount: props.activeStep + 1,
           activeEditStep: props.activeStep,
           isPlaying: true, // Auto-play if we just inherently activated steps
           stepDurationMs: 1000,
           fadeDurationMs: 0
         };
      } else if (ch.chaserConfig && ch.chaserConfig.stepsCount <= props.activeStep) {
         ch.chaserConfig.stepsCount = props.activeStep + 1;
      }
    }
  }
  emit('change', clamped);

  // If this was a single click, the change is fully complete. Commit history.
  if (isSingleClick && singleClickSnapshots) {
    finishSnapshots(singleClickSnapshots, `Set ${channelLabel.value}`);
  }
}

function startDrag(e: MouseEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  isDragging.value = true;
  dragStartX.value = e.clientX;
  dragStartVal.value = rawValue.value;

  // Snapshot before drag starts
  currentDragSnapshots = captureSnapshots();

  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', stopDrag);
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  const delta = ((e.clientX - dragStartX.value) / 150) * 255;
  handleValueChange(dragStartVal.value + delta);
}

function stopDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  onDrag(e);
  isDragging.value = false;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', stopDrag);

  // Commit history
  if (currentDragSnapshots) {
    finishSnapshots(currentDragSnapshots, `Drag ${channelLabel.value}`);
    currentDragSnapshots = null;
  }
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', stopDrag);
});

// ─── Dropdown lock (prevent sidebar auto-close) ────────────────────────────────
function onDropdownOpenChange(open: boolean) {
  if (open) lock();
  else unlock();
}
</script>

<template>
  <div class="flex items-center gap-3 w-full py-2">
    <!-- Visual Value Box -->
    <div
      class="relative w-12 h-12 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center cursor-ew-resize"
      :class="role !== 'NONE' ? 'bg-white/5' : 'bg-muted/40 text-muted-foreground'"
      :style="containerStyle"
      @mousedown="startDrag"
    >
      <!-- Inset hover ring -->
      <div
        class="absolute inset-0 rounded-xl pointer-events-none hover-inset-ring"
        :class="isDragging ? 'dragging-ring' : ''"
      />

      <!-- Color / dimmer / color-wheel fill -->
      <div
        v-if="role !== 'NONE'"
        class="absolute inset-0 transition-all duration-150"
        :style="rectStyle"
      />

      <!-- Icon overlay for non-color channels or color wheels -->
      <component
        :is="channelIcon"
        v-if="type === 'COLOR_WHEEL' || role === 'NONE'"
        class="w-6 h-6 relative z-10 drop-shadow"
        :style="type === 'COLOR_WHEEL' ? { color: activeSlotColor ? 'white' : 'rgba(255,255,255,0.7)' } : undefined"
      />
    </div>

    <!-- Labels -->
    <div class="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
      <!-- Channel name -->
      <div class="text-sm font-semibold text-foreground truncate">
        {{ channelLabel }}
      </div>

      <!-- Capability sublabel — dropdown trigger -->
      <DropdownMenu @update:open="onDropdownOpenChange">
        <DropdownMenuTrigger as-child>
          <button
            class="text-xs text-muted-foreground hover:text-foreground text-left truncate flex items-center gap-1 w-fit rounded-sm transition-colors focus:outline-none"
            :title="activeCapabilityLabel"
          >
            <span class="truncate max-w-[140px]">{{ activeCapabilityLabel }}</span>
            <span v-if="capabilities.length > 1" class="text-[10px] opacity-40 flex-shrink-0">▼</span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent :align="'start'" class="w-56 max-h-64 overflow-y-auto">
          <template v-if="capabilities.length > 1">
            <DropdownMenuItem
              v-for="(cap, i) in capabilities"
              :key="i"
              class="text-xs gap-2"
              :class="activeCapability === cap ? 'bg-accent/60' : ''"
              @click="cap.dmxRange && handleValueChange(cap.dmxRange[0])"
            >
              <!-- Slot color swatch for color wheel -->
              <div
                v-if="type === 'COLOR_WHEEL' && resolveSlot(cap)?.colors?.[0]"
                class="w-3 h-3 rounded-sm flex-shrink-0"
                :style="{ backgroundColor: resolveSlot(cap)?.colors?.[0] }"
              />
              <span class="flex-1">{{ capabilityLabel(cap) }}</span>
              <span v-if="cap.dmxRange" class="text-muted-foreground ml-1 font-mono text-[10px] flex-shrink-0">
                {{ cap.dmxRange[0] }}
              </span>
            </DropdownMenuItem>
          </template>
          <template v-else>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="text-xs" @click="handleValueChange(0)">Off (0)</DropdownMenuItem>
            <DropdownMenuItem class="text-xs" @click="handleValueChange(127)">Half (127)</DropdownMenuItem>
            <DropdownMenuItem class="text-xs" @click="handleValueChange(255)">Full (255)</DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Editable value number -->
    <div class="flex-shrink-0 cursor-ew-resize" @mousedown="startDrag">
      <input
        type="number"
        :value="rawValue"
        min="0"
        max="255"
        class="w-14 bg-transparent text-right text-lg font-mono font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded px-1 py-1 hover:bg-muted/50 transition-colors"
        @input="e => handleValueChange(Number((e.target as HTMLInputElement).value))"
        @mousedown.stop
        @wheel.prevent="e => handleValueChange(rawValue - Math.sign(e.deltaY))"
      />
    </div>
  </div>
</template>

<style scoped>
.hover-inset-ring:hover {
  box-shadow: inset 0 0 0 1.5px hsl(var(--primary) / 0.5);
}
.dragging-ring {
  box-shadow: inset 0 0 0 1.5px hsl(var(--primary) / 0.8) !important;
}
</style>
