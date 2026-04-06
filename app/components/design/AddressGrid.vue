<script setup lang="ts">
import { computed, ref, onUnmounted, onMounted, nextTick } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { UpdateDmxCommand } from '~/components/engine/commands/update-dmx-command';
import type { Fixture } from '~/utils/engine/core/fixture';

const CELL_W = 32;
const CELL_H = 32;
const CELLS = 512;
const DRAG_THRESHOLD = 3; // px — movement below this counts as click, not drag

const props = defineProps<{ active?: boolean }>();

const engineStore = useEngineStore();
const history = useHistory();

const emit = defineEmits<{
  (e: 'update:visibleUniverse', universe: number): void;
}>();

// ─── Cells per row via ResizeObserver ─────────────────────────────────────────
const cellsPerRow = ref<Record<number, number>>({});
const stripRefs: Record<number, HTMLElement | null> = {};
const observers: ResizeObserver[] = [];

function setStripRef(universe: number, el: HTMLElement | null) {
  stripRefs[universe] = el;
  if (el) {
    const compute = () => {
      const n = Math.max(1, Math.floor(el.offsetWidth / CELL_W));
      if (cellsPerRow.value[universe] !== n) {
        cellsPerRow.value = { ...cellsPerRow.value, [universe]: n };
      }
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    observers.push(ro);
    compute();
  }
}
onMounted(() => nextTick(setupVisibilityTracking));
onUnmounted(() => {
  observers.forEach(o => o.disconnect());
  visibleObservers.forEach(o => o.disconnect());
});

// ─── Universes ────────────────────────────────────────────────────────────────
const usedUniverses = computed(() => {
  const set = new Set<number>();
  for (const f of engineStore.flatFixtures) set.add(f.universe);
  if (set.size === 0) set.add(1);
  return Array.from(set).sort((a, b) => a - b);
});

// ─── Static cell structure (no live values — only recomputes when fixtures or layout change) ──
interface CellData {
  localAddr: number;
  bufIdx: number;
  fixture: Fixture | null;
  isFirstInFixture: boolean;
  isLastInFixture: boolean;
  isLabelCell: boolean;
  labelSpan: number;
}

function buildCells(universe: number, perRow: number): CellData[] {
  const fixtures = engineStore.flatFixtures.filter(f => f.universe === universe);

  const lookup = new Map<number, Fixture>();
  for (const f of fixtures) {
    for (let i = 0; i < f.channels.length; i++) {
      lookup.set(f.localAddress + i, f);
    }
  }

  return Array.from({ length: CELLS }, (_, i) => {
    const localAddr = i + 1;
    const bufIdx = (universe - 1) * 512 + i;
    const fixture = lookup.get(localAddr) ?? null;
    const isFirstInFixture = fixture !== null && fixture.localAddress === localAddr;
    const isLastInFixture  = fixture !== null && fixture.localAddress + fixture.channels.length - 1 === localAddr;
    const colInRow = i % perRow;
    const isLabelCell = fixture !== null && (isFirstInFixture || colInRow === 0);
    let labelSpan = 0;
    if (isLabelCell && fixture) {
      const fixtureEnd = fixture.localAddress + fixture.channels.length - 1;
      const rowEnd = localAddr + (perRow - colInRow) - 1;
      labelSpan = Math.min(fixtureEnd, rowEnd) - localAddr + 1;
    }
    return { localAddr, bufIdx, fixture, isFirstInFixture, isLastInFixture, isLabelCell, labelSpan };
  });
}

// Cached per universe+layout — only rebuilds when fixtures or cellsPerRow changes
const cellsCache = computed(() => {
  const result: Record<number, CellData[]> = {};
  for (const u of usedUniverses.value) {
    result[u] = buildCells(u, cellsPerRow.value[u] ?? 32);
  }
  return result;
});

// ─── Direct DOM Updates for Performance ──────────────────────────────────────
const gridContainerRef = ref<HTMLElement | null>(null);
const cachedLabels: Record<number, { el: HTMLElement; idx: number }[]> = {};
const visibleUniverses = ref(new Set<number>());

// Update any visible DMX value labels directly on buffer change
watchEffect(() => {
  engineStore.bufferRevision; // schedule trigger
  const buf = engineStore.getOutputBuffer();
  if (!buf || buf.length === 0) return;

  for (const u of visibleUniverses.value) {
    const list = cachedLabels[u];
    if (!list) continue;
    for (const { el, idx } of list) {
      if (idx < buf.length) {
        const val = buf[idx]!;
        if (el.textContent !== String(val)) el.textContent = String(val);
      }
    }
  }
});

// Re-cache labels when the grid structure changes (e.g., fixtures added/moved)
watch([cellsCache, gridContainerRef], async () => {
  await nextTick();
  const container = gridContainerRef.value;
  if (!container) return;

  for (const u of usedUniverses.value) {
    const selector = `[data-universe-labels="${u}"] [data-buf-idx]`;
    const nodes = container.querySelectorAll(selector);
    cachedLabels[u] = Array.from(nodes).map(el => ({
      el: el as HTMLElement,
      idx: parseInt((el as HTMLElement).dataset.bufIdx!, 10)
    }));
  }
}, { immediate: true, deep: true });

// ─── Drag ─────────────────────────────────────────────────────────────────────
const dragFixture = ref<Fixture | null>(null);
const dragUniverse = ref(0);
const dragPreviewLocal = ref(0);
const dragPixelOffsetX = ref(0);
const dragPixelOffsetY = ref(0);
// Click-vs-drag detection
const pointerDownPos = ref<{ x: number; y: number } | null>(null);
const didDrag = ref(false);

function onCellPointerDown(e: PointerEvent, fixture: Fixture, universe: number) {
  e.preventDefault();
  pointerDownPos.value = { x: e.clientX, y: e.clientY };
  didDrag.value = false;

  const el = stripRefs[universe];
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const perRow = cellsPerRow.value[universe] ?? 32;
  const fixtureIdx = fixture.localAddress - 1;
  const fixtureRow = Math.floor(fixtureIdx / perRow);
  const fixtureCol = fixtureIdx % perRow;
  const fixturePxX = fixtureCol * CELL_W;
  const fixturePxY = fixtureRow * CELL_H;
  dragPixelOffsetX.value = (e.clientX - rect.left) - fixturePxX;
  dragPixelOffsetY.value = (e.clientY - rect.top) - fixturePxY;

  dragFixture.value = fixture;
  dragUniverse.value = universe;
  dragPreviewLocal.value = fixture.localAddress;
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
}

function onStripPointerMove(e: PointerEvent, universe: number) {
  if (!dragFixture.value || dragUniverse.value !== universe) return;
  // Detect if we've exceeded drag threshold
  if (!didDrag.value && pointerDownPos.value) {
    const dx = e.clientX - pointerDownPos.value.x;
    const dy = e.clientY - pointerDownPos.value.y;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      didDrag.value = true;
    } else {
      return; // Don't move yet — still might be a click
    }
  }
  const el = stripRefs[universe];
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = Math.max(0, e.clientX - rect.left - dragPixelOffsetX.value);
  const y = Math.max(0, e.clientY - rect.top - dragPixelOffsetY.value);
  const perRow = cellsPerRow.value[universe] ?? 32;
  const col = Math.min(Math.floor(x / CELL_W), perRow - 1);
  const row = Math.floor(y / CELL_H);
  const newStart = row * perRow + col + 1;
  const max = CELLS - dragFixture.value.channels.length + 1;
  dragPreviewLocal.value = Math.max(1, Math.min(max, newStart));
}

function onStripPointerUp(e: PointerEvent, universe: number) {
  if (!dragFixture.value || dragUniverse.value !== universe) {
    // Click on empty cell — clear selection
    if (!didDrag.value && !(e.shiftKey || e.metaKey || e.ctrlKey)) {
      engineStore.selectedIds = new Set();
    }
    return;
  }
  const fixture = dragFixture.value;

  if (!didDrag.value) {
    // This was a click, not a drag — handle selection
    dragFixture.value = null;
    const multiple = e.shiftKey || e.metaKey || e.ctrlKey;
    if (multiple) {
      const next = new Set(engineStore.selectedIds);
      next.has(fixture.id) ? next.delete(fixture.id) : next.add(fixture.id);
      engineStore.selectedIds = next;
    } else {
      engineStore.selectedIds = new Set([fixture.id]);
    }
    return;
  }

  // This was a drag — handle address change
  const oldAddr = fixture.startAddress;
  const newAddr = (fixture.universe - 1) * 512 + dragPreviewLocal.value;
  const conflict = ghostIsConflict.value;
  dragFixture.value = null;
  if (newAddr !== oldAddr && !conflict) {
    history.execute(new UpdateDmxCommand(fixture, oldAddr, newAddr));
  }
}

function hasConflict(universe: number, localAddr: number, count: number, excludeId: string | number): boolean {
  // Prevent placing a fixture that would extend beyond the 512 boundary of its universe
  if (localAddr + count - 1 > 512) return true;

  return engineStore.flatFixtures.some(f =>
    f.universe === universe &&
    f.id !== excludeId &&
    localAddr <= f.localAddress + f.channels.length - 1 &&
    localAddr + count - 1 >= f.localAddress
  );
}

function isGhostCell(cell: CellData, universe: number): boolean {
  if (!dragFixture.value || !didDrag.value || dragUniverse.value !== universe) return false;
  return cell.localAddr >= dragPreviewLocal.value &&
    cell.localAddr < dragPreviewLocal.value + dragFixture.value.channels.length;
}

// ─── Visible universe tracking via IntersectionObserver ──────────────────────
const universeRowRefs: Record<number, HTMLElement | null> = {};
const visibleObservers: IntersectionObserver[] = [];
const scrollContainerRef = ref<HTMLElement | null>(null);

function setUniverseRowRef(universe: number, el: HTMLElement | null) {
  universeRowRefs[universe] = el;
}

function setupVisibilityTracking() {
  const container = scrollContainerRef.value;
  if (!container) return;
  visibleObservers.forEach(o => o.disconnect());
  visibleObservers.length = 0;

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const u = Number((entry.target as HTMLElement).dataset.universe);
        if (!u) continue;
        if (entry.isIntersecting) {
          visibleUniverses.value.add(u);
          emit('update:visibleUniverse', u);
        } else {
          visibleUniverses.value.delete(u);
        }
      }
    },
    { root: container, threshold: 0.1 }
  );
  for (const u of usedUniverses.value) {
    const el = universeRowRefs[u];
    if (el) io.observe(el);
  }
  visibleObservers.push(io);
}

function scrollToUniverse(universe: number) {
  const el = universeRowRefs[universe];
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

defineExpose({ scrollToUniverse });

const ghostIsConflict = computed(() => {
  if (!dragFixture.value) return false;
  return hasConflict(dragUniverse.value, dragPreviewLocal.value, dragFixture.value.channels.length, dragFixture.value.id);
});
</script>

<template>
  <div ref="gridContainerRef" class="flex-1 min-h-0 min-w-0 border-b border-border/40 bg-background flex flex-col">
    <div ref="scrollContainerRef" class="flex-1 overflow-y-auto min-h-0">
      <div class="p-2 flex flex-col gap-2">
        <div
          v-for="universe in usedUniverses"
          :key="universe"
          :ref="(el) => setUniverseRowRef(universe, el as HTMLElement | null)"
          :data-universe="universe"
          class="flex gap-1.5 items-start"
        >
          <!-- Universe Label -->
          <div class="text-[10px] font-bold text-muted-foreground/50 w-5 shrink-0 pt-1 text-right select-none">
            U{{ universe }}
          </div>

          <!-- Universe Strip -->
          <div
            :ref="(el) => setStripRef(universe, el as HTMLElement | null)"
            :data-universe-labels="universe"
            class="flex flex-wrap flex-1"
            @pointermove="onStripPointerMove($event, universe)"
            @pointerup="onStripPointerUp($event, universe)"
            @pointercancel="onStripPointerUp($event, universe)"
          >
            <div
              v-for="cell in cellsCache[universe]"
              :key="cell.localAddr"
              class="relative shrink-0 overflow-visible"
              :class="cell.fixture ? 'cursor-grab' : ''"
              :style="{ width: CELL_W + 'px', height: CELL_H + 'px' }"
              :title="cell.fixture ? `${cell.fixture.name} — Ch ${cell.localAddr}` : `Ch ${cell.localAddr}`"
              @pointerdown="cell.fixture ? onCellPointerDown($event, cell.fixture, universe) : undefined"
            >
              <!-- Original Fixture Content (dimmed when dragging) -->
              <div
                class="absolute inset-0 z-0 transition-opacity"
                :class="dragFixture?.id === cell.fixture?.id && didDrag ? 'opacity-30' : 'opacity-100'"
              >
                <!-- Fixture background -->
                <div
                  v-if="cell.fixture"
                  class="absolute z-0"
                  :class="[
                    cell.isFirstInFixture ? 'left-px rounded-l-sm' : 'left-0',
                    cell.isLastInFixture ? 'right-px rounded-r-sm' : 'right-0',
                  ]"
                  :style="{
                    top: '1px',
                    bottom: '1px',
                    background: engineStore.selectedIds.has(cell.fixture.id)
                      ? 'rgba(251, 191, 36, 0.25)'
                      : '#2a2a2a',
                  }"
                />

                <!-- Selection border -->
                <div
                  v-if="cell.fixture && engineStore.selectedIds.has(cell.fixture.id)"
                  class="absolute z-10 pointer-events-none"
                  :class="[
                    cell.isFirstInFixture ? 'rounded-l-sm' : '',
                    cell.isLastInFixture ? 'rounded-r-sm' : '',
                  ]"
                  :style="{
                    top: '1px',
                    bottom: '1px',
                    left: '0',
                    right: '0',
                    borderTop: '1px solid rgb(251 191 36)',
                    borderBottom: '1px solid rgb(251 191 36)',
                    borderLeft: cell.isFirstInFixture ? '1px solid rgb(251 191 36)' : 'none',
                    borderRight: cell.isLastInFixture ? '1px solid rgb(251 191 36)' : 'none',
                  }"
                />

                <!-- Empty cell markers -->
                <template v-if="!cell.fixture">
                  <div class="absolute inset-0 border border-border/10" />
                  <span class="absolute top-0 left-0 px-1 pt-[3px] text-[7px] text-muted-foreground/30 leading-tight pointer-events-none select-none tabular-nums">
                    {{ cell.localAddr }}
                  </span>
                  <span
                    class="absolute left-0 right-0 text-center text-[7px] text-muted-foreground/20 leading-none pointer-events-none z-10 tabular-nums"
                    style="bottom: 4px"
                    :data-buf-idx="cell.bufIdx"
                  />
                </template>

                <!-- Fixture Name Label -->
                <div
                  v-if="cell.isLabelCell && cell.fixture"
                  class="absolute top-0 left-0 flex flex-col justify-start px-1 pointer-events-none z-10"
                  :style="{ width: cell.labelSpan * CELL_W + 'px', paddingTop: '3px' }"
                >
                  <span class="text-[8px] font-semibold text-white/90 leading-tight truncate">
                    {{ cell.fixture.name }}
                    <span v-if="cell.isFirstInFixture" class="font-normal text-white/50">
                      · {{ cell.fixture.fixtureType || cell.fixture.channels.length + 'ch' }} · {{ cell.fixture.localAddress }}
                    </span>
                  </span>
                </div>

                <!-- DMX Value Label -->
                <span
                  v-if="cell.fixture"
                  class="absolute left-0 right-0 text-center text-[7px] text-white/40 leading-none pointer-events-none z-10 tabular-nums"
                  style="bottom: 4px"
                  :data-buf-idx="cell.bufIdx"
                />
              </div>

              <!-- Drag Ghost Overlay (NOT dimmed) -->
              <div
                v-if="isGhostCell(cell, universe)"
                class="absolute inset-0 z-30 rounded-sm"
                :class="ghostIsConflict ? 'bg-red-500/60' : 'bg-primary/60'"
              >
                <!-- Address Label (fully opaque, shadow) -->
                <div
                  v-if="cell.localAddr === dragPreviewLocal"
                  class="absolute -top-5 left-0 px-1 py-0.5 rounded shadow-[0_2px_8px_rgba(0,0,0,0.5)] text-[10px] font-bold z-50 whitespace-nowrap pointer-events-none border border-black/20"
                  :class="ghostIsConflict ? 'bg-red-600 text-white' : 'bg-primary text-primary-foreground'"
                >
                  {{ cell.localAddr }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
