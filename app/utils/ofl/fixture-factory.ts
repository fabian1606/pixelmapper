import type { OflFixture, OflMatrix, OflMatrixChannelInsert } from './types';
import { resolveOflChannel } from './capability-map';
import { reactive } from 'vue';
import { Fixture } from '../engine/core/fixture';
import type { Channel } from '../engine/core/channel';
import { Beam } from '../engine/core/beam';

// ─── Pixel Key Helpers ───────────────────────────────────────────────────────

/** All non-null pixel keys from a pixelKeys structure, in Z→Y→X order. */
function collectPixelKeysZYX(matrix: OflMatrix): string[] {
  if (matrix.pixelKeys) {
    const keys: string[] = [];
    for (const zLayers of matrix.pixelKeys) {
      for (const row of zLayers) {
        for (const key of row) {
          if (key) keys.push(key);
        }
      }
    }
    return keys;
  }
  return generateDefaultKeys(matrix);
}

/** Generate default pixel key names matching the OFL Matrix.js convention. */
function generateDefaultKeys(matrix: OflMatrix): string[] {
  if (!matrix.pixelCount) return [];
  const [xCount, yCount, zCount] = matrix.pixelCount;
  const definedAxes: string[] = [];
  if (xCount > 1) definedAxes.push('X');
  if (yCount > 1) definedAxes.push('Y');
  if (zCount > 1) definedAxes.push('Z');

  const keys: string[] = [];
  for (let z = 1; z <= zCount; z++) {
    for (let y = 1; y <= yCount; y++) {
      for (let x = 1; x <= xCount; x++) {
        if (definedAxes.length === 0) {
          keys.push('1');
        } else if (definedAxes.length === 1) {
          keys.push(String(Math.max(x, y, z)));
        } else if (definedAxes.length === 2) {
          const first = definedAxes.includes('X') ? x : y;
          const last = definedAxes.includes('Y') ? y : z;
          keys.push(`(${first}, ${last})`);
        } else {
          keys.push(`(${x}, ${y}, ${z})`);
        }
      }
    }
  }
  return keys;
}

/**
 * Returns pixel keys in the order dictated by `repeatFor`.
 * Matches the OFL spec and Matrix.js behaviour.
 */
function getOrderedPixelKeys(matrix: OflMatrix, repeatFor: OflMatrixChannelInsert['repeatFor']): string[] {
  // Explicit list — use as-is (may be group names or pixel keys)
  if (Array.isArray(repeatFor)) return repeatFor.filter(Boolean);

  // Alphabetical / numeric sort
  if (repeatFor === 'eachPixelABC') {
    return collectPixelKeysZYX(matrix).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }

  // Iterate over pixelGroups in definition order, yielding group keys
  if (repeatFor === 'eachPixelGroup') {
    return matrix.pixelGroups ? Object.keys(matrix.pixelGroups) : [];
  }

  // Axis-ordering variants — map "eachPixelXYZ" → iterate X inner → Y middle → Z outer
  type Axis = 'x' | 'y' | 'z';
  const axisMap: Record<string, [Axis, Axis, Axis]> = {
    eachPixelXYZ: ['z', 'y', 'x'],
    eachPixelYXZ: ['z', 'x', 'y'],
    eachPixelXZY: ['y', 'z', 'x'],
    eachPixelZXY: ['y', 'x', 'z'],
    eachPixelYZX: ['x', 'z', 'y'],
    eachPixelZYX: ['x', 'y', 'z'],
  };

  const order = axisMap[repeatFor];
  if (!order) return collectPixelKeysZYX(matrix); // fallback

  // Build a flat map from [x,y,z] → key
  const allZyx = collectPixelKeysZYX(matrix);
  const pc = matrix.pixelCount ?? [1, 1, 1];
  const [xN, yN, zN] = pc;
  type Triple = { x: number; y: number; z: number; key: string };
  const triples: Triple[] = [];
  let idx = 0;
  for (let z = 1; z <= zN; z++) {
    for (let y = 1; y <= yN; y++) {
      for (let x = 1; x <= xN; x++) {
        const key = allZyx[idx++];
        if (key) triples.push({ x, y, z, key });
      }
    }
  }

  const [outer, mid, inner] = order;
  const maxOuter = outer === 'x' ? xN : outer === 'y' ? yN : zN;
  const maxMid = mid === 'x' ? xN : mid === 'y' ? yN : zN;
  const maxInner = inner === 'x' ? xN : inner === 'y' ? yN : zN;

  const result: string[] = [];
  for (let o = 1; o <= maxOuter; o++) {
    for (let m = 1; m <= maxMid; m++) {
      for (let i = 1; i <= maxInner; i++) {
        const coords = { x: 0, y: 0, z: 0 };
        coords[outer] = o; coords[mid] = m; coords[inner] = i;
        const t = triples.find(t => t.x === coords.x && t.y === coords.y && t.z === coords.z);
        if (t) result.push(t.key);
      }
    }
  }
  return result;
}

// ─── Fine-Channel Detection ───────────────────────────────────────────────────

/** Returns true if this channel key is a "fine" (16-bit high byte) alias and can be skipped. */
function isFineChannel(key: string, templateKey: string | undefined, oflFixture: OflFixture): boolean {
  for (const ch of Object.values(oflFixture.availableChannels ?? {})) {
    if (ch.fineChannelAliases?.includes(key)) return true;
  }
  if (templateKey && oflFixture.templateChannels) {
    for (const ch of Object.values(oflFixture.templateChannels)) {
      if (ch.fineChannelAliases?.includes(templateKey)) return true;
    }
  }
  return false;
}

// ─── Template Channel Resolution ─────────────────────────────────────────────

/**
 * Checks if a channel key like "Red Master" was generated from a template
 * like "Red $pixelKey" (with $pixelKey = "Master").
 * Returns { templateKey, pixelKey } when matched, or null otherwise.
 */
function resolveTemplateChannel(
  channelKey: string,
  oflFixture: OflFixture,
): { templateKey: string; pixelKey: string } | null {
  if (!oflFixture.templateChannels) return null;
  for (const templateKey of Object.keys(oflFixture.templateChannels)) {
    if (!templateKey.includes('$pixelKey')) continue;
    const [prefix, suffix] = templateKey.split('$pixelKey');
    if (
      channelKey.startsWith(prefix ?? '') &&
      channelKey.endsWith(suffix ?? '') &&
      channelKey.length > (prefix?.length ?? 0) + (suffix?.length ?? 0)
    ) {
      const pixelKey = channelKey.slice(
        prefix?.length ?? 0,
        suffix ? channelKey.length - suffix.length : undefined,
      );
      if (pixelKey) return { templateKey, pixelKey };
    }
  }
  return null;
}

// ─── Public Factory ───────────────────────────────────────────────────────────

/**
 * Creates a pixelmapper `Fixture` from an OFL fixture JSON definition.
 *
 * - Only 8-bit coarse channels are included (fine aliases are skipped).
 * - Matrix `matrixChannels` inserts are fully expanded respecting `repeatFor`.
 * - Beams are generated from the physical pixel layout.
 */
export function createFixtureFromOfl(
  oflFixture: OflFixture,
  modeIndex: number = 0,
  fixtureId?: string | number,
  manufacturer?: string,
): Fixture {
  const mode = oflFixture.modes[modeIndex] ?? oflFixture.modes[0];
  if (!mode) throw new Error(`OFL fixture "${oflFixture.name}" has no modes defined.`);

  // ── 1. Expand mode channels (including matrix inserts) ───────────────────
  type ExpandedKey = { key: string; templateKey?: string; beamId?: string };
  const expandedKeys: ExpandedKey[] = [];

  for (const item of mode.channels) {
    if (!item) continue;

    if (typeof item === 'string') {
      // Check if this key is a pre-instantiated template channel (e.g. "Red Master" → "Red $pixelKey")
      const tmpl = resolveTemplateChannel(item, oflFixture);
      if (tmpl) {
        // If the pixelKey is a named pixel GROUP (e.g. "Master"), the channel controls
        // ALL beams — set beamId=undefined so resolveColor() sees it as a global channel.
        const isGroup = oflFixture.matrix?.pixelGroups
          ? tmpl.pixelKey in oflFixture.matrix.pixelGroups
          : false;
        expandedKeys.push({
          key: item,
          templateKey: tmpl.templateKey,
          beamId: isGroup ? undefined : tmpl.pixelKey,
        });
      } else {
        expandedKeys.push({ key: item });
      }
      continue;
    }

    if (item.insert !== 'matrixChannels' || !oflFixture.matrix) continue;

    const keys = getOrderedPixelKeys(oflFixture.matrix, item.repeatFor);
    const isGroup = item.repeatFor === 'eachPixelGroup' || Array.isArray(item.repeatFor);

    if (item.channelOrder === 'perPixel') {
      for (const pixelKey of keys) {
        for (const template of item.templateChannels) {
          if (!template) continue; // null = DMX gap, skip
          expandedKeys.push({
            key: template.replace('$pixelKey', pixelKey),
            templateKey: template,
            beamId: pixelKey,
          });
        }
      }
    } else {
      // perChannel: all pixels for one template, then move to next template
      for (const template of item.templateChannels) {
        if (!template) continue; // null = DMX gap, skip
        for (const pixelKey of keys) {
          expandedKeys.push({
            key: template.replace('$pixelKey', pixelKey),
            templateKey: template,
            beamId: pixelKey,
          });
        }
      }
    }
  }

  // ── 2. Build Channel objects ──────────────────────────────────────────────
  const channels: Channel[] = [];

  for (let dmxIndex = 0; dmxIndex < expandedKeys.length; dmxIndex++) {
    const item = expandedKeys[dmxIndex]!;
    if (isFineChannel(item.key, item.templateKey, oflFixture)) continue;

    // Lookup order:
    // 1. availableChannels by exact key (normal channels)
    // 2. templateChannels by templateKey (matrix-expanded channels like "Red 1")
    const channelDef =
      (oflFixture.availableChannels ?? {})[item.key] ??
      (item.templateKey ? oflFixture.templateChannels?.[item.templateKey] : undefined);

    if (!channelDef) continue;

    // Use the templateKey for capability-map resolution so color/type is derived
    // from the template name (e.g. "Red $pixelKey") not the expanded key ("Red Master").
    const resolveKey = item.templateKey ?? item.key;
    const mapped = resolveOflChannel(channelDef, resolveKey);
    const caps = channelDef.capabilities ?? (channelDef.capability ? [channelDef.capability] : []);

    let resolution: 1 | 2 | 3 = 1;
    const fineAddressOffsets: number[] = [];
    if (channelDef.dmxValueResolution === '16bit' || channelDef.dmxValueResolution === '24bit') {
      const aliases = channelDef.fineChannelAliases ?? [];
      for (const alias of aliases) {
        // If this is a matrix channel, the alias in the definition (e.g. "Red fine")
        // might need to be resolved against the pixelKey. OFL matrix channels typically
        // just append " fine" or provide a template. For simplicity, we search the expanded
        // keys for one whose templateKey matches the alias OR whose key exactly matches the alias for this beam.
        const fineIdx = expandedKeys.findIndex(e => 
          (e.key === alias || e.templateKey === alias) && e.beamId === item.beamId
        );
        if (fineIdx !== -1) {
          fineAddressOffsets.push(fineIdx);
        }
      }
      resolution = (1 + fineAddressOffsets.length) as 1 | 2 | 3;
    }

    channels.push({
      type: mapped.type,
      addressOffset: dmxIndex,
      resolution,
      fineAddressOffsets: fineAddressOffsets.length > 0 ? fineAddressOffsets : undefined,
      role: mapped.role,
      colorValue: mapped.colorValue,
      defaultValue: mapped.defaultValue,
      oflChannelName: item.key,
      beamId: item.beamId,
      oflCapabilities: caps,
      oflWheels: oflFixture.wheels ?? {},
      chaserConfig: reactive({
        stepValues: [mapped.defaultValue],
        stepsCount: 1,
        activeEditStep: 0,
        isPlaying: false,
        stepDuration: { mode: 'time', timeMs: 1000, beatValue: 1, beatOffset: 0 },
        fadeDuration: { mode: 'time', timeMs: 0, beatValue: 0, beatOffset: 0 },
      }),
    });
  }

  // ── 3. Assemble Fixture ───────────────────────────────────────────────────
  const fixture = new Fixture(fixtureId ?? crypto.randomUUID(), channels);
  fixture.name = oflFixture.name;
  fixture.manufacturer = manufacturer ?? '';
  fixture.fixtureType = oflFixture.name;

  // Physical dimensions (w represents millimeters).
  // 1 meter = 250 pixels in our scaled world. Base fixture width = 36px.
  // Formula: fixtureSize.x = (w / 1000 * 250) / 36 = w / 144
  const physical = mode.physical ?? oflFixture.physical;
  if (physical?.dimensions) {
    const [w] = physical.dimensions;
    fixture.fixtureSize = { x: w / 144, y: w / 144 }; // default: square (y will be refined below)
  }

  // ── 4. Build Beams from pixel layout ─────────────────────────────────────
  const matrix = oflFixture.matrix;
  if (matrix) {
    let xCount = 1, yCount = 1, zCount = 1;
    if (matrix.pixelCount) {
      [xCount, yCount, zCount] = matrix.pixelCount;
    } else if (matrix.pixelKeys) {
      zCount = matrix.pixelKeys.length;
      yCount = matrix.pixelKeys[0]?.length || 1;
      xCount = matrix.pixelKeys[0]?.[0]?.length || 1;
    }

    // Override fixtureSize to match the grid's visual aspect ratio.
    // Physical depth is irrelevant for the on-canvas representation: what
    // matters is how many pixels are in each dimension.
    if (xCount > 0 && yCount > 0) {
      const sizeX = fixture.fixtureSize.x;
      fixture.fixtureSize = { x: sizeX, y: sizeX * (yCount / xCount) };
    }

    if (xCount > 1 || yCount > 1 || zCount > 1) {
      const beams: Beam[] = [];
      let idx = 0;
      // Always iterate in Z→Y→X so beam positions match pixel layout
      const allKeys = collectPixelKeysZYX(matrix);
      for (let z = 0; z < zCount; z++) {
        for (let y = 0; y < yCount; y++) {
          for (let x = 0; x < xCount; x++) {
            const pixelId = allKeys[idx++];
            if (!pixelId) continue;
            // Distribute so outer beams are closer to the edge.
            // A spread factor of `(count - 1)/count` puts the centers such that
            // the distance from outer center to the edge is exactly 0.5 * spacing.
            const spreadX = xCount > 1 ? (xCount - 1) / xCount : 0;
            const spreadY = yCount > 1 ? (yCount - 1) / yCount : 0;

            const localX = xCount > 1 ? (x / (xCount - 1) - 0.5) * spreadX : 0;
            const localY = yCount > 1 ? (y / (yCount - 1) - 0.5) * spreadY : 0;

            beams.push(new Beam(pixelId, localX, localY));
          }
        }
      }
      if (beams.length > 0) fixture.beams = beams;
    }
  }

  // Always guarantee at least one beam
  if (!fixture.beams || fixture.beams.length === 0) {
    fixture.beams = [new Beam('beam-0', 0, 0)];
  }

  // OFL metadata
  const ext = fixture as Fixture & { oflCategories: string[]; oflShortName: string };
  ext.oflCategories = oflFixture.categories;
  ext.oflShortName = oflFixture.shortName ?? oflFixture.name;
  fixture.definition = oflFixture;

  return fixture;
}
