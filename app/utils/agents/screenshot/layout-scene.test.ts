/**
 * Layout view of the `screenshot` tool (WP-K): deterministic draw commands,
 * head-0 marking and patch-direction arrow for rotations 0/90/180/270,
 * colors, labels, highlight and region.
 */
import { describe, expect, it } from 'vitest';
import { Fixture } from '~/utils/engine/core/fixture';
import { makeBarFixture } from '~/utils/operations/test-utils';
import type { DrawCommand } from './draw-commands';
import { buildStageModel } from './stage-model';
import { layoutCaption, renderLayoutScene } from './index';

/** Head-0 ring color. */
const HEAD0 = '#facc15';

/** A spot plus one bar. */
function scene(rotation: number, extra: Parameters<typeof renderLayoutScene>[1] = {}, dmx: Uint8Array | null = null) {
  const spot = Fixture.createRGBFixture('spot');
  spot.name = 'Spot';
  spot.fixturePosition = { x: 0.3, y: 0.3 };
  const bar = makeBarFixture('bar', 0.5, 0.5, rotation);
  const model = buildStageModel([spot, bar], dmx);
  return { model, scene: renderLayoutScene(model, extra) };
}

/** The ring around head 0 (stroke-only circle in the head-0 color). */
function head0Ring(cmds: DrawCommand[]) {
  return cmds.find((c): c is Extract<DrawCommand, { op: 'circle' }> => c.op === 'circle' && c.stroke === HEAD0 && !c.fill && c.r > 4)!;
}

/** Arrow tip = first point of the filled head-0 triangle. */
function arrowTip(cmds: DrawCommand[]) {
  const tri = cmds.find((c): c is Extract<DrawCommand, { op: 'poly' }> => c.op === 'poly' && c.closed && c.fill === HEAD0)!;
  return { x: tri.points[0]!, y: tri.points[1]! };
}

/** Pixel position of the bar center (mean of its head dots). */
function barCenter(cmds: DrawCommand[]) {
  const dots = cmds.filter((c): c is Extract<DrawCommand, { op: 'circle' }> => c.op === 'circle' && !!c.fill && c.fill !== HEAD0);
  const bar = dots.slice(-4);
  return { x: bar.reduce((s, d) => s + d.x, 0) / 4, y: bar.reduce((s, d) => s + d.y, 0) / 4 };
}

describe('layout scene', () => {
  it('is deterministic and matches the snapshot', () => {
    const a = scene(90, { size: 256 }).scene;
    const b = scene(90, { size: 256 }).scene;
    expect(a).toEqual(b);
    expect({ width: a.width, height: a.height, commands: a.commands }).toMatchSnapshot();
  });

  it.each([
    [0, 'left', (r: { x: number; y: number }, c: { x: number; y: number }) => r.x < c.x - 5],
    [90, 'top', (r: { x: number; y: number }, c: { x: number; y: number }) => r.y < c.y - 5],
    [180, 'right', (r: { x: number; y: number }, c: { x: number; y: number }) => r.x > c.x + 5],
    [270, 'bottom', (r: { x: number; y: number }, c: { x: number; y: number }) => r.y > c.y + 5],
  ])('rotation %i°: head 0 ringed on the %s, arrow points to the last head', (rotation, _side, check) => {
    const { commands } = scene(rotation).scene;
    const center = barCenter(commands);
    const ring = head0Ring(commands);
    expect(check(ring, center)).toBe(true);
    // The arrow tip lies on the opposite side of the center from head 0.
    const tip = arrowTip(commands);
    expect(Math.sign(tip.x - center.x) * Math.sign(ring.x - center.x)).toBeLessThanOrEqual(0);
    expect(Math.sign(tip.y - center.y) * Math.sign(ring.y - center.y)).toBeLessThanOrEqual(0);
  });

  it('fills heads with live colors and falls back to neutral grey', () => {
    const dmx = new Uint8Array(512);
    dmx[0] = 255; // spot red (DRGB fixture at address 1: R G B D)
    dmx[3] = 255; // spot dimmer
    const live = scene(0, {}, dmx);
    expect(live.model.colors).toBe('live');
    expect(live.scene.commands.some(c => c.op === 'circle' && c.fill === 'rgb(255, 0, 0)')).toBe(true);
    const none = scene(0);
    expect(none.scene.commands.some(c => c.op === 'circle' && c.fill === '#9ca3af')).toBe(true);
  });

  it('labels by name, id or not at all; highlights on top', () => {
    const texts = (labels: 'name' | 'id' | 'none') => scene(0, { labels }).scene.commands.filter(c => c.op === 'text').map(c => (c as { text: string }).text);
    expect(texts('name')).toContain('Spot');
    expect(texts('id')).toContain('spot');
    expect(texts('none')).not.toContain('Spot');
    const hl = scene(0, { highlight: ['spot'] }).scene.commands;
    expect(hl.some(c => c.op === 'poly' && c.stroke === '#f59e0b')).toBe(true);
  });

  it('zooms to a region and reports what is shown', () => {
    const { model, scene: s } = scene(0, { region: { minX: 0.45, minY: 0.45, maxX: 0.55, maxY: 0.55 } });
    expect(s.shown).toBe(1);
    const caption = layoutCaption(model, s, 0);
    expect(caption).toContain('1 of 2 fixtures shown');
    expect(caption).toContain('"bar" (bar) at 0.500, 0.500 · rotation 0° · 4 heads run left→right');
    expect(caption).toContain('grey (no live output available)');
  });

  it('caps the size and keeps the longer side at `size`', () => {
    const { scene: s } = scene(0, { size: 512, region: 'world' });
    expect(Math.max(s.width, s.height)).toBe(512);
  });
});
