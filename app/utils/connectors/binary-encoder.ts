import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect } from '~/utils/engine/types';
import { WORLD_WIDTH, WORLD_HEIGHT, FIXTURE_RADIUS } from '~/utils/engine/constants';

// ── Packet type constants ─────────────────────────────────────────────────────

export const TYPE_BPM           = 0x10;
export const TYPE_VERSION_REQ   = 0x11;
export const TYPE_TIMESYNC      = 0x13;
export const TYPE_LAYOUT_BIN    = 0x14;
export const TYPE_CHAN_BIN      = 0x15;
export const TYPE_FX_BIN        = 0x16;
export const TYPE_OTA_BEGIN     = 0x15;
export const TYPE_OTA_CHUNK     = 0x16;
export const TYPE_OTA_END       = 0x17;
export const TYPE_UNIVERSE_MAP  = 0x18;

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
const DIRECTION_ID:  Record<string, number> = { NONE: 0, LINEAR: 1, RADIAL: 2, SYMMETRICAL: 3 };

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

  bytes(arr: Uint8Array) {
    for (let i = 0; i < arr.length; i++) this.buf.push(arr[i]!);
  }

  toPacket(type: number): Uint8Array {
    const out = new Uint8Array(5 + this.buf.length);
    out[0] = MAGIC0; out[1] = MAGIC1; out[2] = type;
    out[3] = this.buf.length & 0xff;
    out[4] = (this.buf.length >> 8) & 0xff;
    for (let i = 0; i < this.buf.length; i++) out[5 + i] = this.buf[i]!;
    return out;
  }
}

// ── Simple fixed packets ──────────────────────────────────────────────────────

export function buildVersionRequestPacket(): Uint8Array {
  // Zero-length payload — ESP32 replies with "[version] X.Y.Z\n" on serial
  const out = new Uint8Array(5);
  out[0] = MAGIC0; out[1] = MAGIC1; out[2] = TYPE_VERSION_REQ; out[3] = 0; out[4] = 0;
  return out;
}

export function buildBpmPacket(bpm: number): Uint8Array {
  const out = new Uint8Array(9);
  out[0] = MAGIC0; out[1] = MAGIC1; out[2] = TYPE_BPM; out[3] = 4; out[4] = 0;
  new DataView(out.buffer).setFloat32(5, bpm, true);
  return out;
}

export function buildTimesyncPacket(elapsedMs: number): Uint8Array {
  const out = new Uint8Array(9);
  out[0] = MAGIC0; out[1] = MAGIC1; out[2] = TYPE_TIMESYNC; out[3] = 4; out[4] = 0;
  new DataView(out.buffer).setFloat32(5, elapsedMs, true);
  return out;
}

export function buildOtaBeginPacket(totalSize: number): Uint8Array {
  const w = new BufWriter();
  w.u32(totalSize);
  return w.toPacket(TYPE_OTA_BEGIN);
}

export function buildOtaChunkPacket(chunk: Uint8Array): Uint8Array {
  const w = new BufWriter();
  w.bytes(chunk);
  return w.toPacket(TYPE_OTA_CHUNK);
}

export function buildOtaEndPacket(): Uint8Array {
  const w = new BufWriter();
  return w.toPacket(TYPE_OTA_END);
}

// ── Universe map packet (TYPE_UNIVERSE_MAP 0x18) ──────────────────────────────
// Tells the ESP32 which DMX universes it should render and output.
// Payload: [count, universe1, universe2, ...]

export function buildUniverseMapPacket(universes: number[]): Uint8Array {
  const w = new BufWriter();
  w.u8(universes.length);
  for (const u of universes) w.u8(u);
  return w.toPacket(TYPE_UNIVERSE_MAP);
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
    const rotRad = (f.rotation ?? 0) * (Math.PI / 180);
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    w.u16(groupIndex);
    w.u8(f.channels.length);

    for (const ch of f.channels) {
      let worldX = f.fixturePosition.x;
      let worldY = f.fixturePosition.y;

      // Per-beam position with rotation — mirrors engine.ts syncTargets() lines 82-96
      if (ch.beamId) {
        const beam = f.beams?.find(b => b.id === ch.beamId);
        if (beam) {
          const fWidth  = f.fixtureSize.x * FIXTURE_RADIUS * 2;
          const fHeight = f.fixtureSize.y * FIXTURE_RADIUS * 2;
          const localPx = beam.localX * fWidth;
          const localPy = beam.localY * fHeight;
          const rotPx = localPx * cosR - localPy * sinR;
          const rotPy = localPx * sinR + localPy * cosR;
          worldX += rotPx / WORLD_WIDTH;
          worldY += rotPy / WORLD_HEIGHT;
        }
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
      const key = JSON.stringify(ch.chaserConfig);
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

// ── Effects packet (TYPE_FX_BIN 0x16) ────────────────────────────────────────

export function buildEffectsBin(effects: Effect[], fixtures: Fixture[]): Uint8Array {
  // Bitmask size derived from fixture count — both sides compute the same value
  // after layout sync. Bit i = fixture with group_index i is targeted.
  const fixtureCount = fixtures.length;
  const bitmaskBytes = Math.ceil(fixtureCount / 8);

  const idToIndex = new Map<string | number, number>();
  fixtures.forEach((f, i) => idToIndex.set(f.id, i));

  const w = new BufWriter();
  w.u8(effects.length);

  for (const effect of effects) {
    // Channel types: count=0 means all channel types
    const targetChannels: string[] = effect.targetChannels ?? [];
    w.u8(targetChannels.length);
    for (const ct of targetChannels) w.u8(CHANNEL_TYPE_ID[ct] ?? 255);

    // Fixture bitmask: bit i set → fixture with group_index i is targeted.
    // null/empty targetFixtureIds → all fixtures targeted (all bits set).
    const bitmask = new Uint8Array(bitmaskBytes);
    const targetedIndices: number[] = [];
    
    if (effect.targetFixtureIds?.length) {
      for (const id of effect.targetFixtureIds) {
        const idx = idToIndex.get(id);
        if (idx !== undefined) targetedIndices.push(idx);
      }
    } else {
      for (let i = 0; i < fixtureCount; i++) targetedIndices.push(i);
    }
    
    for (const idx of targetedIndices) {
      bitmask[idx >> 3]! |= (1 << (idx & 7));
    }
    for (const byte of bitmask) w.u8(byte);

    w.u8(DIRECTION_ID[effect.direction ?? 'LINEAR'] ?? 1);
    w.f32(effect.originX ?? 0.5);
    w.f32(effect.originY ?? 0.5);
    w.f32(effect.angle ?? 0);
    // strength is 0–100% in the UI; Rust engine expects 0–255 DMX units
    w.f32(effect.strength * 2.55);
    w.u8(effect.reverse ? 1 : 0);
    w.f32(effect.fanning);
    // Shape type: 0=sine,1=square,2=triangle,3=sawtooth,4=bounce,5=ramp,6=smooth
    const SHAPE_ID: Record<string, number> = {
      sine: 0, square: 1, triangle: 2, sawtooth: 3, bounce: 4, ramp: 5, smooth: 6,
    };
    const waveformShape = (effect as any).waveformShape ?? 'sine';
    const waveformParams = (effect as any).waveformParams ?? { param: 0.5, start: 0, end: 1 };
    w.u8(SHAPE_ID[waveformShape] ?? 0);
    w.f32(waveformParams.param ?? 0.5);
    w.f32(waveformParams.start ?? 0);
    w.f32(waveformParams.end ?? 1);
    // startLevel/endLevel: use explicit value if set, else 999.0 = "use natural shape value"
    w.f32(waveformParams.startLevel ?? 999.0);
    w.f32(waveformParams.endLevel ?? 999.0);
    w.speed({ ...effect.speed, beatOffset: effect.speed.beatOffset || 0 });
  }

  return w.toPacket(TYPE_FX_BIN);
}
