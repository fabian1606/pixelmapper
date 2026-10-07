/**
 * Photometric render model — the single definition of how DMX channel values
 * turn into visible light in the previews.
 *
 * Canonical formula (mirrored by the 2D Rust renderer and the 3D adapters):
 *
 *   rgb  = Σ colorAdd·(dmx/255)  +  Σ colorLut[dmx]     (no color source at all → white)
 *   gate = Π shutterGate(shutterLut[dmx], tSec)         (strobe: fract(t·freq) < 0.5)
 *   out  = rgb × Π(dimmer dmx/255) × gate
 *
 * COLOR channels contribute additively scaled by their DMX value (RGB faders).
 * COLOR_WHEEL channels SELECT a color via a 256-entry LUT — they never scale
 * brightness. SHUTTER channels gate the output (open/closed/strobe) — they
 * never scale brightness either.
 */
import type { Channel, RenderRange } from './channel';
import type { Fixture } from './fixture';

// ─── LUT construction ─────────────────────────────────────────────────────────

/**
 * Expands the shutter ranges of a channel into a 256-entry frequency table:
 * -1 = closed, 0 = open, >0 = strobe frequency in Hz.
 * DMX values not covered by any range default to open.
 */
export function buildShutterLut(ranges: RenderRange[]): Float32Array {
  const lut = new Float32Array(256); // 0 = open
  for (const r of ranges) {
    if (r.kind !== 'shutter') continue;
    const span = Math.max(1, r.max - r.min);
    for (let v = Math.max(0, r.min); v <= Math.min(255, r.max); v++) {
      const t = (v - r.min) / span;
      if (r.freqStart < 0 || r.freqEnd < 0) {
        lut[v] = -1;
      } else {
        lut[v] = r.freqStart + (r.freqEnd - r.freqStart) * t;
      }
    }
  }
  return lut;
}

/**
 * Expands the color ranges of a wheel/preset channel into a 256×3 RGB table.
 * DMX values not covered by any range render white (never black — a wheel
 * channel must not be able to hide the fixture).
 */
export function buildColorLut(ranges: RenderRange[]): Uint8Array {
  const lut = new Uint8Array(256 * 3).fill(255);
  for (const r of ranges) {
    if (r.kind !== 'color') continue;
    const span = Math.max(1, r.max - r.min);
    for (let v = Math.max(0, r.min); v <= Math.min(255, r.max); v++) {
      const t = (v - r.min) / span;
      const end = r.rgbEnd ?? r.rgb;
      lut[v * 3] = Math.round(r.rgb[0] + (end[0] - r.rgb[0]) * t);
      lut[v * 3 + 1] = Math.round(r.rgb[1] + (end[1] - r.rgb[1]) * t);
      lut[v * 3 + 2] = Math.round(r.rgb[2] + (end[2] - r.rgb[2]) * t);
    }
  }
  return lut;
}

/** Gate factor for a shutter LUT entry at time tSec: 0 (dark) or 1 (open). */
export function shutterGate(freq: number, tSec: number): number {
  if (freq < 0) return 0;               // closed
  if (freq === 0) return 1;             // open
  const phase = tSec * freq;
  return phase - Math.floor(phase) < 0.5 ? 1 : 0;
}

// ─── Per-beam photometry descriptor ───────────────────────────────────────────

export interface BeamPhotometry {
  /** Additive color faders: absolute DMX index + peak color (0-255). */
  colorAdd: { idx: number; r: number; g: number; b: number }[];
  /** Color wheels / presets: absolute DMX index + 256×3 RGB LUT. */
  colorLuts: { idx: number; lut: Uint8Array }[];
  /** Absolute DMX indices of dimmer channels; factors multiply. */
  dimmers: number[];
  /** Shutter channels: absolute DMX index + 256-entry frequency LUT. */
  shutters: { idx: number; lut: Float32Array }[];
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ];
}

/**
 * Builds the photometry descriptor for one beam of a fixture.
 * Channels without a beamId are fixture-global and apply to every beam
 * (matching the historical resolveColor semantics).
 */
export function buildBeamPhotometry(fixture: Fixture, beamId?: string): BeamPhotometry {
  const base = fixture.startAddress - 1;
  const applies = (c: Channel) => !beamId || !c.beamId || c.beamId === beamId;

  const bp: BeamPhotometry = { colorAdd: [], colorLuts: [], dimmers: [], shutters: [] };

  for (const c of fixture.channels) {
    if (c.isFine || !applies(c)) continue;
    const idx = base + c.addressOffset;

    switch (c.role) {
      case 'COLOR': {
        const [r, g, b] = parseHex(c.colorValue || '#FFFFFF');
        bp.colorAdd.push({ idx, r, g, b });
        break;
      }
      case 'DIMMER':
        bp.dimmers.push(idx);
        break;
      case 'COLOR_WHEEL':
        bp.colorLuts.push({ idx, lut: buildColorLut(c.renderInfo?.ranges ?? []) });
        break;
      case 'SHUTTER':
        bp.shutters.push({ idx, lut: buildShutterLut(c.renderInfo?.ranges ?? []) });
        break;
    }
  }
  return bp;
}

/**
 * Builds photometry for all beams of a fixture, keyed by beam id.
 * The '' key holds the fixture-level descriptor (all channels, no beam filter).
 */
export function buildFixturePhotometry(fixture: Fixture): Map<string, BeamPhotometry> {
  const map = new Map<string, BeamPhotometry>();
  map.set('', buildBeamPhotometry(fixture));
  for (const beam of fixture.beams) {
    map.set(beam.id, buildBeamPhotometry(fixture, beam.id));
  }
  return map;
}

// ─── Canonical resolution ─────────────────────────────────────────────────────

/**
 * Core resolution: writes the beam's visible color as NORMALIZED floats
 * (0-1, unclamped above 1 for additive mixes) into `out` at `offset`.
 * Allocation-free — safe for per-frame hot loops.
 * `tSec` drives strobe animation; pass undefined to treat strobes as open
 * (for static callers like thumbnails).
 */
export function resolvePhotometricInto(
  bp: BeamPhotometry,
  dmx: Uint8Array,
  tSec: number | undefined,
  out: Float32Array,
  offset: number,
): void {
  let r = 0, g = 0, b = 0;

  for (const c of bp.colorAdd) {
    const w = (dmx[c.idx] ?? 0) / 255;
    r += c.r * w; g += c.g * w; b += c.b * w;
  }
  for (const c of bp.colorLuts) {
    const v = (dmx[c.idx] ?? 0) * 3;
    r += c.lut[v] ?? 255; g += c.lut[v + 1] ?? 255; b += c.lut[v + 2] ?? 255;
  }

  // No color source at all (dimmer-only fixture): white so it stays visible.
  if (bp.colorAdd.length === 0 && bp.colorLuts.length === 0) {
    r = g = b = 255;
  }

  let factor = 1;
  for (const idx of bp.dimmers) factor *= (dmx[idx] ?? 0) / 255;
  for (const s of bp.shutters) {
    const freq = s.lut[dmx[s.idx] ?? 0] ?? 0;
    factor *= tSec === undefined ? (freq < 0 ? 0 : 1) : shutterGate(freq, tSec);
  }

  out[offset] = (r / 255) * factor;
  out[offset + 1] = (g / 255) * factor;
  out[offset + 2] = (b / 255) * factor;
}

const scratch = new Float32Array(3);

/**
 * Resolves the visible RGB (0-255 each, clamped) of a beam from the DMX buffer.
 */
export function resolvePhotometricColor(
  bp: BeamPhotometry,
  dmx: Uint8Array,
  tSec?: number,
): [number, number, number] {
  resolvePhotometricInto(bp, dmx, tSec, scratch, 0);
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v * 255)));
  return [clamp(scratch[0]!), clamp(scratch[1]!), clamp(scratch[2]!)];
}

// ─── Open values (auto-defaults / highlight) ─────────────────────────────────

/**
 * Computes, per channel, the DMX value that makes the fixture emit full white:
 * shutter → open, dimmer → 255, RGB/white color faders → 255 (other hues 0),
 * color wheel → open/white slot. Channels with no light-relevant role are omitted.
 */
export function openValuesFor(fixture: Fixture): { channel: Channel; value: number }[] {
  const result: { channel: Channel; value: number }[] = [];

  const hasWhiteFader = fixture.channels.some(c => c.role === 'COLOR' && c.type === 'WHITE');

  for (const c of fixture.channels) {
    if (c.isFine) continue;

    switch (c.role) {
      case 'DIMMER':
        result.push({ channel: c, value: 255 });
        break;
      case 'COLOR': {
        const isWhiteish = c.type === 'WHITE' || c.type === 'WARM_WHITE' || c.type === 'COOL_WHITE';
        const isRgb = c.type === 'RED' || c.type === 'GREEN' || c.type === 'BLUE';
        // Prefer a dedicated white fader; otherwise mix white from RGB.
        const on = hasWhiteFader ? c.type === 'WHITE' : (isRgb || isWhiteish);
        result.push({ channel: c, value: on ? 255 : 0 });
        break;
      }
      case 'SHUTTER': {
        const open = openDmxValue(c, 'shutter');
        if (open !== undefined) result.push({ channel: c, value: open });
        break;
      }
      case 'COLOR_WHEEL': {
        const open = openDmxValue(c, 'color');
        if (open !== undefined) result.push({ channel: c, value: open });
        break;
      }
    }
  }
  return result;
}

/** DMX value at which a SHUTTER channel is open / a COLOR_WHEEL channel is white. */
function openDmxValue(c: Channel, kind: 'shutter' | 'color'): number | undefined {
  const ranges = c.renderInfo?.ranges ?? [];
  const mid = (r: RenderRange) => Math.round((r.min + r.max) / 2);

  if (kind === 'shutter') {
    const open = ranges.find(r => r.kind === 'shutter' && r.freqStart === 0 && r.freqEnd === 0);
    if (open) return mid(open);
    const notClosed = ranges.find(r => r.kind === 'shutter' && r.freqStart >= 0);
    if (notClosed) return mid(notClosed);
    return ranges.length === 0 ? undefined : 255;
  }

  const isWhite = (rgb: [number, number, number]) => rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250;
  const white = ranges.find(r => r.kind === 'color' && isWhite(r.rgb) && !r.rgbEnd);
  if (white) return mid(white);
  const first = ranges.find(r => r.kind === 'color');
  return first ? mid(first) : undefined;
}
