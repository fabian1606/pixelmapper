<script setup lang="ts">
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import type { ChannelSection } from './composables/use-channel-sections';
import type { Channel } from '~/utils/engine/core/channel';
import type { Fixture } from '~/utils/engine/core/fixture';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Move } from 'lucide-vue-next';
import { useHistory } from './composables/use-history';
import { SetChannelRangeCommand, type RangeSnapshotMap } from './commands/set-channel-range-command';
import { useEngineStore } from '~/stores/engine-store';
import MovementRangePad from './MovementRangePad.vue';
import MovementRangeSlider from './MovementRangeSlider.vue';

const props = defineProps<{
  channelSections: ChannelSection[];
}>();

const history = useHistory();
const engineStore = useEngineStore();

interface Target {
  fixture: Fixture;
  panCh?: Channel;
  tiltCh?: Channel;
}

const targets = computed<Target[]>(() => {
  const map = new Map<string, Target>();
  for (const section of props.channelSections) {
    for (const entry of section.entries) {
      if (entry.channelType !== 'PAN' && entry.channelType !== 'TILT') continue;
      for (const fixture of entry.fixtures) {
        if (!map.has(String(fixture.id))) map.set(String(fixture.id), { fixture });
        const t = map.get(String(fixture.id))!;
        const ch = fixture.channels.find(c =>
          c.type === entry.channelType &&
          (c.oflChannelName ?? c.type) === (entry.oflChannelName ?? entry.channelType) &&
          !c.isFine,
        );
        if (ch) {
          if (entry.channelType === 'PAN') t.panCh = ch;
          if (entry.channelType === 'TILT') t.tiltCh = ch;
        }
      }
    }
  }
  return Array.from(map.values()).filter(t => t.panCh || t.tiltCh);
});

const hasMovement = computed(() => targets.value.length > 0);
const multiple = computed(() => targets.value.length > 1);

const open = ref(false);
const mode = ref<'global' | 'perFixture'>('global');
const sweeping = ref(true);

// ─── Range read/write helpers ─────────────────────────────────────────────────
function rmin(ch?: Channel) { return ch?.rangeMin ?? 0; }
function rmax(ch?: Channel) { return ch?.rangeMax ?? 255; }
function bufIndex(f: Fixture, ch: Channel) { return f.startAddress - 1 + ch.addressOffset; }

// ─── Local reactive edit state ──────────────────────────────────────────────────
// Channel objects are markRaw'd in the store, so mutating ch.rangeMin doesn't
// drive Vue reactivity. We keep a reactive mirror as the UI source of truth and
// write through to the (non-reactive) channels for the engine.
interface RangeBox { panMin: number; panMax: number; tiltMin: number; tiltMax: number }
const editRanges = reactive<Record<string, RangeBox>>({});

// In global mode the shared pad/sliders mirror the first target's box.
const gv = computed<RangeBox>(() => {
  const id = String(targets.value[0]?.fixture.id);
  return editRanges[id] ?? { panMin: 0, panMax: 255, tiltMin: 0, tiltMax: 255 };
});

function initEditRanges() {
  for (const k of Object.keys(editRanges)) delete editRanges[k];
  for (const t of targets.value) {
    editRanges[String(t.fixture.id)] = {
      panMin: rmin(t.panCh), panMax: rmax(t.panCh),
      tiltMin: rmin(t.tiltCh), tiltMax: rmax(t.tiltCh),
    };
  }
}

// Push the reactive box into the raw channel objects + flush the engine.
function writeChannels(t: Target) {
  const box = editRanges[String(t.fixture.id)];
  if (!box) return;
  if (t.panCh) { t.panCh.rangeMin = box.panMin; t.panCh.rangeMax = box.panMax; }
  if (t.tiltCh) { t.tiltCh.rangeMin = box.tiltMin; t.tiltCh.rangeMax = box.tiltMax; }
}

function patch(t: Target, p: Partial<RangeBox>) {
  Object.assign(editRanges[String(t.fixture.id)], p);
  writeChannels(t);
}

// ─── Input handlers ─────────────────────────────────────────────────────────────
function applyGlobalPan(min: number, max: number) {
  for (const t of targets.value) patch(t, { panMin: Math.min(min, max), panMax: Math.max(min, max) });
  engineStore.flushEngineOutput();
}
function applyGlobalTilt(min: number, max: number) {
  for (const t of targets.value) patch(t, { tiltMin: Math.min(min, max), tiltMax: Math.max(min, max) });
  engineStore.flushEngineOutput();
}
function applyGlobalRect(r: RangeBox) {
  for (const t of targets.value) patch(t, r);
  engineStore.flushEngineOutput();
}
function applyFixtureRect(t: Target, r: RangeBox) {
  patch(t, r);
  engineStore.flushEngineOutput();
}

// ─── History snapshot of original channel values ────────────────────────────────
let originals: Map<Channel, { rangeMin: number; rangeMax: number }> | null = null;

function snapshotOriginals() {
  originals = new Map();
  for (const t of targets.value) {
    if (t.panCh) originals.set(t.panCh, { rangeMin: rmin(t.panCh), rangeMax: rmax(t.panCh) });
    if (t.tiltCh) originals.set(t.tiltCh, { rangeMin: rmin(t.tiltCh), rangeMax: rmax(t.tiltCh) });
  }
}

// ─── Sweep preview ──────────────────────────────────────────────────────────────
const SWEEP_PERIOD = 4000;
const sweepPos = ref<Record<string, { pan: number; tilt: number }>>({});
const overridden = new Set<number>();
let rafId: number | null = null;

// Trace the rectangle border (perimeter loop) so heads move along the edges
// of the allowed area rather than cutting diagonally through the middle.
function perimeter(box: RangeBox, phase: number) {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const seg = phase * 4;
  if (seg < 1) return { pan: lerp(box.panMin, box.panMax, seg), tilt: box.tiltMin };
  if (seg < 2) return { pan: box.panMax, tilt: lerp(box.tiltMin, box.tiltMax, seg - 1) };
  if (seg < 3) return { pan: lerp(box.panMax, box.panMin, seg - 2), tilt: box.tiltMax };
  return { pan: box.panMin, tilt: lerp(box.tiltMax, box.tiltMin, seg - 3) };
}

function sweepFrame() {
  const now = performance.now();
  const phase = (now % SWEEP_PERIOD) / SWEEP_PERIOD;
  const pos: Record<string, { pan: number; tilt: number }> = {};
  for (const t of targets.value) {
    const box = editRanges[String(t.fixture.id)];
    if (!box) continue;
    const { pan: panF, tilt: tiltF } = perimeter(box, phase);
    let pan = 0, tilt = 0;
    if (t.panCh) {
      pan = Math.round(panF);
      const idx = bufIndex(t.fixture, t.panCh);
      engineStore.setOverride(idx, pan);
      overridden.add(idx);
    }
    if (t.tiltCh) {
      tilt = Math.round(tiltF);
      const idx = bufIndex(t.fixture, t.tiltCh);
      engineStore.setOverride(idx, tilt);
      overridden.add(idx);
    }
    pos[String(t.fixture.id)] = { pan, tilt };
  }
  sweepPos.value = pos;
  rafId = requestAnimationFrame(sweepFrame);
}

function startSweep() {
  if (rafId != null) return;
  rafId = requestAnimationFrame(sweepFrame);
}
function stopSweep(clear = true) {
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  if (clear) {
    for (const idx of overridden) engineStore.clearOverride(idx);
    overridden.clear();
    sweepPos.value = {};
  }
}

watch(sweeping, (on) => {
  if (!open.value) return;
  if (on) startSweep(); else stopSweep();
});

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

function openEditor() {
  snapshotOriginals();
  initEditRanges();
  open.value = true;
  if (sweeping.value) startSweep();
  document.addEventListener('pointerdown', onDocPointerDown, true);
}

let cancelRequested = false;

function commit() {
  const snapshots: RangeSnapshotMap = new Map();
  for (const [ch, before] of originals!.entries()) {
    const fixture = targets.value.find(t => t.panCh === ch || t.tiltCh === ch)?.fixture;
    if (!fixture) continue;
    const channelIndex = fixture.channels.indexOf(ch);
    if (channelIndex < 0) continue;
    const after = { rangeMin: rmin(ch), rangeMax: rmax(ch) };
    if (after.rangeMin !== before.rangeMin || after.rangeMax !== before.rangeMax) {
      snapshots.set({ fixture, channelIndex }, { before, after });
    }
  }
  if (snapshots.size > 0) history.execute(new SetChannelRangeCommand(snapshots, 'Set Movement Range'));
}

function revert() {
  for (const [ch, orig] of originals!.entries()) {
    ch.rangeMin = orig.rangeMin;
    ch.rangeMax = orig.rangeMax;
  }
  engineStore.flushEngineOutput();
}

function commitAndClose() { cancelRequested = false; open.value = false; }
function cancelAndClose() { cancelRequested = true; open.value = false; }

// Single close path: stop the sweep, then either keep edits (default) or revert.
watch(open, (o) => {
  if (o) return;
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  stopSweep();
  if (originals) {
    if (cancelRequested) revert(); else commit();
    originals = null;
  }
  cancelRequested = false;
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  stopSweep();
});
</script>

<template>
  <Button
    v-if="hasMovement"
    variant="outline"
    size="sm"
    class="w-full gap-2"
    @click="openEditor"
  >
    <Move class="h-3.5 w-3.5" />
    Movement Range
  </Button>

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
      <DialogTitle>Movement Range</DialogTitle>

      <div class="flex items-center justify-between">
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" v-model="sweeping" class="accent-primary" />
          Sweep preview
        </label>
        <div v-if="multiple" class="flex rounded-md border border-border overflow-hidden text-[11px]">
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

      <p class="text-[11px] text-muted-foreground">
        Drag on the pad to draw the area the heads may move in, then fine-tune below.
      </p>

      <!-- Global -->
      <div v-if="mode === 'global'" class="space-y-3">
        <MovementRangePad
          :pan-min="gv.panMin" :pan-max="gv.panMax"
          :tilt-min="gv.tiltMin" :tilt-max="gv.tiltMax"
          :sweep-pan="sweepPos[String(targets[0]?.fixture.id)]?.pan ?? null"
          :sweep-tilt="sweepPos[String(targets[0]?.fixture.id)]?.tilt ?? null"
          @input="applyGlobalRect"
        />
        <MovementRangeSlider
          v-if="targets.some(t => t.panCh)"
          label="Pan" :min="gv.panMin" :max="gv.panMax"
          @input="applyGlobalPan($event.min, $event.max)"
        />
        <MovementRangeSlider
          v-if="targets.some(t => t.tiltCh)"
          label="Tilt" :min="gv.tiltMin" :max="gv.tiltMax"
          @input="applyGlobalTilt($event.min, $event.max)"
        />
      </div>

      <!-- One by one -->
      <div v-else class="grid grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1">
        <MovementRangePad
          v-for="t in targets" :key="String(t.fixture.id)"
          :label="t.fixture.name"
          :pan-min="editRanges[String(t.fixture.id)]?.panMin ?? 0"
          :pan-max="editRanges[String(t.fixture.id)]?.panMax ?? 255"
          :tilt-min="editRanges[String(t.fixture.id)]?.tiltMin ?? 0"
          :tilt-max="editRanges[String(t.fixture.id)]?.tiltMax ?? 255"
          :sweep-pan="sweepPos[String(t.fixture.id)]?.pan ?? null"
          :sweep-tilt="sweepPos[String(t.fixture.id)]?.tilt ?? null"
          @input="applyFixtureRect(t, $event)"
        />
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" @click="cancelAndClose">Cancel</Button>
        <Button size="sm" @click="commitAndClose">Apply</Button>
      </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
