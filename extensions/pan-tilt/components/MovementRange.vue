<script setup lang="ts">
/**
 * Movement-range editor (slot `properties/position:after`).
 *
 * Limits where moving heads may point by setting the PAN/TILT channels'
 * output range. Works on every selected fixture with pan/tilt, either with
 * one shared box ("Global") or per fixture. While open, an optional sweep
 * previews the box border on the real heads through the local output
 * preview; "Apply" commits all ranges as one undo step, "Cancel"/Escape/
 * clicking outside discards.
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useExtensionContext, useScope, type ChannelRangeWrite, type FixtureId } from '@pixelmapper/extension-api';
import MovementRangePad from './MovementRangePad.vue';
import MovementRangeSlider from './MovementRangeSlider.vue';

const ctx = useExtensionContext();
const selection = useScope('selection');

/** One fixture's pan/tilt channel indices (coarse channels only). */
interface Target {
  id: FixtureId;
  name: string;
  pan?: { index: number; min: number; max: number };
  tilt?: { index: number; min: number; max: number };
}

/** Selected fixtures that have PAN and/or TILT. */
const targets = computed<Target[]>(() => {
  const out: Target[] = [];
  for (const id of selection.value?.fixtureIds ?? []) {
    const f = ctx.getFixture(id);
    if (!f) continue;
    const find = (type: 'PAN' | 'TILT') => {
      const ch = f.channels.find(c => c.type === type && !c.isFine);
      return ch ? { index: ch.index, min: ch.rangeMin, max: ch.rangeMax } : undefined;
    };
    const t: Target = { id: f.id, name: f.name, pan: find('PAN'), tilt: find('TILT') };
    if (t.pan || t.tilt) out.push(t);
  }
  return out;
});

const multiple = computed(() => targets.value.length > 1);

// ─── Edit state ─────────────────────────────────────────────────────────────

interface RangeBox { panMin: number; panMax: number; tiltMin: number; tiltMax: number }

const open = ref(false);
const mode = ref<'global' | 'perFixture'>('global');
const sweeping = ref(true);
/** Edited boxes by fixture id (committed on Apply). */
const boxes = reactive<Record<string, RangeBox>>({});

/** Box shown in global mode (mirrors the first target). */
const globalBox = computed<RangeBox>(() =>
  boxes[String(targets.value[0]?.id)] ?? { panMin: 0, panMax: 255, tiltMin: 0, tiltMax: 255 });

function initBoxes() {
  for (const k of Object.keys(boxes)) delete boxes[k];
  for (const t of targets.value) {
    boxes[String(t.id)] = {
      panMin: t.pan?.min ?? 0, panMax: t.pan?.max ?? 255,
      tiltMin: t.tilt?.min ?? 0, tiltMax: t.tilt?.max ?? 255,
    };
  }
}

/** Normalizes a partial box (ordered min/max) and patches one target. */
function patch(id: FixtureId, p: Partial<RangeBox>) {
  const box = boxes[String(id)];
  if (!box) return;
  Object.assign(box, p);
  [box.panMin, box.panMax] = [Math.min(box.panMin, box.panMax), Math.max(box.panMin, box.panMax)];
  [box.tiltMin, box.tiltMax] = [Math.min(box.tiltMin, box.tiltMax), Math.max(box.tiltMin, box.tiltMax)];
}

function applyGlobal(p: Partial<RangeBox>) {
  for (const t of targets.value) patch(t.id, p);
}

// ─── Sweep preview ──────────────────────────────────────────────────────────

const SWEEP_PERIOD = 4000;
const sweepPos = ref<Record<string, { pan: number; tilt: number }>>({});
let rafId: number | null = null;

/** Point on the box border at `phase` (0–1), so heads trace the edges. */
function perimeter(box: RangeBox, phase: number) {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const seg = phase * 4;
  if (seg < 1) return { pan: lerp(box.panMin, box.panMax, seg), tilt: box.tiltMin };
  if (seg < 2) return { pan: box.panMax, tilt: lerp(box.tiltMin, box.tiltMax, seg - 1) };
  if (seg < 3) return { pan: lerp(box.panMax, box.panMin, seg - 2), tilt: box.tiltMax };
  return { pan: box.panMin, tilt: lerp(box.tiltMax, box.tiltMin, seg - 3) };
}

function sweepFrame() {
  const phase = (performance.now() % SWEEP_PERIOD) / SWEEP_PERIOD;
  const pos: Record<string, { pan: number; tilt: number }> = {};
  for (const t of targets.value) {
    const box = boxes[String(t.id)];
    if (!box) continue;
    const p = perimeter(box, phase);
    if (t.pan) ctx.preview.setChannel(t.id, t.pan.index, p.pan);
    if (t.tilt) ctx.preview.setChannel(t.id, t.tilt.index, p.tilt);
    pos[String(t.id)] = { pan: Math.round(p.pan), tilt: Math.round(p.tilt) };
  }
  sweepPos.value = pos;
  rafId = requestAnimationFrame(sweepFrame);
}

function startSweep() {
  if (rafId === null) rafId = requestAnimationFrame(sweepFrame);
}

function stopSweep() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  ctx.preview.clear();
  sweepPos.value = {};
}

watch(sweeping, (on) => {
  if (!open.value) return;
  if (on) startSweep();
  else stopSweep();
});

// ─── Open / close ───────────────────────────────────────────────────────────

function openEditor() {
  initBoxes();
  open.value = true;
  if (sweeping.value) startSweep();
}

/** Commits changed ranges as one command. */
function apply() {
  const changes: ChannelRangeWrite[] = [];
  for (const t of targets.value) {
    const box = boxes[String(t.id)];
    if (!box) continue;
    if (t.pan && (box.panMin !== t.pan.min || box.panMax !== t.pan.max)) {
      changes.push({ fixtureId: t.id, channelIndex: t.pan.index, min: box.panMin, max: box.panMax });
    }
    if (t.tilt && (box.tiltMin !== t.tilt.min || box.tiltMax !== t.tilt.max)) {
      changes.push({ fixtureId: t.id, channelIndex: t.tilt.index, min: box.tiltMin, max: box.tiltMax });
    }
  }
  if (changes.length > 0) ctx.run(ctx.commands.setChannelRanges({ changes, description: 'Set Movement Range' }));
  close();
}

function close() {
  stopSweep();
  open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

watch(open, (o) => {
  if (o) window.addEventListener('keydown', onKeydown);
  else window.removeEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  stopSweep();
});
</script>

<template>
  <button
    v-if="targets.length > 0"
    type="button"
    class="w-full inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 h-8 gap-2 px-3 has-[>svg]:px-2.5"
    @click="openEditor"
  >
    <!-- "move" icon -->
    <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2v20M2 12h20M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3" />
    </svg>
    Movement Range
  </button>

  <Teleport to="body">
    <!-- data-overlay-root: clicks here must not close the properties sidebar.
         Styled like the app's shadcn Dialog; a backdrop click does not close
         it (as before), Cancel / X / Escape discard the preview. -->
    <div
      v-if="open"
      data-overlay-root
      class="fixed inset-0 z-[150] bg-black/80 animate-in fade-in-0 flex items-center justify-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-movement-range-title"
        class="relative grid gap-4 w-full max-w-[calc(100%-2rem)] sm:max-w-lg rounded-lg border bg-background p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95"
      >
        <h2 id="pm-movement-range-title" class="text-lg leading-none font-semibold">Movement Range</h2>
        <button
          type="button"
          class="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden"
          aria-label="Close"
          @click="close"
        >
          <!-- "x" icon -->
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div class="flex items-center justify-between">
          <label class="flex items-center gap-2 text-xs text-muted-foreground">
            <input v-model="sweeping" type="checkbox" class="accent-primary">
            Sweep preview
          </label>
          <div v-if="multiple" class="flex rounded-md border border-border overflow-hidden text-[11px]">
            <button
              type="button"
              class="px-2.5 py-1"
              :class="mode === 'global' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'"
              @click="mode = 'global'"
            >
              Global
            </button>
            <button
              type="button"
              class="px-2.5 py-1"
              :class="mode === 'perFixture' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'"
              @click="mode = 'perFixture'"
            >
              One by one
            </button>
          </div>
        </div>

        <p class="text-[11px] text-muted-foreground">
          Drag on the pad to draw the area the heads may move in, then fine-tune below.
        </p>

        <div v-if="mode === 'global'" class="space-y-3">
          <MovementRangePad
            :pan-min="globalBox.panMin" :pan-max="globalBox.panMax"
            :tilt-min="globalBox.tiltMin" :tilt-max="globalBox.tiltMax"
            :sweep-pan="sweepPos[String(targets[0]?.id)]?.pan ?? null"
            :sweep-tilt="sweepPos[String(targets[0]?.id)]?.tilt ?? null"
            @input="applyGlobal"
          />
          <MovementRangeSlider
            v-if="targets.some(t => t.pan)"
            label="Pan" :min="globalBox.panMin" :max="globalBox.panMax"
            @input="applyGlobal({ panMin: $event.min, panMax: $event.max })"
          />
          <MovementRangeSlider
            v-if="targets.some(t => t.tilt)"
            label="Tilt" :min="globalBox.tiltMin" :max="globalBox.tiltMax"
            @input="applyGlobal({ tiltMin: $event.min, tiltMax: $event.max })"
          />
        </div>

        <div v-else class="grid grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1">
          <MovementRangePad
            v-for="t in targets" :key="String(t.id)"
            :label="t.name"
            :pan-min="boxes[String(t.id)]?.panMin ?? 0"
            :pan-max="boxes[String(t.id)]?.panMax ?? 255"
            :tilt-min="boxes[String(t.id)]?.tiltMin ?? 0"
            :tilt-max="boxes[String(t.id)]?.tiltMax ?? 255"
            :sweep-pan="sweepPos[String(t.id)]?.pan ?? null"
            :sweep-tilt="sweepPos[String(t.id)]?.tilt ?? null"
            @input="patch(t.id, $event)"
          />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="inline-flex items-center justify-center h-8 px-3 rounded-md text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50" @click="close">Cancel</button>
          <button type="button" class="inline-flex items-center justify-center h-8 px-3 rounded-md text-sm font-medium transition-all bg-primary text-primary-foreground hover:bg-primary/90" @click="apply">Apply</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
