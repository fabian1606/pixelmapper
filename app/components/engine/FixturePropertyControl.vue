<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelType } from '~/utils/engine/types';
import type { OflCapability, OflWheel, OflWheelSlot } from '~/utils/ofl/types';
import { getIconForChannel } from '~/utils/engine/channel-categories';
import { useSidebarLock } from '~/utils/engine/composables/use-sidebar-lock';
import { useHistory } from '~/components/engine/composables/use-history';
import { useChannelValueHistory } from './composables/use-channel-value-history';
import { useChannelCapabilities } from './composables/use-channel-capabilities';
import { type SnapshotMap } from './commands/set-channel-values-command';
import FixturePropertyControlBox from './FixturePropertyControlBox.vue';
import FixturePropertyControlDropdown from './FixturePropertyControlDropdown.vue';

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

const {
  capabilities,
  activeCapability,
  resolveSlot,
  capabilityLabel,
  activeSlotColor,
  activeCapabilityLabel
} = useChannelCapabilities(representativeChannel, rawValue, props.type);

// ─── Drag to change value ─────────────────────────────────────────────────────
const isDragging   = ref(false);
const dragStartX   = ref(0);
const dragStartVal = ref(0);



const { captureSnapshots, commitSnapshots } = useChannelValueHistory();
let currentDragSnapshots: SnapshotMap | null = null;

function handleValueChange(newVal: number) {
  const clamped = Math.max(0, Math.min(255, Math.round(newVal)));
  
  // If not dragging, we are in a single-click/input scenario.
  // We must snapshot before the change occurs.
  const isSingleClick = !isDragging.value;
  let singleClickSnapshots: SnapshotMap | null = null;
  if (isSingleClick) {
    singleClickSnapshots = captureSnapshots(props.fixtures);
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
    commitSnapshots(singleClickSnapshots, `Set ${channelLabel.value}`);
  }
}

function startDrag(e: MouseEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  isDragging.value = true;
  dragStartX.value = e.clientX;
  dragStartVal.value = rawValue.value;

  // Snapshot before drag starts
  currentDragSnapshots = captureSnapshots(props.fixtures);

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
    commitSnapshots(currentDragSnapshots, `Drag ${channelLabel.value}`);
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
    <FixturePropertyControlBox
      :type="type"
      :role="role"
      :colorValue="colorValue"
      :rawValue="rawValue"
      :channelIcon="channelIcon"
      :activeSlotColor="activeSlotColor"
      :isDragging="isDragging"
      @dragstart="startDrag"
    />

    <!-- Labels -->
    <div class="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
      <!-- Channel name -->
      <div class="text-sm font-semibold text-foreground truncate">
        {{ channelLabel }}
      </div>

      <!-- Capability sublabel — dropdown trigger -->
      <FixturePropertyControlDropdown
        :type="type"
        :capabilities="capabilities"
        :activeCapability="activeCapability"
        :activeCapabilityLabel="activeCapabilityLabel"
        :resolveSlot="resolveSlot"
        :capabilityLabel="capabilityLabel"
        @update:open="onDropdownOpenChange"
        @select-value="handleValueChange"
      />
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


