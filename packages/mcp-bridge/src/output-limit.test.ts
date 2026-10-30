// @vitest-environment node
// ── Output budget tests ─────────────────────────────────
//
// `toMcpContent` must never cut a result silently: oversized output is
// shortened by the bridge with an explicit notice, large JSON goes compact.

import { describe, expect, it } from 'vitest';

import { PRETTY_JSON_MAX_CHARS, renderJson, toMcpContent } from './output-limit';
import type { ToolContent } from './protocol';

/** Text of all text blocks, joined. */
function joined(blocks: ReturnType<typeof toMcpContent>): string {
  return blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/** A JSON value shaped like a pixel dump with `n` pixels. */
function bigValue(n: number) {
  return { pixels: Array.from({ length: n }, (_, i) => ({ index: i, x: i / n, y: 0.25, rgb: [255, 0, 0] })) };
}

describe('renderJson', () => {
  it('pretty-prints small values', () => {
    expect(renderJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('serializes large values compactly (round-trips)', () => {
    const value = bigValue(500);
    const out = renderJson(value);
    expect(JSON.stringify(value, null, 2).length).toBeGreaterThan(PRETTY_JSON_MAX_CHARS);
    expect(out).toBe(JSON.stringify(value));
    expect(JSON.parse(out)).toEqual(value);
  });

  it('renders undefined as null', () => {
    expect(renderJson(undefined)).toBe('null');
  });
});

describe('toMcpContent', () => {
  it('passes content within the budget through unchanged', () => {
    const content: ToolContent[] = [
      { type: 'text', text: 'summary' },
      { type: 'json', json: { a: 1 } },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ];
    expect(toMcpContent(content, 1_000)).toEqual([
      { type: 'text', text: 'summary' },
      { type: 'text', text: '{\n  "a": 1\n}' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ]);
  });

  it('cuts oversized JSON within the budget and appends an explicit notice', () => {
    const value = bigValue(2_000);
    const total = 'summary'.length + JSON.stringify(value).length;
    const blocks = toMcpContent([{ type: 'text', text: 'summary' }, { type: 'json', json: value }], 5_000);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: 'summary' });
    expect((blocks[1] as { text: string }).text.endsWith('…')).toBe(true);
    const notice = (blocks[2] as { text: string }).text;
    expect(notice).toContain(`of ${total} characters (limit 5000)`);
    expect(notice).toContain('INCOMPLETE');
    expect(notice).toContain('Narrow the request');
    expect(joined(blocks).length).toBeLessThanOrEqual(5_000);
  });

  it('drops later text blocks once the budget is used up but keeps images', () => {
    const blocks = toMcpContent(
      [
        { type: 'text', text: 'x'.repeat(3_000) },
        { type: 'text', text: 'never shown' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
      1_000,
    );
    expect(joined(blocks)).not.toContain('never shown');
    expect(blocks.some((b) => b.type === 'image')).toBe(true);
    expect(joined(blocks)).toContain('[output truncated');
  });
});
