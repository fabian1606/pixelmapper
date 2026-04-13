/**
 * Bidirectional mapping between OFL fixture JSON and the Custom Fixture Editor's
 * internal draft types (ChannelDraft, ModeDraft, WheelDraft).
 *
 * # Channel classification
 *
 * | OFL field          | Editor concept     | perHead |
 * |--------------------|--------------------|---------|
 * | availableChannels  | Global channel     | false   |
 * | templateChannels   | Per-pixel channel  | true    |
 *
 * A channel is "per-pixel" when it uses the `$pixelKey` placeholder in its OFL
 * template key (e.g. "Red $pixelKey"). In the editor it is shown without the
 * placeholder (e.g. "Red") and is marked perHead:true in mode entries.
 *
 * # Mode channel entries
 *
 * | OFL type               | Editor type     | perHead |
 * |------------------------|-----------------|---------|
 * | string (channel name)  | global ref      | false   |
 * | OflMatrixChannelInsert | per-pixel group | true    |
 *
 * Consecutive perHead:true ModeEntries are grouped back into a single
 * OflMatrixChannelInsert when building the OFL output.
 */

import type {
  OflFixture,
  OflChannel,
  OflMode,
  OflCapability,
  OflWheel,
  OflMatrixChannelInsert,
} from '~/utils/ofl/types';
import type {
  CustomFixtureFormState,
  ChannelDraft,
  ModeDraft,
  WheelDraft,
  CapabilityRange,
  OflCategory,
} from '~/utils/engine/custom-fixture-types';
import { resolveOflChannel } from '~/utils/ofl/capability-map';

// ─── Shared helper ────────────────────────────────────────────────────────────

/**
 * Converts OFL capability objects into CapabilityRange[] used by the editor.
 * Handles both single `capability` and `capabilities` arrays.
 */
function parseOflCapabilities(ch: OflChannel): CapabilityRange[] {
  const raw: any[] = ch.capabilities
    ? (ch.capabilities as any[])
    : ch.capability
      ? [ch.capability]
      : [];

  return raw.map((c) => {
    const copy: any = { ...c };
    copy.rangeId = crypto.randomUUID();
    if (c.dmxRange) {
      copy.dmxMin = c.dmxRange[0];
      copy.dmxMax = c.dmxRange[1];
      delete copy.dmxRange;
    } else {
      copy.dmxMin = 0;
      copy.dmxMax = 255;
    }
    // OFL uses "comment"; editor uses "label"
    copy.label = c.comment || '';
    if (!copy.type) copy.type = 'GENERIC';
    return copy as CapabilityRange;
  });
}

/**
 * Clamps OFL's `dmxValueResolution` to the subset the editor supports.
 * '24bit' is degraded to '16bit' — this is a display/editing limitation only.
 */
function clampResolution(res: string | undefined): '8bit' | '16bit' {
  if (res === '24bit') return '16bit';
  if (res === '16bit') return '16bit';
  return '8bit';
}

// ─── buildOflFixture ─────────────────────────────────────────────────────────

/**
 * Converts editor draft state into an OFL-compatible fixture JSON object.
 *
 * Channels that appear as `perHead:true` in any mode are saved as
 * `templateChannels["<name> $pixelKey"]`. All others go into `availableChannels`.
 * Consecutive perHead mode entries are folded into an `OflMatrixChannelInsert`.
 */
export function buildOflFixture(
  state: CustomFixtureFormState,
  channels: ChannelDraft[],
  modes: ModeDraft[],
  wheels: WheelDraft[],
  category: OflCategory,
  pixelCols: number,
  pixelRows: number,
  customSvgData?: string | null,
  headToElementMap: Record<string, string> = {},
  headCount = 1,
  useCustomSvg = false,
): OflFixture {
  // ── Determine which channels are per-pixel ────────────────────────────────
  // A channel is per-pixel when it appears as perHead:true in at least one mode.
  const perHeadChannelIds = new Set<string>();
  for (const m of modes) {
    for (const e of m.entries) {
      if (e.perHead) perHeadChannelIds.add(e.channelId);
    }
  }

  // ── Build availableChannels / templateChannels ────────────────────────────
  const availableChannels: Record<string, OflChannel> = {};
  const templateChannelMap: Record<string, OflChannel> = {};

  for (const ch of channels) {
    // Convert CapabilityRange[] back to OflCapability[]
    const caps: OflCapability[] = ch.capabilities.map((r) => {
      const cap: any = { ...r };
      delete cap.rangeId;
      if (cap.label) {
        cap.comment = cap.label;
        delete cap.label;
      }
      cap.dmxRange = [cap.dmxMin, cap.dmxMax];
      delete cap.dmxMin;
      delete cap.dmxMax;
      return cap as OflCapability;
    });

    const oflCh: OflChannel = {
      name: ch.name,
      defaultValue: ch.defaultValue,
      dmxValueResolution: ch.resolution,
      capabilities: caps.length > 0 ? caps : undefined,
    };

    if (perHeadChannelIds.has(ch.id)) {
      // Per-pixel: stored as template channel with $pixelKey placeholder
      templateChannelMap[`${ch.name} $pixelKey`] = oflCh;
    } else {
      availableChannels[ch.name] = oflCh;
    }
  }

  // ── Build modes ───────────────────────────────────────────────────────────
  const oflModes: OflMode[] = modes.map((m) => {
    const modeChannels: (string | null | OflMatrixChannelInsert)[] = [];
    let i = 0;

    while (i < m.entries.length) {
      const e = m.entries[i]!;

      if (!e.perHead) {
        // Global channel → plain string reference
        const ch = channels.find((c) => c.id === e.channelId);
        modeChannels.push(ch ? ch.name : null);
        i++;
      } else {
        // Consecutive perHead entries → single OflMatrixChannelInsert
        const templateNames: (string | null)[] = [];
        const order = e.order; // use order from first entry in group
        while (i < m.entries.length && m.entries[i]!.perHead) {
          const ch = channels.find((c) => c.id === m.entries[i]!.channelId);
          templateNames.push(ch ? `${ch.name} $pixelKey` : null);
          i++;
        }
        if (templateNames.length > 0) {
          modeChannels.push({
            insert: 'matrixChannels' as const,
            repeatFor: 'eachPixelABC',
            channelOrder: order,
            templateChannels: templateNames,
          });
        }
      }
    }

    return { name: m.name, channels: modeChannels };
  });

  // ── Build wheels ──────────────────────────────────────────────────────────
  const oflWheels: Record<string, OflWheel> = {};
  for (const w of wheels) {
    oflWheels[w.name] = {
      slots: w.slots.map((s) => ({
        type: s.type as any,
        name: s.name,
        colors: s.colors.length > 0 ? s.colors : undefined,
      })),
    };
  }

  const effectiveHeadCount = Math.max(1, headCount);
  const matrixMode = category === 'Matrix';
  const barMode = category === 'Pixel Bar';
  // Persist pixel grid dimensions so they survive round-trip editing.
  // OFL matrix.pixelCount is [cols, rows, layers] — we always use 1 layer.
  const matrixCols = matrixMode
    ? Math.max(1, Math.min(effectiveHeadCount, pixelCols || effectiveHeadCount))
    : barMode
      ? effectiveHeadCount
      : Math.max(1, Math.ceil(Math.sqrt(effectiveHeadCount)));
  const matrixRows = matrixMode
    ? Math.max(1, Math.ceil(effectiveHeadCount / matrixCols))
    : barMode
      ? 1
      : Math.max(1, Math.ceil(effectiveHeadCount / matrixCols));
  const hasMatrix = true;
  const hasTemplates = Object.keys(templateChannelMap).length > 0;
  const customHeadKeys = Array.from({ length: effectiveHeadCount }, (_, i) => `head-${i + 1}`);
  const filteredHeadToElementMap = customHeadKeys.reduce<Record<string, string>>((acc, key) => {
        const elementId = headToElementMap[key];
        if (elementId) acc[key] = elementId;
        return acc;
      }, {});
  const pixelKeyRows: (string | null)[][] = [];
  for (let row = 0; row < matrixRows; row++) {
    const rowKeys: (string | null)[] = [];
    for (let col = 0; col < matrixCols; col++) {
      const idx = row * matrixCols + col;
      rowKeys.push(customHeadKeys[idx] ?? null);
    }
    pixelKeyRows.push(rowKeys);
  }

  return {
    $schema:
      'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/schemas/fixture.json',
    name: state.fixtureName,
    shortName: state.shortName || undefined,
    categories: [category],
    meta: {
      authors: ['Pixelmapper Custom Fixture Editor'],
      createDate: new Date().toISOString().split('T')[0]!,
      lastModifyDate: new Date().toISOString().split('T')[0]!,
    },
    comment: state.comment || undefined,
    physical: {
      dimensions: [state.fixtureWidth, state.fixtureHeight, state.fixtureDepth],
      weight: state.weight || undefined,
      power: state.power || undefined,
      DMXconnector: state.dmxConnector ? (state.dmxConnector as any) : undefined,
      bulb:
        state.bulbType || state.colorTemperature
          ? {
              type: state.bulbType || undefined,
              colorTemperature: state.colorTemperature || undefined,
            }
          : undefined,
      lens:
        state.beamAngleMin || state.beamAngleMax
          ? { degreesMinMax: [state.beamAngleMin, state.beamAngleMax] }
          : undefined,
    },
    // Always provide availableChannels (even if empty) so fixture-factory.ts
    // can iterate over it without null-checks.
    availableChannels,
    templateChannels: hasTemplates ? templateChannelMap : undefined,
    modes: oflModes,
    wheels: Object.keys(oflWheels).length > 0 ? oflWheels : undefined,
    // Store pixel grid so the editor can restore it on re-open.
    matrix:
      hasMatrix || hasTemplates
        ? {
            pixelCount: [matrixCols, matrixRows, 1],
            pixelKeys: [pixelKeyRows],
          }
        : undefined,
    pixelmapper: {
      headLayout: {
        headCount: effectiveHeadCount,
        gridCols: matrixCols,
        gridRows: matrixRows,
      },
      customSvg: useCustomSvg && customSvgData
        ? {
            enabled: true,
            data: customSvgData,
            headToElement: filteredHeadToElementMap,
            headCount: effectiveHeadCount,
          }
        : undefined,
    },
  };
}

// ─── initFromOflFixture ──────────────────────────────────────────────────────

/**
 * Checks if a channel key like "Red Master" was generated from a template
 * like "Red $pixelKey". Returns the matching template key if found.
 */
function resolveTemplateKey(channelKey: string, ofl: OflFixture): string | null {
  if (!ofl.templateChannels) return null;
  for (const templateKey of Object.keys(ofl.templateChannels)) {
    if (!templateKey.includes('$pixelKey')) continue;
    const [prefix, suffix] = templateKey.split('$pixelKey');
    if (
      channelKey.startsWith(prefix || '') &&
      channelKey.endsWith(suffix || '') &&
      channelKey.length > (prefix?.length || 0) + (suffix?.length || 0)
    ) {
      return templateKey;
    }
  }
  return null;
}

/**
 * Initialises the Custom Fixture Editor from an existing OFL fixture JSON.
 *
 * Reads both `availableChannels` (global) and `templateChannels` (per-pixel).
 * Converts `OflMatrixChannelInsert` mode entries into `perHead:true` ModeEntries
 * so the editor can display them correctly.
 */
export function initFromOflFixture(ofl: OflFixture) {
  // ── Form state ────────────────────────────────────────────────────────────
  const state: CustomFixtureFormState = {
    fixtureName: ofl.name,
    shortName: ofl.shortName || '',
    manufacturer: '',
    comment: ofl.comment || '',
    fixtureWidth: ofl.physical?.dimensions?.[0] || 300,
    fixtureHeight: ofl.physical?.dimensions?.[1] || 300,
    fixtureDepth: ofl.physical?.dimensions?.[2] || 300,
    weight: ofl.physical?.weight || 0,
    power: ofl.physical?.power || 0,
    dmxConnector: (ofl.physical?.DMXconnector || '') as any,
    bulbType: ofl.physical?.bulb?.type || '',
    colorTemperature: ofl.physical?.bulb?.colorTemperature || 0,
    beamAngleMin: ofl.physical?.lens?.degreesMinMax?.[0] || 0,
    beamAngleMax: ofl.physical?.lens?.degreesMinMax?.[1] || 0,
  };

  const rawCategory = ofl.categories?.[0];
  const category = (rawCategory === 'Custom SVG' ? 'Other' : rawCategory) as OflCategory || 'Other';

  // ── Channels ──────────────────────────────────────────────────────────────
  const channels: ChannelDraft[] = [];

  // Maps OFL channel key / template key → ChannelDraft.id for mode matching.
  const channelIdByKey = new Map<string, string>();

  // 1. Global channels (availableChannels)
  if (ofl.availableChannels) {
    for (const [key, ch] of Object.entries(ofl.availableChannels)) {
      const id = crypto.randomUUID();
      channelIdByKey.set(key, id);
      channels.push({
        id,
        name: ch.name || key,
        capabilityType: resolveOflChannel(ch, key).type,
        resolution: clampResolution(ch.dmxValueResolution),
        defaultValue: (ch.defaultValue as number) || 0,
        capabilities: parseOflCapabilities(ch),
      });
    }
  }

  // 2. Per-pixel template channels (templateChannels)
  // Template key e.g. "Red $pixelKey" → display name "Red"
  if (ofl.templateChannels) {
    for (const [templateKey, ch] of Object.entries(ofl.templateChannels)) {
      // Skip fine-channel aliases — the coarse channel already covers them.
      const isFineAlias = Object.values(ofl.templateChannels ?? {}).some((other) =>
        other.fineChannelAliases?.includes(templateKey),
      );
      if (isFineAlias) continue;

      const id = crypto.randomUUID();
      channelIdByKey.set(templateKey, id);

      // Strip "$pixelKey" placeholder (with optional surrounding spaces)
      const displayName = templateKey.replace(/\s*\$pixelKey\s*/g, '').trim() || templateKey;

      channels.push({
        id,
        name: displayName,
        capabilityType: resolveOflChannel(ch, templateKey).type,
        resolution: clampResolution(ch.dmxValueResolution),
        defaultValue: (ch.defaultValue as number) || 0,
        capabilities: parseOflCapabilities(ch),
      });
    }
  }

  // ── Modes ─────────────────────────────────────────────────────────────────
  const modes: ModeDraft[] = (ofl.modes || []).map((m, i) => {
    const entries: ModeDraft['entries'] = [];

    for (const item of m.channels || []) {
      if (!item) continue;

      if (typeof item === 'string') {
        // Plain global channel reference
        let channelId = channelIdByKey.get(item);

        // If not found directly, check if it's an instantiated template (e.g., "Red Master")
        if (!channelId) {
          const tplKey = resolveTemplateKey(item, ofl);
          const chDef = tplKey ? ofl.templateChannels?.[tplKey] : undefined;
          if (chDef) {
            // Create a new global ChannelDraft for this specific instantiated template
            channelId = crypto.randomUUID();
            channelIdByKey.set(item, channelId);
            channels.push({
              id: channelId,
              name: item, // e.g. "Red Master"
              capabilityType: resolveOflChannel(chDef, tplKey || undefined).type,
              resolution: clampResolution(chDef.dmxValueResolution),
              defaultValue: (chDef.defaultValue as number) || 0,
              capabilities: parseOflCapabilities(chDef),
            });
          }
        }

        if (channelId) {
          entries.push({
            entryId: crypto.randomUUID(),
            channelId,
            perHead: false,
            order: 'perPixel' as const,
          });
        }
      } else if ((item as any).insert === 'matrixChannels') {
        // Matrix channel insert → one perHead:true entry per template channel
        const insert = item as OflMatrixChannelInsert;
        for (const tplName of insert.templateChannels || []) {
          if (!tplName) continue;
          const channelId = channelIdByKey.get(tplName) || '';
          if (channelId) {
            entries.push({
              entryId: crypto.randomUUID(),
              channelId,
              perHead: true,
              order: insert.channelOrder as 'perPixel' | 'perChannel',
            });
          }
        }
      }
    }

    return {
      id: `mode-${crypto.randomUUID()}`,
      name: m.name || `Mode ${i + 1}`,
      entries,
    };
  });

  // ── Wheels ────────────────────────────────────────────────────────────────
  const wheels: WheelDraft[] = [];
  if (ofl.wheels) {
    for (const [name, w] of Object.entries(ofl.wheels)) {
      const channelId =
        channels.find(
          (c) =>
            c.name === name ||
            c.capabilityType === 'COLOR_WHEEL' ||
            c.capabilityType === 'GOBO_WHEEL',
        )?.id || crypto.randomUUID();

      wheels.push({
        wheelId: crypto.randomUUID(),
        channelId,
        name,
        direction: w.direction as any,
        slots: (w.slots || []).map((s) => ({
          slotId: crypto.randomUUID(),
          type: s.type as any,
          name: s.name || '',
          colors: s.colors || [],
        })),
      });
    }
  }

  // ── Pixel grid ────────────────────────────────────────────────────────────
  // Restore from OFL matrix.pixelCount ([cols, rows, layers]).
  // Falls back to 1×1 for single-head fixtures that have no matrix block.
  const pixelCols = ofl.matrix?.pixelCount?.[0] ?? 1;
  const pixelRows = ofl.matrix?.pixelCount?.[1] ?? 1;
  const headCount = Math.max(
    1,
    ofl.pixelmapper?.headLayout?.headCount
      ?? ofl.pixelmapper?.customSvg?.headCount
      ?? ((pixelCols || 1) * (pixelRows || 1)),
  );
  const customSvgData = ofl.pixelmapper?.customSvg?.data ?? null;
  const useCustomSvg = Boolean(ofl.pixelmapper?.customSvg?.enabled && customSvgData);
  const headToElementMap = ofl.pixelmapper?.customSvg?.headToElement ?? {};

  return {
    state,
    channels,
    modes,
    wheels,
    category,
    pixelCols,
    pixelRows,
    headCount,
    useCustomSvg,
    customSvgData,
    headToElementMap,
  };
}
