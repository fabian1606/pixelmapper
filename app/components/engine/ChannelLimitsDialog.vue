<script setup lang="ts">
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import type { ChannelType } from '~/utils/engine/types';
import type { Channel } from '~/utils/engine/core/channel';
import type { Fixture } from '~/utils/engine/core/fixture';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Replaceable from '~/components/extension-host/Replaceable.vue';
import { useHistory } from './composables/use-history';
import { SetChannelRangeCommand, type RangeSnapshotMap } from './commands/set-channel-range-command';
import { useEngineStore } from '~/stores/engine-store';
import MovementRangeSlider from './MovementRangeSlider.vue';

export interface ChannelLimitsEntry {
  channelType: ChannelType;
  oflChannelName?: string;
  fixtures: Fixture[];
}

const history = useHistory();
const engineStore = useEngineStore();

interface Target {
  fixture: Fixture;
  ch: Channel;
}

const entry = ref<ChannelLimitsEntry | null>(null);

const targets = computed<Target[]>(() => {
  if (!entry.value) return [];
  const { channelType, oflChannelName, fixtures } = entry.value;
  const targetName = oflChannelName?.toLowerCase().trim();
  const result: Target[] = [];
  for (const fixture of fixtures) {
    let ch = fixture.channels.find(c => c.type === channelType && !c.isFine);
    if (targetName) {
      const exact = fixture.channels.find(
        c => c.type === channelType && !c.isFine &&
          (c.oflChannelName ?? c.type).toLowerCase().trim() === targetName,
      );
      if (exact) ch = exact;
    }
    if (ch) result.push({ fixture, ch });
  }
  return result;
});

const channelLabel = computed(() =>
  entry.value?.oflChannelName ?? entry.value?.channelType ?? 'Channel');
const multiple = computed(() => targets.value.length > 1);

const open = ref(false);
const mode = ref<'global' | 'perFixture'>('global');

// ─── Local reactive edit state ──────────────────────────────────────────────────
// Channel objects are markRaw'd in the store, so mutating ch.rangeMin doesn't
// drive Vue reactivity. We keep a reactive mirror as the UI source of truth and
// write through to the (non-reactive) channels for the engine.
interface LimitBox { min: number; max: number; def: number }
const editState = reactive<Record<string, LimitBox>>({});

// In global mode the shared slider/input mirror the first target's box.
const gv = computed<LimitBox>(() => {
  const id = String(targets.value[0]?.fixture.id);
  return editState[id] ?? { min: 0, max: 255, def: 0 };
});

function initEditState() {
  for (const k of Object.keys(editState)) delete editState[k];
  for (const t of targets.value) {
    editState[String(t.fixture.id)] = {
      min: t.ch.rangeMin ?? 0,
      max: t.ch.rangeMax ?? 255,
      def: t.ch.defaultValue ?? 0,
    };
  }
}

// Push the reactive box into the raw channel objects.
function writeChannel(t: Target) {
  const box = editState[String(t.fixture.id)];
  if (!box) return;
  t.ch.rangeMin = box.min;
  t.ch.rangeMax = box.max;
  t.ch.defaultValue = box.def;
}

function patch(t: Target, p: Partial<LimitBox>, flush: boolean) {
  Object.assign(editState[String(t.fixture.id)]!, p);
  writeChannel(t);
  if (flush) engineStore.flushEngineOutput();
}

// ─── Input handlers ─────────────────────────────────────────────────────────────
function applyGlobalRange(min: number, max: number) {
  for (const t of targets.value) patch(t, { min: Math.min(min, max), max: Math.max(min, max) }, false);
  engineStore.flushEngineOutput();
}
function applyGlobalDefault(def: number) {
  const clamped = Math.max(0, Math.min(255, Math.round(def)));
  for (const t of targets.value) patch(t, { def: clamped }, false);
}
function applyFixtureRange(t: Target, min: number, max: number) {
  patch(t, { min: Math.min(min, max), max: Math.max(min, max) }, true);
}
function applyFixtureDefault(t: Target, def: number) {
  patch(t, { def: Math.max(0, Math.min(255, Math.round(def))) }, false);
}

// ─── History snapshot of original channel values ────────────────────────────────
interface OriginalState { rangeMin: number; rangeMax: number; defaultValue: number }
let originals: Map<Channel, OriginalState> | null = null;

function snapshotOriginals() {
  originals = new Map();
  for (const t of targets.value) {
    originals.set(t.ch, {
      rangeMin: t.ch.rangeMin ?? 0,
      rangeMax: t.ch.rangeMax ?? 255,
      defaultValue: t.ch.defaultValue ?? 0,
    });
  }
}

// ─── Open / close lifecycle ────────────────────────────────────────────────────
const contentEl = ref<HTMLElement | null>(null);

// reka-ui's built-in dismiss is unreliable when the dialog is nested inside the
// sidebar overlay (Vue ignores `.prevent` on component events, so it can't be
// suppressed). We fully disable reka's dismiss (preventClose) and detect outside
// clicks ourselves against the real dialog-content root.
function preventClose(e: Event) { e.preventDefault?.(); }

function onDocPointerDown(e: PointerEvent) {
  if (!open.value) return;
  const root = contentEl.value?.closest('[data-slot="dialog-content"]');
  if (root && !root.contains(e.target as Node)) cancelAndClose();
}

function openEditor(newEntry: ChannelLimitsEntry) {
  entry.value = newEntry;
  if (targets.value.length === 0) return;
  mode.value = 'global';
  snapshotOriginals();
  initEditState();
  open.value = true;
  document.addEventListener('pointerdown', onDocPointerDown, true);
}

defineExpose({ open: openEditor });

let cancelRequested = false;

function commit() {
  const snapshots: RangeSnapshotMap = new Map();
  for (const [ch, before] of originals!.entries()) {
    const fixture = targets.value.find(t => t.ch === ch)?.fixture;
    if (!fixture) continue;
    const channelIndex = fixture.channels.indexOf(ch);
    if (channelIndex < 0) continue;
    const after: OriginalState = {
      rangeMin: ch.rangeMin ?? 0,
      rangeMax: ch.rangeMax ?? 255,
      defaultValue: ch.defaultValue ?? 0,
    };
    if (
      after.rangeMin !== before.rangeMin ||
      after.rangeMax !== before.rangeMax ||
      after.defaultValue !== before.defaultValue
    ) {
      snapshots.set({ fixture, channelIndex }, { before, after });
    }
  }
  if (snapshots.size > 0) {
    history.execute(new SetChannelRangeCommand(snapshots, `Set ${channelLabel.value} Settings`));
  }
}

function revert() {
  for (const [ch, orig] of originals!.entries()) {
    ch.rangeMin = orig.rangeMin;
    ch.rangeMax = orig.rangeMax;
    ch.defaultValue = orig.defaultValue;
  }
  engineStore.flushEngineOutput();
}

function commitAndClose() { cancelRequested = false; open.value = false; }
function cancelAndClose() { cancelRequested = true; open.value = false; }

// Single close path: either keep edits (default) or revert.
watch(open, (o) => {
  if (o) return;
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  if (originals) {
    if (cancelRequested) revert(); else commit();
    originals = null;
  }
  cancelRequested = false;
  entry.value = null;
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true);
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="max-w-lg"
      @escape-key-down="cancelAndClose"
      @pointer-down-outside="preventClose"
      @interact-outside="preventClose"
      @focus-outside="preventClose"
    >
      <!-- Stop pointer events from bubbling to the canvas/sidebar document
           handler that would otherwise unmount this overlay mid-interaction. -->
      <div ref="contentEl" class="contents" @pointerdown.stop @mousedown.stop @click.stop>
      <DialogTitle>{{ channelLabel }} — Channel Settings</DialogTitle>

      <div class="flex items-center justify-between">
        <p class="text-[11px] text-muted-foreground">
          Output is remapped into the limit range. Default is the reset value.
        </p>
        <div v-if="multiple" class="flex rounded-md border border-border overflow-hidden text-[11px] flex-shrink-0">
          <button
            class="px-2.5 py-1"
            :class="mode === 'global' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'"
            @click="mode = 'global'"
          >Global</button>
          <button
            class="px-2.5 py-1"
            :class="mode === 'perFixture' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'"
            @click="mode = 'perFixture'"
          >One by one</button>
        </div>
      </div>

      <!-- Global -->
      <div v-if="mode === 'global'" class="space-y-3">
        <MovementRangeSlider
          label="Limit"
          :min="gv.min" :max="gv.max"
          @input="applyGlobalRange($event.min, $event.max)"
        />
        <div class="flex items-center justify-between gap-3">
          <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Default value</span>
          <Replaceable
        name="pm.numberInput"
            class="w-20"
            :model-value="gv.def"
            :min="0"
            :max="255"
            @update:model-value="applyGlobalDefault"
          />
        </div>
      </div>

      <!-- One by one -->
      <div v-else class="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
        <div v-for="t in targets" :key="String(t.fixture.id)" class="space-y-1.5">
          <div class="text-xs font-semibold text-foreground truncate">{{ t.fixture.name }}</div>
          <MovementRangeSlider
            label="Limit"
            :min="editState[String(t.fixture.id)]?.min ?? 0"
            :max="editState[String(t.fixture.id)]?.max ?? 255"
            @input="applyFixtureRange(t, $event.min, $event.max)"
          />
          <div class="flex items-center justify-between gap-3">
            <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Default value</span>
            <Replaceable
        name="pm.numberInput"
              class="w-20"
              :model-value="editState[String(t.fixture.id)]?.def ?? 0"
              :min="0"
              :max="255"
              @update:model-value="applyFixtureDefault(t, $event)"
            />
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" @click="cancelAndClose">Cancel</Button>
        <Button size="sm" @click="commitAndClose">Apply</Button>
      </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
