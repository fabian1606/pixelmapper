/**
 * Layout view of the `screenshot` tool (WP-K): turns the stage model into a
 * deterministic list of draw commands — world bounds with x/y ticks, the
 * room box, fixture footprints, head dots in their output colors, head 0
 * ringed with an arrow toward the last head, labels and a legend.
 */
import { SCREENSHOT_DEFAULT_SIZE, SCREENSHOT_MAX_SIZE, type ScreenshotRequest } from '@pixelmapper/agent-kit';
import { luma, px, rgb, type DrawCommand, type DrawScene } from './draw-commands';
import type { StageFixture, StageModel } from './stage-model';
import { contentBounds, createViewport, resolveRegion, tickLabel, ticks, uiScale, type Region, type Viewport } from './viewport';

// ── Palette ─────────────────────────────────────

const COLORS = {
  background: '#0f1115',
  world: '#161a20',
  worldBorder: '#3b424d',
  grid: '#1f252d',
  tick: '#8b95a1',
  room: '#56606d',
  outline: '#6b7380',
  outlineFill: 'rgba(255, 255, 255, 0.04)',
  highlight: '#f59e0b',
  neutralHead: '#9ca3af',
  darkHeadStroke: '#5b6470',
  head0: '#facc15',
  label: '#e5e7eb',
};

/** Longest label before it is cut with `…`. */
const MAX_LABEL = 28;

// ── Options ─────────────────────────────────────

/** Resolved layout options. */
export interface LayoutOptions {
  size: number;
  labels: 'name' | 'id' | 'none';
  highlight: Set<string>;
  region: Region;
}

/** Fills request defaults (size clamp, labels, highlight set, region). */
export function layoutOptions(model: StageModel, req: ScreenshotRequest): LayoutOptions {
  return {
    size: Math.min(SCREENSHOT_MAX_SIZE, Math.max(128, Math.round(req.size ?? SCREENSHOT_DEFAULT_SIZE))),
    labels: req.labels ?? 'name',
    highlight: new Set((req.highlight ?? []).map(String)),
    region: resolveRegion(model, req.region),
  };
}

/** Result of the layout builder. */
export interface LayoutScene extends DrawScene {
  region: Region;
  /** Fixtures with at least one point inside the region. */
  shown: number;
}

// ── Pieces ──────────────────────────────────────

/** World 0–1 box, grid and tick labels. */
function drawFrame(vp: Viewport, k: number, out: DrawCommand[]): void {
  const { region, margins } = vp;
  const a = vp.toPx({ x: Math.max(0, region.minX), y: Math.max(0, region.minY) });
  const b = vp.toPx({ x: Math.min(1, region.maxX), y: Math.min(1, region.maxY) });
  if (b.x > a.x && b.y > a.y) out.push({ op: 'rect', x: px(a.x), y: px(a.y), w: px(b.x - a.x), h: px(b.y - a.y), fill: COLORS.world });
  const fontSize = px(11 * k);
  const xt = ticks(region.minX, region.maxX);
  for (const v of xt.values) {
    const x = px(vp.toPx({ x: v, y: 0 }).x);
    out.push({ op: 'poly', points: [x, margins.top, x, vp.height - margins.bottom], closed: false, stroke: COLORS.grid, lineWidth: 1 });
    out.push({ op: 'text', x, y: px(margins.top - 6 * k), text: tickLabel(v, xt.step), size: fontSize, color: COLORS.tick, align: 'center', baseline: 'bottom' });
  }
  const yt = ticks(region.minY, region.maxY);
  for (const v of yt.values) {
    const y = px(vp.toPx({ x: 0, y: v }).y);
    out.push({ op: 'poly', points: [margins.left, y, vp.width - margins.right, y], closed: false, stroke: COLORS.grid, lineWidth: 1 });
    out.push({ op: 'text', x: px(margins.left - 6 * k), y, text: tickLabel(v, yt.step), size: fontSize, color: COLORS.tick, align: 'right', baseline: 'middle' });
  }
  if (b.x > a.x && b.y > a.y) out.push({ op: 'rect', x: px(a.x), y: px(a.y), w: px(b.x - a.x), h: px(b.y - a.y), stroke: COLORS.worldBorder, lineWidth: 1, dash: [6, 4] });
}

/** Room box (bounding box of all heads / footprints, what Sample.u/v span). */
function drawRoom(model: StageModel, vp: Viewport, out: DrawCommand[]): void {
  const heads = { fixtures: model.fixtures.map(f => ({ ...f, outline: [] })), colors: model.colors };
  const room = contentBounds(heads);
  if (!room) return;
  const a = vp.toPx({ x: room.minX, y: room.minY });
  const b = vp.toPx({ x: room.maxX, y: room.maxY });
  out.push({ op: 'rect', x: px(a.x), y: px(a.y), w: px(b.x - a.x), h: px(b.y - a.y), stroke: COLORS.room, lineWidth: 1, dash: [3, 3] });
}

/** Dot radius for a fixture's heads (fits the head spacing). */
function headRadius(f: StageFixture, vp: Viewport, k: number): number {
  if (f.heads.length < 2) {
    const xs = f.outline.map(p => vp.toPx(p));
    const span = Math.min(Math.max(...xs.map(p => p.x)) - Math.min(...xs.map(p => p.x)), Math.max(...xs.map(p => p.y)) - Math.min(...xs.map(p => p.y)));
    return Math.min(10 * k, Math.max(3 * k, span * 0.3));
  }
  let minGap = Infinity;
  for (let i = 1; i < f.heads.length; i++) {
    const a = vp.toPx(f.heads[i - 1]!);
    const b = vp.toPx(f.heads[i]!);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > 1e-6) minGap = Math.min(minGap, d);
  }
  return Math.min(9 * k, Math.max(1.5, (Number.isFinite(minGap) ? minGap : 8) * 0.38));
}

/** Arrow head 0 → last head, offset beside the dots. */
function drawArrow(f: StageFixture, vp: Viewport, r: number, k: number, out: DrawCommand[]): void {
  const a = vp.toPx(f.heads[0]!);
  const b = vp.toPx(f.heads[f.heads.length - 1]!);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 12 * k) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  // Offset to the left of the direction (screen space), clear of the dots.
  const off = r + 6 * k;
  const ox = uy * off;
  const oy = -ux * off;
  const head = Math.min(9 * k, len * 0.3);
  const tip = { x: b.x + ox, y: b.y + oy };
  const base = { x: tip.x - ux * head, y: tip.y - uy * head };
  out.push({ op: 'poly', points: [px(a.x + ox), px(a.y + oy), px(base.x), px(base.y)], closed: false, stroke: COLORS.head0, lineWidth: px(1.5 * k) });
  out.push({ op: 'poly', points: [px(tip.x), px(tip.y), px(base.x + uy * head * 0.5), px(base.y - ux * head * 0.5), px(base.x - uy * head * 0.5), px(base.y + ux * head * 0.5)], closed: true, fill: COLORS.head0 });
}

/** Footprint, heads, head-0 marker and label of one fixture. */
function drawFixture(f: StageFixture, opts: LayoutOptions, vp: Viewport, k: number, out: DrawCommand[]): void {
  const highlighted = opts.highlight.has(f.id);
  const poly = f.outline.flatMap((p) => {
    const q = vp.toPx(p);
    return [px(q.x), px(q.y)];
  });
  out.push({ op: 'poly', points: poly, closed: true, fill: COLORS.outlineFill, stroke: highlighted ? COLORS.highlight : COLORS.outline, lineWidth: px((highlighted ? 3 : 1.25) * k) });

  const r = headRadius(f, vp, k);
  f.heads.forEach((h) => {
    const q = vp.toPx(h);
    const fill = h.color ? rgb(h.color) : COLORS.neutralHead;
    const dark = h.color ? luma(h.color) < 50 : false;
    out.push({ op: 'circle', x: px(q.x), y: px(q.y), r: px(r), fill, ...(dark ? { stroke: COLORS.darkHeadStroke, lineWidth: 1 } : {}) });
  });
  if (f.heads.length > 1) {
    const h0 = vp.toPx(f.heads[0]!);
    out.push({ op: 'circle', x: px(h0.x), y: px(h0.y), r: px(r + 2.5 * k), stroke: COLORS.head0, lineWidth: px(2 * k) });
    drawArrow(f, vp, r, k, out);
  }

  if (opts.labels === 'none') return;
  const raw = opts.labels === 'id' ? f.id : f.name;
  const label = raw.length > MAX_LABEL ? `${raw.slice(0, MAX_LABEL - 1)}…` : raw;
  const pts = f.outline.map(p => vp.toPx(p));
  const top = Math.min(...pts.map(p => p.y), ...f.heads.map(h => vp.toPx(h).y - r));
  const cx = (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2;
  out.push({ op: 'text', x: px(cx), y: px(top - 5 * k), text: label, size: px(12 * k), color: highlighted ? COLORS.highlight : COLORS.label, align: 'center', baseline: 'bottom', bold: highlighted, halo: COLORS.background });
}

/** Legend in the bottom margin. */
function drawLegend(model: StageModel, vp: Viewport, k: number, out: DrawCommand[]): void {
  const y = px(vp.height - vp.margins.bottom / 2);
  const colors = model.colors === 'live' ? 'dot color = current output' : 'grey dots = no live output';
  out.push({ op: 'circle', x: px(vp.margins.left + 6 * k), y, r: px(5 * k), stroke: COLORS.head0, lineWidth: px(2 * k) });
  out.push({ op: 'text', x: px(vp.margins.left + 16 * k), y, text: `head 0 · yellow arrow = head 0 → last head · ${colors} · dashed = room box · x→ y↓`, size: px(11 * k), color: COLORS.tick, align: 'left', baseline: 'middle' });
}

// ── Scene ───────────────────────────────────────

/** True when any outline point or head lies inside the region. */
function inRegion(f: StageFixture, r: Region): boolean {
  return [...f.outline, ...f.heads].some(p => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY);
}

/** Builds the layout view. Highlighted fixtures are drawn last (on top). */
export function buildLayoutScene(model: StageModel, opts: LayoutOptions): LayoutScene {
  const vp = createViewport(opts.region, opts.size);
  const k = uiScale(opts.size);
  const commands: DrawCommand[] = [];
  drawFrame(vp, k, commands);
  // Fixtures stay inside the plot area (labels may reach into the margin by a few px).
  const m = vp.margins;
  commands.push({ op: 'clip', x: m.left, y: m.top, w: vp.width - m.left - m.right, h: vp.height - m.top - m.bottom });
  drawRoom(model, vp, commands);
  const visible = model.fixtures.filter(f => inRegion(f, opts.region));
  const ordered = [...visible.filter(f => !opts.highlight.has(f.id)), ...visible.filter(f => opts.highlight.has(f.id))];
  for (const f of ordered) drawFixture(f, opts, vp, k, commands);
  commands.push({ op: 'unclip' });
  drawLegend(model, vp, k, commands);
  return { width: vp.width, height: vp.height, background: COLORS.background, commands, region: opts.region, shown: visible.length };
}
