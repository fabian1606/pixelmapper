// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateExpectations } from '@pixelmapper/agent-kit';
import { analyzeTrace } from './features';
import { makeTrace, sine01 } from './features/test-traces';
import { renderReport, short } from './report';

// ── Helpers ─────────────────────────────────────

/** A chase over 8 fixtures (one stuck at 0) rendered from a preview source. */
function chaseTrace() {
  return makeTrace({
    samples: 8,
    fn: (i, t) => [i === 3 ? 0 : sine01(t, 1, i / 8)],
    source: { pluginHash: 'sha256:3fa9b2c1', pluginAlias: 'waveform', output: 'absolute', blend: 'add', strength: 1, spread: 'spatial' },
  });
}

// ── Report ──────────────────────────────────────

describe('renderReport', () => {
  it('formats short numbers', () => {
    expect(short(0.923)).toBe('.92');
    expect(short(-0.12)).toBe('-.12');
    expect(short(1)).toBe('1.00');
    expect(short(0)).toBe('0');
    expect(short(0.125, 3)).toBe('.125');
  });

  it('renders the header, group block, outliers and expectations', () => {
    const trace = chaseTrace();
    const { json, findings } = analyzeTrace(trace);
    const expectations = evaluateExpectations(json, [
      { path: 'group.temporal.kind', eq: 'periodic' },
      { path: 'group.temporal.hz', within: [0.9, 1.1] },
      { path: 'group.spatial.kind', eq: 'uniform' },
    ]);
    const text = renderReport(trace, json, expectations, findings, { title: 'front' });
    const lines = text.split('\n');
    expect(lines[0]).toBe('observe front · 0.0–2.0s · 30 fps · preview · bpm 120');
    expect(lines[1]).toBe('GROUP 8 fixtures · scalar · sources: waveform@sha256:3fa…(absolute, add, 1.0)');
    expect(text).toContain('temporal periodic 1.00 Hz · 2 beats · beat lock');
    expect(text).toContain('spatial  chase +x · step .125');
    expect(text).toContain('issues   stuck-0');
    expect(text).toMatch(/FIXTURE fx-4 \(x \.43 y 0\) 0–0 constant · stuck-0/);
    expect(text).toContain('WARNING  observe-stuck');
    expect(text).toContain('EXPECT   ✓ group.temporal.kind = "periodic" · ✓ group.temporal.hz within [0.9, 1.1] · ✗ group.spatial.kind = "uniform" ("chase")');
    // Compact: a group report stays around 6–10 lines.
    expect(lines.length).toBeLessThanOrEqual(10);
  });

  it('renders an rgb color line and named groups', () => {
    const trace = makeTrace({ samples: 4, signature: 'rgb', fn: (_, t) => [sine01(t, 2), 0, 0] });
    const { json, findings } = analyzeTrace(trace, { groups: [{ id: 1, name: 'front', fixtureIds: [1, 2] }] });
    const text = renderReport(trace, json, [], findings);
    expect(text).toContain('GROUP front · 2 fixtures · rgb');
    expect(text).toMatch(/color {4}red · hue 0°–0° mean 0° · sat 1\.00 · value 0–1\.00/);
    expect(text).toContain('periodic 2.00 Hz');
    expect(text).not.toContain('EXPECT');
    expect(text).not.toContain('FIXTURE');
  });

  it('lists every fixture with detail fixture and survives zero targets', () => {
    const trace = makeTrace({ samples: 3, fn: (_, t) => [sine01(t, 1)] });
    const { json, findings } = analyzeTrace(trace);
    const text = renderReport(trace, json, [], findings, { detail: 'fixture' });
    expect(text.split('\n').filter(l => l.startsWith('FIXTURE'))).toHaveLength(3);

    const empty = makeTrace({ samples: 0, fn: () => [0] });
    const res = analyzeTrace(empty);
    const emptyText = renderReport(empty, res.json, [], res.findings);
    expect(emptyText).toContain('GROUP 0 fixtures');
    expect(emptyText).toContain('issues   no-targets');
    expect(emptyText).toContain('observe-zero-targets');
  });
});
