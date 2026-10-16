import type { Fixture } from '~/utils/engine/core/fixture';
import type { ModifierInstance } from '~/utils/engine/types';
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import { modifierKey } from '~/utils/engine/modifiers';
import { WORLD_WIDTH, WORLD_HEIGHT } from '~/utils/engine/constants';
import { beamWorldPx } from '~/utils/kinds/kind-host';
import { resolveDistribution, usesRanks } from '~/utils/engine/distribution/resolve';

// ── Packet type constants ─────────────────────────────────────────────────────

// Engine packets (the ESP firmware protocol lives in extensions/connector-esp).
export const TYPE_LAYOUT_BIN    = 0x14;
export const TYPE_CHAN_BIN      = 0x15;
/** Modifier instances (replaces the former TYPE_FX_BIN, same id). */
export const TYPE_MODIFIERS_BIN = 0x16;

const MAGIC0 = 0xaa, MAGIC1 = 0x55;

// ── Channel type ID map (must match rs-engine/core/src/engine.rs channel_type_name) ──

export const CHANNEL_TYPE_ID: Record<string, number> = {
  RED: 0, GREEN: 1, BLUE: 2, WHITE: 3, WARM_WHITE: 4, COOL_WHITE: 5, AMBER: 6, UV: 7,
  CYAN: 8, MAGENTA: 9, YELLOW: 10, LIME: 11, INDIGO: 12, DIMMER: 13, PAN: 14, TILT: 15,
  PANTILT_SPEED: 16, STROBE: 17, STROBE_SPEED: 18, STROBE_DURATION: 19,
  ZOOM: 20, FOCUS: 21, IRIS: 22, FROST: 23, BEAM_ANGLE: 24, BEAM_POSITION: 25,
  PRISM: 26, PRISM_ROTATION: 27, BLADE: 28, COLOR_WHEEL: 29, COLOR_PRESET: 30,
  COLOR_TEMPERATURE: 31, GOBO_WHEEL: 32, GOBO_SPIN: 33, EFFECT: 34,
  EFFECT_SPEED: 35, EFFECT_DURATION: 36, SOUND_SENSITIVITY: 37, ROTATION: 38,
  SPEED: 39, TIME: 40, FOG: 41, MAINTENANCE: 42, GENERIC: 43, CUSTOM: 44,
};

const SPEED_MODE_ID: Record<string, number> = { time: 0, beat: 1, infinite: 2 };
/** Distribution ids (rs-engine `distribution::{Mode, Grouping}::from_id`). */
const DIST_MODE_ID: Record<string, number> = { none: 0, linear: 1, radial: 2, conical: 3, order: 4 };
const GROUPING_ID: Record<string, number> = { none: 0, everyN: 1, sections: 2, random: 3 };

// ── Low-level buffer writer ───────────────────────────────────────────────────

class BufWriter {
  private buf: number[] = [];
  private dv = new DataView(new ArrayBuffer(4));

  u8(v: number)  { this.buf.push(v & 0xff); }
  u16(v: number) { this.buf.push(v & 0xff, (v >> 8) & 0xff); }
  f32(v: number) {
    this.dv.setFloat32(0, v, true);
    this.buf.push(this.dv.getUint8(0), this.dv.getUint8(1), this.dv.getUint8(2), this.dv.getUint8(3));
  }

  speed(s: { mode: string; timeMs: number; beatValue: number; beatOffset: number }) {
    this.u8(SPEED_MODE_ID[s.mode] ?? 0);
    this.f32(s.timeMs);
    this.f32(s.beatValue);
    this.f32(s.beatOffset);
  }

  u32(v: number) { this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); }

  /** Payload size so far (bytes). */
  get size(): number { return this.buf.length; }

  toPacket(type: number): Uint8Array {
    // The frame length is u16: larger payloads cannot be framed (plan §5 risk).
    if (this.buf.length > 0xffff) throw new Error(`packet 0x${type.toString(16)} payload of ${this.buf.length} bytes exceeds 64 KB`);
    const out = new Uint8Array(5 + this.buf.length);
    out[0] = MAGIC0; out[1] = MAGIC1; out[2] = type;
    out[3] = this.buf.length & 0xff;
    out[4] = (this.buf.length >> 8) & 0xff;
    for (let i = 0; i < this.buf.length; i++) out[5 + i] = this.buf[i]!;
    return out;
  }
}

/** FNV-1a hash of a fixture id (stable seed source for modifiers). */
export function fixtureIdHash(id: string | number): number {
  let h = 0x811c9dc5;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

// ── Layout packet (TYPE_LAYOUT_BIN 0x14) ─────────────────────────────────────
// Replicates the beam transform from engine.ts syncTargets() so WASM and ESP32
// see identical worldX/worldY per channel.

export function buildLayoutBin(fixtures: Fixture[]): Uint8Array {
  const w = new BufWriter();
  w.u16(fixtures.length);

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!;
    const groupIndex = i;
    // Layout v2: fixture id hash (stable per-fixture seeds) …
    w.u16(groupIndex);
    w.u32(fixtureIdHash(f.id));
    w.u16(f.channels.length);
    const headIndex = new Map(f.beams.map((b, bi) => [b.id, bi]));

    const beamById = new Map(f.beams.map(b => [b.id, b]));
    for (const ch of f.channels) {
      // Channel position = its beam's world position (kind beams via their
      // offset, classic beams via the rotated local offset), else the origin.
      let worldX = f.fixturePosition.x;
      let worldY = f.fixturePosition.y;
      const beam = ch.beamId ? beamById.get(ch.beamId) : undefined;
      if (beam) {
        const p = beamWorldPx(f, beam);
        worldX = p.x / WORLD_WIDTH;
        worldY = p.y / WORLD_HEIGHT;
      }

      w.u16(f.startAddress - 1 + ch.addressOffset);
      w.u8(CHANNEL_TYPE_ID[ch.type] ?? 255);
      w.f32(worldX);
      w.f32(worldY);
      
      // Send resolution and fine offsets for 16-bit / 24-bit packing
      const res = ch.isFine ? 0 : (ch.resolution ?? 1);
      w.u8(res);
      w.u16(ch.fineAddressOffsets?.[0] !== undefined ? f.startAddress - 1 + ch.fineAddressOffsets[0] : 0xFFFF);
      w.u16(ch.fineAddressOffsets?.[1] !== undefined ? f.startAddress - 1 + ch.fineAddressOffsets[1] : 0xFFFF);

      // Per-channel DMX range (remap bounds). Defaults to full 0-255.
      w.u8(ch.rangeMin ?? 0);
      w.u8(ch.rangeMax ?? 255);
      // … and the head (beam) index of every channel.
      w.u16(ch.beamId !== undefined ? (headIndex.get(ch.beamId) ?? 0) : 0);
    }
  }

  return w.toPacket(TYPE_LAYOUT_BIN);
}

// ── Channels packet (TYPE_CHAN_BIN 0x15) ──────────────────────────────────────
// Groups channels with identical chaser configs to reduce size.

export function buildChannelsBin(fixtures: Fixture[]): Uint8Array {
  const groups = new Map<string, { chaser: Fixture['channels'][0]['chaserConfig']; dmxIndices: number[] }>();

  for (const f of fixtures) {
    for (const ch of f.channels) {
      const dmxIndex = f.startAddress - 1 + ch.addressOffset;
      const cfg = ch.chaserConfig;
      const key = `${cfg.stepsCount}|${cfg.isPlaying ? 1 : 0}|${cfg.activeEditStep}|` +
        `${cfg.stepDuration.mode}:${cfg.stepDuration.timeMs}:${cfg.stepDuration.beatValue}:${cfg.stepDuration.beatOffset}|` +
        `${cfg.fadeDuration.mode}:${cfg.fadeDuration.timeMs}:${cfg.fadeDuration.beatValue}:${cfg.fadeDuration.beatOffset}|` +
        cfg.stepValues.slice(0, cfg.stepsCount).join(',');
      if (!groups.has(key)) {
        groups.set(key, { chaser: ch.chaserConfig, dmxIndices: [] });
      }
      groups.get(key)!.dmxIndices.push(dmxIndex);
    }
  }

  const w = new BufWriter();
  w.u16(groups.size);

  for (const { chaser, dmxIndices } of groups.values()) {
    w.u16(dmxIndices.length);
    for (const idx of dmxIndices) w.u16(idx);
    w.u8(chaser.stepsCount);
    w.u8(chaser.activeEditStep);
    w.u8(chaser.isPlaying ? 1 : 0);
    w.speed(chaser.stepDuration);
    w.speed(chaser.fadeDuration);
    for (let i = 0; i < chaser.stepsCount; i++) {
      w.f32(chaser.stepValues[i] ?? 0);
    }
  }

  return w.toPacket(TYPE_CHAN_BIN);
}

// ── Modifiers packet (TYPE_MODIFIERS_BIN 0x16, version 2) ───────────────────
// Payload (see rs-engine/core/src/bin_protocol.rs):
//   u8 version(2); u16 count; per instance:
//   u32 key; u16 pluginIndex; u8 signature; u8 output; u8 blend; f32 strength;
//   speed; distribution; u8 nTypes; u8[] types; u16 maskBytes (0 = all);
//   u8[] mask; u16 nParams; f32[] params.
// distribution (plan M3.4):
//   u8 scope(0 across,1 within); u8 mode(0 none,1 linear,2 radial,3 conical,4 order);
//   f32 originX, originY, endX, endY; u8 reverse;
//   u8 groupingKind(0 none,1 everyN,2 sections,3 random); u8 groupingN; u32 groupingSeed;
//   u8 withinOffset(0 none,1 order);
//   u16 rankEntries; per entry: u16 fixtureLayoutIndex, u16 rank
//   (targeted fixtures only; mode order or withinOffset order).
// Size budget: the u16 frame length caps the payload at 64 KB (e.g. 200
// fixtures cost 800 bytes of ranks per ordered instance, a curve 512 bytes).
// The plugin table (index → hash) travels next to the packet (worker message).

/** Version byte of the modifiers packet. */
export const MODIFIERS_BIN_VERSION = 2;

const BLEND_MODE_ID: Record<string, number> = { add: 0, override: 1, multiply: 2, max: 3, min: 4 };
const SIGNATURE_ID: Record<string, number> = { scalar: 0, rgb: 1, panTilt: 2 };
/** Manifest output → wire id (rs-engine `OutputMode::from_id`). */
const OUTPUT_MODE_ID: Record<string, number> = { bipolar: 0, absolute: 1, scale: 2 };

/** Result of `buildModifiersBin`. */
export interface ModifiersPacket {
  /** Framed packet (strip the 5-byte header before dispatching to the engine). */
  packet: Uint8Array;
  /** Plugin table: index → content hash. */
  plugins: string[];
}

/**
 * Encodes modifier instances. Instances whose plugin manifest is unknown are
 * skipped (they are included again once the plugin is known).
 */
export function buildModifiersBin(
  modifiers: readonly ModifierInstance[],
  fixtures: readonly Fixture[],
  getManifest: (hash: string) => ContentPluginManifest | undefined,
): ModifiersPacket {
  const idToIndex = new Map<string | number, number>();
  fixtures.forEach((f, i) => idToIndex.set(f.id, i));
  /** Layout index by stringified id (rank tables are keyed by string). */
  const indexByKey = new Map(fixtures.map((f, i) => [String(f.id), i]));
  const maskBytes = Math.ceil(fixtures.length / 8);

  const plugins: string[] = [];
  const encodable = modifiers.filter(m => getManifest(m.plugin));

  const w = new BufWriter();
  w.u8(MODIFIERS_BIN_VERSION);
  w.u16(encodable.length);
  for (const m of encodable) {
    const manifest = getManifest(m.plugin)!;
    let pluginIndex = plugins.indexOf(m.plugin);
    if (pluginIndex < 0) pluginIndex = plugins.push(m.plugin) - 1;

    w.u32(modifierKey(m.id));
    w.u16(pluginIndex);
    w.u8(SIGNATURE_ID[m.signature] ?? 0);
    w.u8(OUTPUT_MODE_ID[manifest.output] ?? 0);
    w.u8(BLEND_MODE_ID[m.blendMode] ?? 0);
    w.f32(Math.max(0, Math.min(1, m.strength)));
    w.speed(m.speed);

    // Distribution block; ranks are resolved here and sent as a table.
    const d = m.distribution;
    const resolved = resolveDistribution(m, fixtures);
    w.u8(d.scope === 'within' ? 1 : 0);
    w.u8(DIST_MODE_ID[d.mode] ?? 0);
    w.f32(d.origin.x);
    w.f32(d.origin.y);
    w.f32(d.end.x);
    w.f32(d.end.y);
    w.u8(d.reverse ? 1 : 0);
    w.u8(GROUPING_ID[d.grouping.kind] ?? 0);
    w.u8(Math.max(1, Math.min(255, Math.round(d.grouping.n))));
    w.u32(d.grouping.seed >>> 0);
    w.u8(d.withinOffset === 'order' ? 1 : 0);
    const entries = (usesRanks(d) ? Object.entries(resolved.ranks) : [])
      .map(([id, rank]) => [indexByKey.get(id), rank] as const)
      .filter((e): e is readonly [number, number] => e[0] !== undefined);
    w.u16(entries.length);
    for (const [index, rank] of entries) {
      w.u16(index);
      w.u16(rank);
    }

    // Scalar targets by channel type (rgb/panTilt resolve their channels in the core).
    const types = m.signature === 'scalar' ? m.targetChannels.map(t => CHANNEL_TYPE_ID[t]).filter((v): v is number => v !== undefined) : [];
    w.u8(types.length);
    for (const t of types) w.u8(t);

    // Fixture mask; undefined targetFixtureIds = all fixtures.
    if (m.targetFixtureIds) {
      const mask = new Uint8Array(Math.max(1, maskBytes));
      for (const id of m.targetFixtureIds) {
        const idx = idToIndex.get(id);
        if (idx !== undefined) mask[idx >> 3]! |= 1 << (idx & 7);
      }
      w.u16(mask.length);
      for (const b of mask) w.u8(b);
    }
    else {
      w.u16(0);
    }

    const params = encodeParams(manifest.params, m.params, { ticks: resolved.ticks });
    w.u16(params.length);
    for (const v of params) w.f32(v);
  }

  return { packet: w.toPacket(TYPE_MODIFIERS_BIN), plugins };
}
