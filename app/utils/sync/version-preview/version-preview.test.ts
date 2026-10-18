// @vitest-environment node
/**
 * Version-history hover preview: `snapshot-preview` wrapper (parsing,
 * abort), layout → model geometry, SVG + rs-engine-canvas payload mapping,
 * hover-intent timing (fake timers) and the loader (cache, cancel, offline).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { isOnline, reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { getSnapshotPreview, parseSnapshotPreviewResponse, type SnapshotLayout } from '~/utils/sync/remote-api-snapshot-preview';
import { createHoverIntent } from '~/utils/sync/version-preview/hover-intent';
import { hexToRgb, rotatedCorners, toCanvasPayload } from '~/utils/sync/version-preview/preview-canvas-data';
import { clearVersionPreviewCache, createVersionPreview } from '~/utils/sync/version-preview/preview-controller';
import { beamGrid, buildPreviewModel, fitCamera, fixtureBox, NEUTRAL_COLOR, placeFixture } from '~/utils/sync/version-preview/preview-model';
import { toSvgScene } from '~/utils/sync/version-preview/preview-svg';

const PID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';

/** Wire body with a single head, a pixel bar in group 0, a kind fixture. */
const body = {
  snapshotId: 's1',
  layout: {
    fixtures: [
      [0.5, 0.5, 1, 1, 0, '#FF8800', 0, 1, -1],
      [0.6, 0.5, 2, 0.5, 90, null, 1, 8, 0],
      [0.4, 0.4, 1.5, 1.5, 0, '#00ff00', 2, 0, 0],
      ['bad'],
      [0.1, Number.NaN, 1, 1, 0, null, 0, 1, -1],
    ],
    groups: [['Truss'], 'Floor'],
    total: 10,
    truncated: true,
  },
};

/** Mock client resolving `outcome` (optionally after `gate`). */
function mockClient(outcome: { data: unknown; error: unknown }, gate?: Promise<void>) {
  const invoke = vi.fn(async (_name: string, _opts?: { body?: Record<string, unknown>; signal?: AbortSignal }) => {
    if (gate) await gate;
    return outcome;
  });
  const client: RemoteClient = { functions: { invoke } };
  return { client, invoke };
}

beforeEach(() => reportNetworkSuccess());
afterEach(() => clearVersionPreviewCache());

// ── Wrapper ──────────────────────────────────────────────────────────────────

describe('snapshot-preview wrapper', () => {
  it('decodes tuples, drops malformed ones, keeps group indices in range', () => {
    const parsed = parseSnapshotPreviewResponse(body)!;
    expect(parsed.layout.fixtures).toHaveLength(3);
    expect(parsed.layout.fixtures[0]).toEqual({ x: 0.5, y: 0.5, w: 1, h: 1, r: 0, color: '#ff8800', shape: 0, beams: 1, group: -1 });
    expect(parsed.layout.fixtures[1]).toMatchObject({ shape: 1, beams: 8, group: 0, color: null, r: 90 });
    expect(parsed.layout.groups).toEqual(['Truss', 'Floor']);
    expect(parsed.layout).toMatchObject({ total: 10, truncated: true });
    // Out-of-range group, bad size and shape fall back to defaults.
    const odd = parseSnapshotPreviewResponse({ snapshotId: 's', layout: { fixtures: [[0, 0, -1, 'x', null, 'red', 7, 0, 5]], groups: [] } })!;
    expect(odd.layout.fixtures[0]).toEqual({ x: 0, y: 0, w: 1, h: 1, r: 0, color: null, shape: 0, beams: 1, group: -1 });
    expect(odd.layout.total).toBe(1);
  });

  it('rejects unexpected bodies', () => {
    expect(parseSnapshotPreviewResponse(null)).toBeNull();
    expect(parseSnapshotPreviewResponse({ snapshotId: 's' })).toBeNull();
    expect(parseSnapshotPreviewResponse({ layout: { fixtures: [] } })).toBeNull();
  });

  it('sends the ids with the abort signal', async () => {
    const { client, invoke } = mockClient({ data: body, error: null });
    const ctl = new AbortController();
    const res = await getSnapshotPreview(client, { projectId: PID, snapshotId: 's1' }, ctl.signal);
    expect(res.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('snapshot-preview', { body: { projectId: PID, snapshotId: 's1' }, signal: ctl.signal });
  });

  it('an aborted call is "aborted" and does not mark the app offline', async () => {
    const ctl = new AbortController();
    let release!: () => void;
    const { client } = mockClient({ data: null, error: new TypeError('Failed to fetch') }, new Promise((r) => { release = r; }));
    const pending = getSnapshotPreview(client, { projectId: PID, snapshotId: 's1' }, ctl.signal);
    ctl.abort();
    release();
    const res = await pending;
    expect(res.ok ? null : res.error.kind).toBe('aborted');
    expect(isOnline.value).toBe(true);
  });
});

// ── Model ────────────────────────────────────────────────────────────────────

describe('preview model', () => {
  const layout = parseSnapshotPreviewResponse(body)!.layout;

  it('places fixtures in world px with workspace extents', () => {
    const [single, bar, kind] = layout.fixtures.map(placeFixture);
    expect(single).toMatchObject({ cx: 1500, cy: 1500, hw: 16, hh: 16, color: '#ff8800', dots: [] });
    expect(bar).toMatchObject({ cx: 1800, hw: 36, hh: 9, color: NEUTRAL_COLOR });
    expect(bar!.dots).toHaveLength(8);
    expect(kind).toMatchObject({ hw: 27, hh: 27 });
  });

  it('beam grid follows the aspect ratio and stays inside the body', () => {
    const g = beamGrid(8, 4, 1);
    expect(new Set(g.dots.map(d => d.y)).size).toBe(2);
    expect(g.dots.every(d => Math.abs(d.x) < 0.5 && Math.abs(d.y) < 0.5)).toBe(true);
    expect(beamGrid(1, 1, 1).dots).toEqual([{ x: 0, y: 0 }]);
  });

  it('rotated bounding box, group outlines and hidden count', () => {
    const bar = placeFixture(layout.fixtures[1]!);
    const box = fixtureBox(bar);
    // 90°: width and height swap.
    expect(box.maxX - box.minX).toBeCloseTo(18);
    expect(box.maxY - box.minY).toBeCloseTo(72);
    const model = buildPreviewModel(layout);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]!.name).toBe('Truss');
    expect(model.hidden).toBe(7);
    expect(model.bounds!.minX).toBeLessThanOrEqual(model.groups[0]!.box.minX);
  });

  it('fits the bounds centered into the viewport, capped zoom', () => {
    const cam = fitCamera({ minX: 0, minY: 0, maxX: 3000, maxY: 1500 }, 320, 200, 10);
    expect(cam.scale).toBeCloseTo(0.1);
    expect(1500 * cam.scale + cam.x).toBeCloseTo(160);
    expect(750 * cam.scale + cam.y).toBeCloseTo(100);
    expect(fitCamera({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 320, 200).scale).toBe(3);
    expect(fitCamera(null, 320, 200).scale).toBeGreaterThan(0);
  });
});

// ── Renderers ────────────────────────────────────────────────────────────────

describe('layout → SVG', () => {
  it('maps shapes, outlines and transforms', () => {
    const scene = toSvgScene(buildPreviewModel(parseSnapshotPreviewResponse(body)!.layout), 320, 200);
    expect(scene.shapes.map(s => s.type)).toEqual(['ellipse', 'bar', 'kind']);
    expect(scene.shapes[0]).toMatchObject({ cx: 1500, cy: 1500, rx: 16, ry: 16, fill: '#ff8800', transform: '' });
    const bar = scene.shapes[1]!;
    expect(bar.transform).toBe('rotate(90 1800 1500)');
    expect(bar.type === 'bar' && bar.dots.length).toBe(8);
    expect(scene.outlines).toHaveLength(1);
    expect(scene.transform).toMatch(/^matrix\(/);
    expect(scene.stroke).toBeCloseTo(2 / scene.camera.scale, 3);
  });

  it('empty layout renders nothing', () => {
    const scene = toSvgScene(buildPreviewModel({ fixtures: [], groups: [], total: 0, truncated: false } satisfies SnapshotLayout), 320, 200);
    expect(scene.shapes).toEqual([]);
  });
});

describe('layout → rs-engine-canvas payload', () => {
  it('one full-level color channel per distinct color; shapes map to the canvas model', () => {
    const model = buildPreviewModel(parseSnapshotPreviewResponse(body)!.layout);
    const { fixtures, dmx } = toCanvasPayload(model);
    expect(Array.from(dmx)).toEqual([255, 255, 255]);
    const [single, bar, kind] = fixtures as Array<Record<string, any>>;
    expect(single).toMatchObject({ worldX: 0.5, worldY: 0.5, width: 1, height: 1, colorChannels: [{ index: 0, r: 255, g: 136, b: 0 }], beams: [] });
    expect(bar!.beams).toHaveLength(8);
    expect(bar!.beams[0].colorChannels).toEqual([{ index: 1, r: 228, g: 228, b: 231 }]);
    expect(bar).toMatchObject({ width: 2, height: 0.5, rotation: 90 });
    expect(kind!.body[0]).toMatchObject({ type: 'polygon', style: { stroke: [0, 255, 0, 255] } });
    expect(kind!.rotation).toBe(0);
  });

  it('helpers', () => {
    expect(hexToRgb('#0a0B0c')).toEqual([10, 11, 12]);
    expect(hexToRgb('nope')).toEqual([255, 255, 255]);
    const corners = rotatedCorners({ cx: 0, cy: 0, hw: 2, hh: 1, rotation: 90, color: '', shape: 2, dots: [], dotRadius: 0, group: -1 });
    expect(corners[0]![0]).toBeCloseTo(1);
    expect(corners[0]![1]).toBeCloseTo(-2);
  });
});

// ── Hover intent ─────────────────────────────────────────────────────────────

describe('hover intent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Intent with recorded show/hide calls. */
  function setup() {
    const log: string[] = [];
    const intent = createHoverIntent<string>({ onShow: k => log.push(`show ${k}`), onHide: k => log.push(`hide ${k}`) });
    return { intent, log };
  }

  it('shows after 300 ms of dwell, not before', () => {
    const { intent, log } = setup();
    intent.enter('a');
    vi.advanceTimersByTime(299);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual(['show a']);
    expect(intent.current()).toBe('a');
  });

  it('a quick pass never shows anything', () => {
    const { intent, log } = setup();
    intent.enter('a');
    vi.advanceTimersByTime(150);
    intent.leave('a');
    intent.enter('b');
    vi.advanceTimersByTime(150);
    intent.leave('b');
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });

  it('switches immediately while shown; hides after the grace period', () => {
    const { intent, log } = setup();
    intent.enter('a');
    vi.advanceTimersByTime(300);
    intent.leave('a');
    intent.enter('b');
    expect(log).toEqual(['show a', 'hide a', 'show b']);
    intent.leave('b');
    vi.advanceTimersByTime(119);
    expect(intent.current()).toBe('b');
    vi.advanceTimersByTime(1);
    expect(log.at(-1)).toBe('hide b');
    expect(intent.current()).toBeNull();
  });

  it('re-entering within the grace keeps it; toggle and cancel', () => {
    const { intent, log } = setup();
    intent.toggle('a');
    intent.leave('a');
    vi.advanceTimersByTime(50);
    intent.enter('a');
    vi.advanceTimersByTime(500);
    expect(log).toEqual(['show a']);
    intent.toggle('a');
    expect(log).toEqual(['show a', 'hide a']);
    intent.enter('c');
    intent.cancel();
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['show a', 'hide a']);
  });
});

// ── Loader ───────────────────────────────────────────────────────────────────

describe('preview loader', () => {
  it('loads once, caches per snapshot across controllers', async () => {
    const { client, invoke } = mockClient({ data: body, error: null });
    const p = createVersionPreview({ projectId: PID, client: () => client, online: ref(true) });
    await Promise.all([p.load('s1'), p.load('s1')]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(p.state('s1').value.status).toBe('ready');
    expect(p.state('s1').value.model!.fixtures).toHaveLength(3);
    const again = createVersionPreview({ projectId: PID, client: () => client, online: ref(false) });
    expect(again.state('s1').value.status).toBe('ready');
    await again.load('s1');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('cancel aborts the request and resets to idle', async () => {
    let release!: () => void;
    const { client, invoke } = mockClient({ data: body, error: null }, new Promise((r) => { release = r; }));
    const p = createVersionPreview({ projectId: PID, client: () => client, online: ref(true) });
    const loading = p.load('s1');
    expect(p.state('s1').value.status).toBe('loading');
    p.cancel('s1');
    expect(invoke.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(p.state('s1').value.status).toBe('idle');
    release();
    await loading;
    expect(p.state('s1').value.status).toBe('idle');
  });

  it('offline without cache, errors', async () => {
    const off = createVersionPreview({ projectId: PID, client: () => mockClient({ data: body, error: null }).client, online: ref(false) });
    await off.load('s1');
    expect(off.state('s1').value.status).toBe('offline');

    const err = new Error('x') as Error & { context: Response };
    err.context = new Response(JSON.stringify({ error: 'Snapshot not found' }), { status: 404 });
    const failing = createVersionPreview({ projectId: PID, client: () => mockClient({ data: null, error: err }).client, online: ref(true) });
    await failing.load('s2');
    expect(failing.state('s2').value).toMatchObject({ status: 'error', error: 'Preview unavailable.' });

    const net = createVersionPreview({ projectId: PID, client: () => mockClient({ data: null, error: new TypeError('Failed to fetch') }).client, online: ref(true) });
    await net.load('s3');
    expect(net.state('s3').value.status).toBe('offline');
  });
});
