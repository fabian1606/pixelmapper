/**
 * Folding of explicitly listed per-pixel channels into editor per-head groups.
 *
 * OFL modes can reference matrix channels in two ways:
 *  1. `{ insert: 'matrixChannels', templateChannels: ['Red $pixelKey', …] }`
 *  2. Plain strings of instantiated templates: `'Red 1', 'Green 1', …, 'Blue 4'`.
 *
 * The custom fixture editor only models (1) as `perHead` mode entries. Without
 * folding, form (2) turns every instance into its own global channel and the
 * per-pixel structure (`templateChannels`, beam assignment) is lost on save.
 * This module recognizes a run of form (2) that covers every pixel exactly once
 * in a regular order, so `initFromOflFixture` can map it to one per-head group.
 */
import type { OflFixture, OflMatrix } from '~/utils/ofl/types';

// ── Types ────────────────────────────────────────────────────────────────────

/** A mode string resolved to its template channel and pixel key. */
export interface TemplateRef {
  /** Template channel key, e.g. `'Red $pixelKey'`. */
  templateKey: string;
  /** Pixel key substituted for `$pixelKey`, e.g. `'1'`. */
  pixelKey: string;
}

/** A run of template references folded into one per-head group. */
export interface FoldedTemplateRun {
  /** Template keys of the group, in DMX order within one pixel / block. */
  templateKeys: string[];
  /** `perPixel`: R1 G1 B1 R2 G2 B2 … — `perChannel`: R1 R2 … G1 G2 … */
  order: 'perPixel' | 'perChannel';
}

// ── Pixel keys ───────────────────────────────────────────────────────────────

/**
 * All pixel keys of a matrix in row-major order (X fastest, then Y, then Z) —
 * the order in which the editor numbers its heads. Explicit `pixelKeys` win;
 * otherwise the OFL default keys are generated from `pixelCount` (same
 * convention as OFL's Matrix.js and `fixture-factory.ts`).
 */
export function collectPixelKeysRowMajor(matrix: OflMatrix | undefined): string[] {
  if (!matrix) return [];
  if (matrix.pixelKeys) {
    return matrix.pixelKeys.flat(2).filter((key): key is string => Boolean(key));
  }
  if (!matrix.pixelCount) return [];

  const [xCount, yCount, zCount] = matrix.pixelCount;
  // Axes with more than one pixel define the key format ("3", "(1, 2)", …).
  const definedAxes = [xCount > 1 ? 'X' : '', yCount > 1 ? 'Y' : '', zCount > 1 ? 'Z' : ''].filter(Boolean);
  const keys: string[] = [];
  for (let z = 1; z <= zCount; z++) {
    for (let y = 1; y <= yCount; y++) {
      for (let x = 1; x <= xCount; x++) {
        if (definedAxes.length === 0) keys.push('1');
        else if (definedAxes.length === 1) keys.push(String(Math.max(x, y, z)));
        else if (definedAxes.length === 2) {
          const first = definedAxes.includes('X') ? x : y;
          const last = definedAxes.includes('Y') ? y : z;
          keys.push(`(${first}, ${last})`);
        }
        else keys.push(`(${x}, ${y}, ${z})`);
      }
    }
  }
  return keys;
}

// ── Reference resolution ─────────────────────────────────────────────────────

/**
 * Resolves a mode string like `'Red 1'` to `{ templateKey: 'Red $pixelKey', pixelKey: '1' }`.
 * Only pixel keys of the matrix count (pixel *groups* such as `'Master'` are
 * whole-fixture channels and stay global). Returns `null` when nothing matches.
 */
export function resolveTemplateRef(
  channelKey: string,
  ofl: OflFixture,
  pixelKeys: ReadonlySet<string>,
): TemplateRef | null {
  for (const templateKey of Object.keys(ofl.templateChannels ?? {})) {
    if (!templateKey.includes('$pixelKey')) continue;
    const [prefix = '', suffix = ''] = templateKey.split('$pixelKey');
    if (!channelKey.startsWith(prefix) || !channelKey.endsWith(suffix)) continue;
    if (channelKey.length <= prefix.length + suffix.length) continue;
    const pixelKey = channelKey.slice(prefix.length, channelKey.length - suffix.length);
    // Keep looking when the remainder is not a pixel key (e.g. 'Red Fine 1'
    // against 'Red $pixelKey' — 'Fine 1' is no pixel).
    if (pixelKeys.has(pixelKey)) return { templateKey, pixelKey };
  }
  return null;
}

// ── Folding ──────────────────────────────────────────────────────────────────

/** True when all strings are distinct. */
function allDistinct(values: string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * Folds a run of template references into one per-head group when the run
 * lists every pixel of `pixelKeys` (in that order) for the same distinct set
 * of templates — either pixel by pixel or template by template.
 *
 * @returns The folded group, or `null` when the run is irregular (the caller
 *          then keeps the references as individual global channels).
 */
export function foldTemplateRun(run: TemplateRef[], pixelKeys: string[]): FoldedTemplateRun | null {
  const pixelCount = pixelKeys.length;
  if (pixelCount === 0 || run.length === 0 || run.length % pixelCount !== 0) return null;
  const templateCount = run.length / pixelCount;

  // perPixel: [t1(p1) … tk(p1)] [t1(p2) … tk(p2)] …
  const perPixelTemplates = run.slice(0, templateCount).map(r => r.templateKey);
  const isPerPixel = allDistinct(perPixelTemplates) && run.every((ref, i) =>
    ref.pixelKey === pixelKeys[Math.floor(i / templateCount)]
    && ref.templateKey === perPixelTemplates[i % templateCount],
  );
  if (isPerPixel) return { templateKeys: perPixelTemplates, order: 'perPixel' };

  // perChannel: [t1(p1) … t1(pN)] [t2(p1) … t2(pN)] …
  const perChannelTemplates = Array.from({ length: templateCount }, (_, t) => run[t * pixelCount]!.templateKey);
  const isPerChannel = allDistinct(perChannelTemplates) && run.every((ref, i) =>
    ref.pixelKey === pixelKeys[i % pixelCount]
    && ref.templateKey === perChannelTemplates[Math.floor(i / pixelCount)],
  );
  if (isPerChannel) return { templateKeys: perChannelTemplates, order: 'perChannel' };

  return null;
}
