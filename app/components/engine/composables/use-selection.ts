import { ref } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Point } from './use-camera';
import type { FixturePositionSnapshot } from '../commands/move-fixture-command';
import type { SceneNode } from '~/utils/engine/core/group';

import type { FixtureRotationSnapshot } from '../commands/rotate-fixture-command';

export type Interaction =
  | { type: 'idle' }
  | { type: 'marquee'; start: Point; end: Point }
  | { type: 'drag'; startWorld: Point; startPositions: Map<string | number, Point> }
  | { type: 'rotate'; startWorld: Point; startAngles: Map<string | number, number>; centerWorld: Point };

export interface CanvasHitTester {
  hitTest: (x: number, y: number) => string | undefined;
  hitTestRotationZone: (x: number, y: number) => string | undefined;
}

const DOT_SPACING = 25;

function snapWorld(px: number): number {
  return Math.round(px / DOT_SPACING) * DOT_SPACING;
}

function toNormalized(px: number, max: number): number {
  return px / max;
}

export function useSelection(
  getFixtures: () => Fixture[],
  getWidth: () => number,
  getHeight: () => number,
  toWorld: (vx: number, vy: number) => Point,
  onDragComplete?: (before: FixturePositionSnapshot[], after: FixturePositionSnapshot[]) => void,
  onRotateComplete?: (before: FixtureRotationSnapshot[], after: FixtureRotationSnapshot[]) => void,
  externalSelectedIds?: import('vue').Ref<Set<string | number>>,
  getCanvas?: () => CanvasHitTester | null,
) {
  const selectedIds = externalSelectedIds ?? ref<Set<string | number>>(new Set());
  const interaction = ref<Interaction>({ type: 'idle' });

  let lastClickId: string | number | null = null;
  let lastClickTime = 0;
  let beforeSnapshot: FixturePositionSnapshot[] = [];
  let beforeRotationSnapshot: FixtureRotationSnapshot[] = [];

  function onViewportMouseDown(event: MouseEvent, rect: DOMRect) {
    if (event.button === 2) {
      const vx = event.clientX - rect.left;
      const vy = event.clientY - rect.top;
      const hitId = getCanvas?.()?.hitTest(vx, vy);
      if (hitId) {
        const fixture = getFixtures().find(f => String(f.id) === hitId);
        if (fixture && !selectedIds.value.has(fixture.id)) {
          selectedIds.value = new Set([fixture.id]);
        }
      }
      return;
    }

    const vx = event.clientX - rect.left;
    const vy = event.clientY - rect.top;

    const rotationHitId = getCanvas?.()?.hitTestRotationZone(vx, vy);
    if (rotationHitId) {
      const fixture = getFixtures().find(f => String(f.id) === rotationHitId);
      if (fixture) { onRotateStart(event, fixture, rect); return; }
    }

    const hitId = getCanvas?.()?.hitTest(vx, vy);
    if (hitId) {
      const fixture = getFixtures().find(f => String(f.id) === hitId);
      if (fixture) { onDragStart(event, fixture, rect); return; }
    }

    const world = toWorld(vx, vy);
    if (!event.shiftKey) selectedIds.value = new Set();
    interaction.value = { type: 'marquee', start: { ...world }, end: { ...world } };
  }

  function onDragStart(event: MouseEvent, fixture: Fixture, rect: DOMRect) {
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);

    const now = performance.now();
    const isDoubleClick = (lastClickId === fixture.id && now - lastClickTime < 300);
    lastClickId = fixture.id;
    lastClickTime = now;

    const path: SceneNode[] = [];
    let curr: SceneNode | null = fixture as unknown as SceneNode;
    while (curr) { path.unshift(curr); curr = curr.parent; }

    let targetNode = path[0];
    if (!targetNode) return;

    const selectedIndex = path.findIndex(n => selectedIds.value.has(n.id));
    if (selectedIndex !== -1) {
      if (isDoubleClick && selectedIndex < path.length - 1) {
        targetNode = path[selectedIndex + 1] as SceneNode;
        lastClickId = null;
      } else {
        targetNode = path[selectedIndex] as SceneNode;
      }
    }
    if (!targetNode) return;

    let effectiveSelectedIds: Set<string | number>;
    if (event.shiftKey) {
      const next = new Set(selectedIds.value);
      next.has(targetNode.id) ? next.delete(targetNode.id) : next.add(targetNode.id);
      effectiveSelectedIds = next;
    } else if (!selectedIds.value.has(targetNode.id)) {
      effectiveSelectedIds = new Set([targetNode.id]);
    } else {
      effectiveSelectedIds = new Set(selectedIds.value);
    }
    selectedIds.value = effectiveSelectedIds;

    if (event.button === 2) return;

    const startPositions = new Map<string | number, Point>();
    const w = getWidth();
    const h = getHeight();
    beforeSnapshot = [];
    for (const f of getFixtures()) {
      let isSelected = false;
      let c: SceneNode | null = f as unknown as SceneNode;
      while (c) { if (effectiveSelectedIds.has(c.id)) { isSelected = true; break; } c = c.parent; }
      if (isSelected) {
        startPositions.set(f.id, { x: f.fixturePosition.x * w, y: f.fixturePosition.y * h });
        beforeSnapshot.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y });
      }
    }
    interaction.value = { type: 'drag', startWorld: world, startPositions };
  }

  function onRotateStart(event: MouseEvent, fixture: Fixture, rect: DOMRect) {
    if (event.button === 2) return;
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);

    let effectiveSelectedIds = new Set(selectedIds.value);
    if (!effectiveSelectedIds.has(fixture.id)) {
      effectiveSelectedIds = new Set([fixture.id]);
      selectedIds.value = effectiveSelectedIds;
    }

    const startAngles = new Map<string | number, number>();
    beforeRotationSnapshot = [];
    let sumX = 0, sumY = 0, count = 0;
    const w = getWidth();
    const h = getHeight();
    for (const f of getFixtures()) {
      if (effectiveSelectedIds.has(f.id)) {
        sumX += f.fixturePosition.x * w;
        sumY += f.fixturePosition.y * h;
        count++;
        startAngles.set(f.id, f.rotation || 0);
        beforeRotationSnapshot.push({ id: f.id, rotation: f.rotation || 0 });
      }
    }
    const centerWorld = { x: count > 0 ? sumX / count : 0, y: count > 0 ? sumY / count : 0 };
    interaction.value = { type: 'rotate', startWorld: world, startAngles, centerWorld };
  }

  function onMouseMove(event: MouseEvent, rect: DOMRect) {
    const iv = interaction.value;
    if (iv.type === 'idle') return;
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);

    if (iv.type === 'marquee') {
      interaction.value = { ...iv, end: world };
    } else if (iv.type === 'drag') {
      const dx = world.x - iv.startWorld.x;
      const dy = world.y - iv.startWorld.y;
      const w = getWidth(); const h = getHeight();
      for (const f of getFixtures()) {
        const start = iv.startPositions.get(f.id);
        if (start) {
          f.fixturePosition.x = toNormalized(snapWorld(start.x + dx), w);
          f.fixturePosition.y = toNormalized(snapWorld(start.y + dy), h);
        }
      }
    } else if (iv.type === 'rotate') {
      const startAngle = Math.atan2(iv.startWorld.y - iv.centerWorld.y, iv.startWorld.x - iv.centerWorld.x);
      const currAngle  = Math.atan2(world.y - iv.centerWorld.y, world.x - iv.centerWorld.x);
      let deltaDeg = (currAngle - startAngle) * (180 / Math.PI);
      if (event.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15;
      for (const f of getFixtures()) {
        const startR = iv.startAngles.get(f.id);
        if (startR !== undefined) {
          let r = (startR + deltaDeg) % 360;
          if (r < 0) r += 360;
          f.rotation = r;
        }
      }
    }
  }

  function onMouseUp() {
    const iv = interaction.value;

    if (iv.type === 'marquee') {
      const minX = Math.min(iv.start.x, iv.end.x), maxX = Math.max(iv.start.x, iv.end.x);
      const minY = Math.min(iv.start.y, iv.end.y), maxY = Math.max(iv.start.y, iv.end.y);
      const hit = new Set<string | number>();
      const w = getWidth(); const h = getHeight();
      for (const f of getFixtures()) {
        const wx = f.fixturePosition.x * w, wy = f.fixturePosition.y * h;
        if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) {
          const path: SceneNode[] = [];
          let curr: SceneNode | null = f as unknown as SceneNode;
          while (curr) { path.unshift(curr); curr = curr.parent; }
          if (path[0]) hit.add(path[0].id);
        }
      }
      selectedIds.value = hit;
    } else if (iv.type === 'drag' && beforeSnapshot.length > 0 && onDragComplete) {
      const afterSnapshot = beforeSnapshot.map(snap => {
        const f = getFixtures().find(f => f.id === snap.id);
        return { id: snap.id, x: f ? f.fixturePosition.x : snap.x, y: f ? f.fixturePosition.y : snap.y };
      });
      const didMove = beforeSnapshot.some((b, i) => { const a = afterSnapshot[i]; return a && (b.x !== a.x || b.y !== a.y); });
      if (didMove) onDragComplete(beforeSnapshot, afterSnapshot);
      beforeSnapshot = [];
    } else if (iv.type === 'rotate' && beforeRotationSnapshot.length > 0 && onRotateComplete) {
      const afterSnapshot = beforeRotationSnapshot.map(snap => {
        const f = getFixtures().find(f => f.id === snap.id);
        return { id: snap.id, rotation: f ? (f.rotation || 0) : snap.rotation };
      });
      const didRotate = beforeRotationSnapshot.some((b, i) => afterSnapshot[i] && b.rotation !== afterSnapshot[i]!.rotation);
      if (didRotate) onRotateComplete(beforeRotationSnapshot, afterSnapshot);
      beforeRotationSnapshot = [];
    }

    interaction.value = { type: 'idle' };
  }

  return { selectedIds, interaction, onViewportMouseDown, onDragStart, onRotateStart, onMouseMove, onMouseUp };
}
