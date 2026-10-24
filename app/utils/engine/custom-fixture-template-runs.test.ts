/**
 * Tests for folding explicit per-pixel channel lists into per-head groups.
 */
import { describe, expect, it } from 'vitest';
import {
  collectPixelKeysRowMajor,
  foldTemplateRun,
  resolveTemplateRef,
  type TemplateRef,
} from './custom-fixture-template-runs';
import type { OflFixture } from '~/utils/ofl/types';

/** Builds template refs from `[template, pixel]` pairs. */
const refs = (pairs: [string, string][]): TemplateRef[] =>
  pairs.map(([templateKey, pixelKey]) => ({ templateKey, pixelKey }));

describe('collectPixelKeysRowMajor', () => {
  it('generates OFL default keys from pixelCount', () => {
    expect(collectPixelKeysRowMajor({ pixelCount: [4, 1, 1] })).toEqual(['1', '2', '3', '4']);
    expect(collectPixelKeysRowMajor({ pixelCount: [2, 2, 1] })).toEqual(['(1, 1)', '(2, 1)', '(1, 2)', '(2, 2)']);
    expect(collectPixelKeysRowMajor({ pixelCount: [1, 1, 1] })).toEqual(['1']);
  });

  it('prefers explicit pixelKeys and skips holes', () => {
    expect(collectPixelKeysRowMajor({ pixelKeys: [[['a', null, 'b']]] })).toEqual(['a', 'b']);
  });

  it('returns no keys without a matrix', () => {
    expect(collectPixelKeysRowMajor(undefined)).toEqual([]);
  });
});

describe('resolveTemplateRef', () => {
  const ofl = {
    templateChannels: { 'Red $pixelKey': {}, 'Red Fine $pixelKey': {} },
  } as unknown as OflFixture;
  const pixels = new Set(['1', '2']);

  it('resolves instantiated template channels of known pixels', () => {
    expect(resolveTemplateRef('Red 2', ofl, pixels)).toEqual({ templateKey: 'Red $pixelKey', pixelKey: '2' });
    expect(resolveTemplateRef('Red Fine 1', ofl, pixels)).toEqual({ templateKey: 'Red Fine $pixelKey', pixelKey: '1' });
  });

  it('ignores pixel groups and plain channels', () => {
    expect(resolveTemplateRef('Red Master', ofl, pixels)).toBeNull();
    expect(resolveTemplateRef('Dimmer', ofl, pixels)).toBeNull();
  });
});

describe('foldTemplateRun', () => {
  const pixels = ['1', '2'];

  it('folds perPixel and perChannel orders', () => {
    expect(foldTemplateRun(refs([['R', '1'], ['G', '1'], ['R', '2'], ['G', '2']]), pixels))
      .toEqual({ templateKeys: ['R', 'G'], order: 'perPixel' });
    expect(foldTemplateRun(refs([['R', '1'], ['R', '2'], ['G', '1'], ['G', '2']]), pixels))
      .toEqual({ templateKeys: ['R', 'G'], order: 'perChannel' });
  });

  it('rejects runs that miss pixels, repeat templates or use another pixel order', () => {
    expect(foldTemplateRun(refs([['R', '1'], ['G', '1']]), pixels)).toBeNull();
    expect(foldTemplateRun(refs([['R', '1'], ['R', '1'], ['R', '2'], ['R', '2']]), pixels)).toBeNull();
    expect(foldTemplateRun(refs([['R', '2'], ['R', '1']]), pixels)).toBeNull();
    expect(foldTemplateRun([], pixels)).toBeNull();
  });
});
