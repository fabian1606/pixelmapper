import { computed, ref, type Ref } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Point } from './use-camera';
import type { FixturePositionSnapshot } from '../commands/move-fixture-command';
import { useEngineStore } from '~/stores/engine-store';
import {
  fixtureCenterWorld,
  fixtureFootprint,
  pointInFootprint,
  selectedLeafFixtures,
  swapByCenters,
  type FixtureFootprint,
  type SwapAnchor,
  type WorldPoint,
} from '~/utils/engine/swap-positions';

/** Pick-up radius of a swap handle, in CSS px. */
const SWAP_HANDLE_HIT_PX = 7;
/** Extra hover margin around a fixture's original place, in CSS px (keeps tiny fixtures reachable). */
const HOVER_ZONE_PAD_PX = 4;
/** Above this many selected fixtures the handles are hidden (clutter + per-frame cost). */
const MAX_SWAP_HANDLES = 400;

/** A swap handle in viewport coordinates. */
export interface SwapHandle {
  id: string | number;
  x: number;
  y: number;
}

/** Ghost outline of a fixture at its would-be position, in viewport coordinates. */
export interface SwapGhost {
  id: string | number;
  /** Center in viewport px. */
  x: number;
  y: number;
  /** Half extents in viewport px (already scaled by the camera). */
  halfW: number;
  halfH: number;
  /** Rotation in degrees. */
  rotation: number;
}

/** Active swap drag: the grabbed fixture and the fixture currently swapped out of its place. */
export interface SwapDrag {
  sourceId: string | number;
  targetId: string | number | null;
}

/** A fixture's pre-drag state: placement, plus the footprint that forms its hover zone. */
interface Original extends SwapAnchor {
  fixture: Fixture;
  footprint: FixtureFootprint;
}

interface UseSwapHandlesOptions {
  getFixtures: () => Fixture[];
  selectedIds: Ref<Set<string | number>>;
  worldWidth: number;
  worldHeight: number;
  worldToViewport: (wx: number, wy: number) => Point;
  viewportToWorld: (vx: number, vy: number) => Point;
  /** Camera zoom — world px ↔ viewport px. */
  getScale: () => number;
  /** False while another tool or interaction owns the pointer — handles hide. */
  isAvailable: () => boolean;
  /** Redraws after fixtures were moved directly (drag follow, partner move, revert). */
  onLayoutChange: () => void;
  /** Commits the swap (one undo step). */
  onSwap: (before: FixturePositionSnapshot[], after: FixturePositionSnapshot[]) => void;
}

/**
 * Figma-style swap handles. With two or more fixtures selected, every
 * selected fixture shows a dot at its center. Dragging a dot:
 *  - the grabbed fixture follows the pointer;
 *  - hovering another fixture's ORIGINAL place (its pre-drag footprint) moves
 *    that fixture into the grabbed fixture's original place and shows a ghost
 *    of the grabbed fixture where it will land; moving off puts it back;
 *  - releasing on a partner snaps the grabbed fixture into the ghost (one
 *    undo step); releasing elsewhere snaps it back to where it started.
 */
export function useSwapHandles(opts: UseSwapHandlesOptions) {
  const engineStore = useEngineStore();
  const swapDrag = ref<SwapDrag | null>(null);

  /** Pre-drag state of every fixture — hover zones and revert targets. Filled at drag start. */
  let originals = new Map<string | number, Original>();
  /** Pointer → source origin offset (normalized), so the fixture doesn't jump to the cursor. */
  let grabOffset: WorldPoint = { x: 0, y: 0 };

  /** Viewport-space handles of the current multi-selection (hidden during a swap drag). */
  const handles = computed<SwapHandle[]>(() => {
    if (swapDrag.value || !opts.isAvailable()) return [];
    // Fixture positions are plain fields — layoutRevision is their change signal.
    void engineStore.layoutRevision;
    const selected = selectedLeafFixtures(opts.getFixtures(), opts.selectedIds.value);
    if (selected.length < 2 || selected.length > MAX_SWAP_HANDLES) return [];
    return selected.map((f) => {
      const c = fixtureCenterWorld(f, opts.worldWidth, opts.worldHeight);
      const v = opts.worldToViewport(c.x, c.y);
      return { id: f.id, x: v.x, y: v.y };
    });
  });

  /** Ghost of the grabbed fixture at the hovered partner's original place. */
  const ghosts = computed<SwapGhost[]>(() => {
    const drag = swapDrag.value;
    if (!drag || drag.targetId === null) return [];
    const source = originals.get(drag.sourceId);
    const target = originals.get(drag.targetId);
    if (!source || !target) return [];
    const scale = opts.getScale();
    const v = opts.worldToViewport(target.center.x, target.center.y);
    const fp = source.footprint;
    return [{ id: drag.sourceId, x: v.x, y: v.y, halfW: fp.halfW * scale, halfH: fp.halfH * scale, rotation: fp.rotation }];
  });

  /** Nearest handle within the pick-up radius of a viewport point. */
  function handleAt(vx: number, vy: number): SwapHandle | null {
    let best: SwapHandle | null = null;
    let bestDist = SWAP_HANDLE_HIT_PX;
    for (const h of handles.value) {
      const d = Math.hypot(h.x - vx, h.y - vy);
      if (d <= bestDist) { best = h; bestDist = d; }
    }
    return best;
  }

  /** True when the point is over a swap handle (cursor feedback). */
  function isOverHandle(vx: number, vy: number): boolean {
    return handleAt(vx, vy) !== null;
  }

  /** Partner whose original footprint contains the world point (nearest center wins on overlap). */
  function zoneAt(p: WorldPoint, sourceId: string | number): string | number | null {
    const pad = HOVER_ZONE_PAD_PX / (opts.getScale() || 1);
    let best: string | number | null = null;
    let bestDist = Infinity;
    for (const [id, o] of originals) {
      if (id === sourceId || !pointInFootprint(p, o.center, o.footprint, pad)) continue;
      const d = Math.hypot(p.x - o.center.x, p.y - o.center.y);
      if (d < bestDist) { best = id; bestDist = d; }
    }
    return best;
  }

  /** Writes a normalized position directly (positions are plain fields, like the regular drag). */
  function place(f: Fixture, p: WorldPoint) {
    f.fixturePosition.x = p.x;
    f.fixturePosition.y = p.y;
  }

  /** Swapped placements of source and target, both from their originals. */
  function swapped(sourceId: string | number, targetId: string | number) {
    return swapByCenters(originals.get(sourceId)!, originals.get(targetId)!, opts.worldWidth, opts.worldHeight);
  }

  /** Starts a swap drag when a plain left-click lands on a handle. Returns true when consumed. */
  function onMouseDown(event: MouseEvent, rect: DOMRect): boolean {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const vx = event.clientX - rect.left;
    const vy = event.clientY - rect.top;
    const h = handleAt(vx, vy);
    if (!h) return false;

    // Freeze every fixture's place: these are the hover zones for the whole drag.
    originals = new Map();
    for (const f of opts.getFixtures()) {
      originals.set(f.id, {
        fixture: f,
        pos: { ...f.fixturePosition },
        center: fixtureCenterWorld(f, opts.worldWidth, opts.worldHeight),
        footprint: fixtureFootprint(f),
      });
    }
    const source = originals.get(h.id);
    if (!source) return false;
    const w = opts.viewportToWorld(vx, vy);
    grabOffset = { x: w.x / opts.worldWidth - source.pos.x, y: w.y / opts.worldHeight - source.pos.y };
    swapDrag.value = { sourceId: h.id, targetId: null };
    return true;
  }

  /** Grabbed fixture follows the pointer; the hovered partner moves in or out. Returns true while dragging. */
  function onMouseMove(event: MouseEvent, rect: DOMRect): boolean {
    const drag = swapDrag.value;
    if (!drag) return false;
    const source = originals.get(drag.sourceId);
    if (!source) return true;
    const w = opts.viewportToWorld(event.clientX - rect.left, event.clientY - rect.top);
    place(source.fixture, { x: w.x / opts.worldWidth - grabOffset.x, y: w.y / opts.worldHeight - grabOffset.y });

    const targetId = zoneAt(w, drag.sourceId);
    if (targetId !== drag.targetId) {
      // Previous partner goes home, the new one takes the grabbed fixture's original place.
      const prev = drag.targetId !== null ? originals.get(drag.targetId) : undefined;
      if (prev) place(prev.fixture, prev.pos);
      if (targetId !== null) place(originals.get(targetId)!.fixture, swapped(drag.sourceId, targetId).b);
      swapDrag.value = { ...drag, targetId };
    }
    opts.onLayoutChange();
    return true;
  }

  /**
   * Ends the drag: snaps into the ghost when a partner is hovered (one undo
   * step), otherwise back home. `cancel` (pointer left the viewport) always
   * restores both fixtures. Returns true when a swap drag ended.
   */
  function onMouseUp(cancel = false): boolean {
    const drag = swapDrag.value;
    if (!drag) return false;
    swapDrag.value = null;
    const source = originals.get(drag.sourceId);
    const target = drag.targetId !== null ? originals.get(drag.targetId) : undefined;
    if (source) place(source.fixture, source.pos);
    if (target) place(target.fixture, target.pos);

    if (!cancel && source && target) {
      // Both are back at their originals, so the command's execute() applies the swap.
      const s = swapped(source.fixture.id, target.fixture.id);
      opts.onSwap(
        [{ id: source.fixture.id, ...source.pos }, { id: target.fixture.id, ...target.pos }],
        [{ id: source.fixture.id, ...s.a }, { id: target.fixture.id, ...s.b }],
      );
    }
    originals = new Map();
    opts.onLayoutChange();
    return true;
  }

  return { handles, ghosts, swapDrag, isOverHandle, onMouseDown, onMouseMove, onMouseUp };
}
