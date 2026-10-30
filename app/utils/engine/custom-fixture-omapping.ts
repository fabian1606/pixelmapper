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
 *
 * A run of plain strings naming template instances ("Red 1", "Green 1", …,
 * "Blue 4") that covers every pixel in a regular order is folded into a
 * per-head group on load as well (custom-fixture-template-runs.ts), so
 * imported definitions keep their templateChannels/matrix structure on save.
 *
 * # RDM identification (plan M4.7)
 *
 * | OFL field                       | Form field                          |
 * |---------------------------------|-------------------------------------|
 * | pixelmapper.rdmManufacturerId   | state.rdmManufacturerId             |
 * | rdm.modelId / rdm.softwareVersion | state.rdmModelId / rdmSoftwareVersion |
 * | modes[i].rdmPersonalityIndex    | ModeDraft.rdmPersonalityIndex       |
 *
 * Unset fields are omitted from the OFL output (no `undefined` keys).
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
import type { ChannelType } from '~/utils/engine/types';
import { CHANNEL_CAPABILITY_TYPES } from '~/utils/engine/custom-fixture-channel-types';
import {
  collectPixelKeysRowMajor,
  foldTemplateRun,
  resolveTemplateRef,
  type TemplateRef,
} from '~/utils/engine/custom-fixture-template-runs';

// Set of all editor ChannelType enum values — used for idempotency guard in oflCapToEditorType
const EDITOR_TYPE_SET = new Set<string>(CHANNEL_CAPABILITY_TYPES);

// ─── Editor ChannelType → OFL capability-type mapping ────────────────────────
// The editor uses an internal enum (RED, GREEN, DIMMER, …). OFL capability
// types are different ('ColorIntensity', 'Intensity', …). When emitting OFL
// JSON we must translate, otherwise downstream channel classification
// (capability-map.ts) falls back to CUSTOM.
type OflCapShape = { type: string; color?: string };
function editorTypeToOflCap(t: ChannelType): OflCapShape {
  switch (t) {
    case 'RED':        return { type: 'ColorIntensity', color: 'Red' };
    case 'GREEN':      return { type: 'ColorIntensity', color: 'Green' };
    case 'BLUE':       return { type: 'ColorIntensity', color: 'Blue' };
    case 'WHITE':      return { type: 'ColorIntensity', color: 'White' };
    case 'WARM_WHITE': return { type: 'ColorIntensity', color: 'Warm White' };
    case 'COOL_WHITE': return { type: 'ColorIntensity', color: 'Cold White' };
    case 'AMBER':      return { type: 'ColorIntensity', color: 'Amber' };
    case 'UV':         return { type: 'ColorIntensity', color: 'UV' };
    case 'CYAN':       return { type: 'ColorIntensity', color: 'Cyan' };
    case 'MAGENTA':    return { type: 'ColorIntensity', color: 'Magenta' };
    case 'YELLOW':     return { type: 'ColorIntensity', color: 'Yellow' };
    case 'LIME':       return { type: 'ColorIntensity', color: 'Lime' };
    case 'INDIGO':     return { type: 'ColorIntensity', color: 'Indigo' };
    case 'DIMMER':            return { type: 'Intensity' };
    case 'COLOR_PRESET':      return { type: 'ColorPreset' };
    case 'COLOR_TEMPERATURE': return { type: 'ColorTemperature' };
    case 'COLOR_WHEEL':       return { type: 'WheelSlot' };
    case 'GOBO_WHEEL':        return { type: 'WheelSlot' };
    case 'GOBO_SPIN':         return { type: 'WheelRotation' };
    case 'PAN':               return { type: 'Pan' };
    case 'TILT':              return { type: 'Tilt' };
    case 'PAN_CONTINUOUS':    return { type: 'PanContinuous' };
    case 'TILT_CONTINUOUS':   return { type: 'TiltContinuous' };
    case 'PANTILT_SPEED':     return { type: 'PanTiltSpeed' };
    case 'STROBE':            return { type: 'ShutterStrobe' };
    case 'STROBE_SPEED':      return { type: 'StrobeSpeed' };
    case 'STROBE_DURATION':   return { type: 'StrobeDuration' };
    case 'ZOOM':              return { type: 'Zoom' };
    case 'FOCUS':             return { type: 'Focus' };
    case 'IRIS':              return { type: 'Iris' };
    case 'IRIS_EFFECT':       return { type: 'IrisEffect' };
    case 'FROST':             return { type: 'Frost' };
    case 'FROST_EFFECT':      return { type: 'FrostEffect' };
    case 'BEAM_ANGLE':        return { type: 'BeamAngle' };
    case 'BEAM_POSITION':     return { type: 'BeamPosition' };
    case 'PRISM':             return { type: 'Prism' };
    case 'PRISM_ROTATION':    return { type: 'PrismRotation' };
    case 'BLADE':             return { type: 'BladeInsertion' };
    case 'BLADE_ROTATION':    return { type: 'BladeRotation' };
    case 'BLADE_SYSTEM_ROTATION': return { type: 'BladeSystemRotation' };
    case 'EFFECT':            return { type: 'Effect' };
    case 'EFFECT_SPEED':      return { type: 'EffectSpeed' };
    case 'EFFECT_DURATION':   return { type: 'EffectDuration' };
    case 'EFFECT_PARAMETER':  return { type: 'EffectParameter' };
    case 'SOUND_SENSITIVITY': return { type: 'SoundSensitivity' };
    case 'ROTATION':          return { type: 'Rotation' };
    case 'SPEED':             return { type: 'Speed' };
    case 'TIME':              return { type: 'Time' };
    case 'FOG':               return { type: 'Fog' };
    case 'FOG_OUTPUT':        return { type: 'FogOutput' };
    case 'FOG_TYPE':          return { type: 'FogType' };
    case 'MAINTENANCE':       return { type: 'Maintenance' };
    case 'NO_FUNCTION':       return { type: 'NoFunction' };
    case 'GENERIC':
    case 'CUSTOM':
    default:                  return { type: 'Generic' };
  }
}

// ─── OFL capability-type → Editor ChannelType mapping (reverse of editorTypeToOflCap) ──────────

/**
 * Translates an OFL capability {type, color?} back into the editor's ChannelType enum.
 * Idempotent: if oflType is already an editor enum (e.g. already translated), it passes through.
 * This prevents double-translation on round-trips.
 */
function oflCapToEditorType(oflType: string, color?: string): ChannelType {
  // Already an editor enum — pass through unchanged
  if (EDITOR_TYPE_SET.has(oflType)) return oflType as ChannelType;

  switch (oflType) {
    case 'ColorIntensity': {
      const colorMap: Record<string, ChannelType> = {
        'Red': 'RED', 'Green': 'GREEN', 'Blue': 'BLUE',
        'White': 'WHITE', 'Warm White': 'WARM_WHITE', 'Cold White': 'COOL_WHITE',
        'Amber': 'AMBER', 'UV': 'UV', 'Cyan': 'CYAN', 'Magenta': 'MAGENTA',
        'Yellow': 'YELLOW', 'Lime': 'LIME', 'Indigo': 'INDIGO',
      };
      return (color && colorMap[color]) ? colorMap[color]! : 'CUSTOM';
    }
    case 'Intensity':           return 'DIMMER';
    case 'ColorPreset':         return 'COLOR_PRESET';
    case 'ColorTemperature':    return 'COLOR_TEMPERATURE';
    case 'WheelSlot':           return 'COLOR_WHEEL';
    case 'WheelRotation':
    case 'WheelSlotRotation':   return 'GOBO_SPIN';
    case 'Pan':                 return 'PAN';
    case 'PanContinuous':       return 'PAN_CONTINUOUS';
    case 'Tilt':                return 'TILT';
    case 'TiltContinuous':      return 'TILT_CONTINUOUS';
    case 'PanTiltSpeed':        return 'PANTILT_SPEED';
    case 'ShutterStrobe':       return 'STROBE';
    case 'StrobeSpeed':         return 'STROBE_SPEED';
    case 'StrobeDuration':      return 'STROBE_DURATION';
    case 'Zoom':                return 'ZOOM';
    case 'Focus':               return 'FOCUS';
    case 'Iris':                return 'IRIS';
    case 'IrisEffect':          return 'IRIS_EFFECT';
    case 'Frost':               return 'FROST';
    case 'FrostEffect':         return 'FROST_EFFECT';
    case 'BeamAngle':           return 'BEAM_ANGLE';
    case 'BeamPosition':        return 'BEAM_POSITION';
    case 'Prism':               return 'PRISM';
    case 'PrismRotation':       return 'PRISM_ROTATION';
    case 'BladeInsertion':      return 'BLADE';
    case 'BladeRotation':       return 'BLADE_ROTATION';
    case 'BladeSystemRotation': return 'BLADE_SYSTEM_ROTATION';
    case 'Effect':              return 'EFFECT';
    case 'EffectSpeed':         return 'EFFECT_SPEED';
    case 'EffectDuration':      return 'EFFECT_DURATION';
    case 'EffectParameter':     return 'EFFECT_PARAMETER';
    case 'SoundSensitivity':    return 'SOUND_SENSITIVITY';
    case 'Rotation':            return 'ROTATION';
    case 'Speed':               return 'SPEED';
    case 'Time':                return 'TIME';
    case 'Fog':                 return 'FOG';
    case 'FogOutput':           return 'FOG_OUTPUT';
    case 'FogType':             return 'FOG_TYPE';
    case 'Maintenance':         return 'MAINTENANCE';
    case 'NoFunction':          return 'NO_FUNCTION';
    case 'Generic':             return 'GENERIC';
    default:                    return 'CUSTOM';
  }
}

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
    // Always translate to editor ChannelType enum. OFL stores 'ColorIntensity',
    // 'Intensity', etc. — the editor expects 'RED', 'DIMMER', etc. Without this
    // translation, buildOflFixture corrupts the type on the next save.
    copy.type = oflCapToEditorType(c.type ?? '', (c as any).color);
    return copy as CapabilityRange;
  });
}

/** True for a valid RDM manufacturer / model ID (16-bit unsigned integer). */
function isRdmId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

/** True for a valid RDM personality index (1-based positive integer). */
function isRdmPersonalityIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
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

// ─── Fine channels (16/24-bit, `fineChannelAliases`) ─────────────────────────
//
// OFL gives a 16/24-bit channel its extra DMX slots by naming them in
// `fineChannelAliases`; modes list those aliases like channels. The editor
// models a '16bit' ChannelDraft as coarse + fine byte in two adjacent
// addresses (see `modeAddressCount`). A loaded channel is therefore either
//  - packed: exactly one alias, and every mode lists it directly after the
//    channel → one '16bit' draft; save writes the alias behind every
//    reference again, or
//  - unpacked: any other layout (fine byte apart from its coarse channel, a
//    mode with the coarse channel only, 24-bit) → one 8-bit draft per DMX slot;
//    the coarse draft remembers its fine drafts, so save restores
//    `fineChannelAliases` without moving any address.

/**
 * Fine-byte bookkeeping the mapping keeps on a ChannelDraft. Not part of the
 * editor schema; the editor's `{ ...channel, ...patch }` updates carry it along.
 */
type FineChannelDraft = ChannelDraft & {
  /** Packed channel: OFL alias of its fine byte and the channel name it was loaded with. */
  fineAliasSource?: { coarseName: string; alias: string };
  /** Unpacked channel: ids of the drafts that are its fine bytes, in byte order. */
  fineChannelIds?: string[];
};

/** Fine alias → key of the (first) channel that declares it. */
function collectFineAliasOwners(defs: Record<string, OflChannel> | undefined): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [key, ch] of Object.entries(defs ?? {})) {
    for (const alias of ch.fineChannelAliases ?? []) {
      if (!owners.has(alias)) owners.set(alias, key);
    }
  }
  return owners;
}

/**
 * Packed channels (coarse key → fine alias): channels with exactly one alias
 * where, in every sequence, the alias directly follows the channel and the
 * channel is directly followed by its alias. `sequences` hold DMX-ordered
 * channel references without gaps (`null` does not take a DMX slot).
 */
function findPackedChannels(
  defs: Record<string, OflChannel> | undefined,
  owners: ReadonlyMap<string, string>,
  sequences: readonly (readonly unknown[])[],
): Map<string, string> {
  const packed = new Map<string, string>();
  for (const [key, ch] of Object.entries(defs ?? {})) {
    const alias = ch.fineChannelAliases?.length === 1 ? ch.fineChannelAliases[0]! : undefined;
    if (alias !== undefined && alias !== key && owners.get(alias) === key) packed.set(key, alias);
  }
  for (const seq of sequences) {
    seq.forEach((ref, i) => {
      if (typeof ref !== 'string') return;
      // Coarse reference without its fine byte right behind it.
      const alias = packed.get(ref);
      if (alias !== undefined && seq[i + 1] !== alias) packed.delete(ref);
      // Fine byte that does not directly follow its coarse channel.
      const owner = owners.get(ref);
      if (owner !== undefined && packed.get(owner) === ref && seq[i - 1] !== owner) packed.delete(owner);
    });
  }
  return packed;
}

/** DMX-ordered references of every mode; matrix inserts stay in as non-matching items. */
function modeSequences(ofl: OflFixture): unknown[][] {
  return (ofl.modes ?? []).map(m => (m.channels ?? []).filter(item => item != null));
}

/** DMX-ordered template references of every matrix insert. */
function insertSequences(ofl: OflFixture): string[][] {
  return (ofl.modes ?? []).flatMap(m => (m.channels ?? [])
    .filter((item): item is OflMatrixChannelInsert =>
      typeof item === 'object' && item !== null && item.insert === 'matrixChannels')
    .map(insert => (insert.templateChannels ?? []).filter((key): key is string => key != null)));
}

/**
 * Editor resolution of a loaded channel. With fine aliases only a packed
 * channel is '16bit' (otherwise its fine bytes are drafts of their own);
 * without aliases the declared resolution is kept.
 */
function draftResolution(def: OflChannel, packed: boolean): '8bit' | '16bit' {
  if (def.fineChannelAliases?.length) return packed ? '16bit' : '8bit';
  return clampResolution(def.dmxValueResolution);
}

/** Editor name of a template channel: "Red $pixelKey" → "Red". */
function templateDisplayName(templateKey: string): string {
  return templateKey.replace(/\s*\$pixelKey\s*/g, '').trim() || templateKey;
}

/** How `buildOflFixture` writes the fine bytes of 16/24-bit channels. */
interface FinePlan {
  /** OFL `fineChannelAliases` per coarse draft id. */
  aliasesById: Map<string, string[]>;
  /** Packed drafts: the alias written directly after each mode reference. */
  impliedById: Map<string, string>;
  /** Drafts written only as a fine alias of their coarse channel, not as a channel. */
  fineDraftIds: Set<string>;
}

/**
 * Plans the fine aliases of a save: links unpacked drafts to the drafts of
 * their fine bytes and names the implicit fine byte of every '16bit' draft
 * (the loaded alias while the channel keeps its name, else "<name> fine").
 * Aliases share the channel namespace, so they never reuse a channel key.
 */
function planFineChannels(
  channels: ChannelDraft[],
  modes: ModeDraft[],
  perHeadChannelIds: ReadonlySet<string>,
): FinePlan {
  const plan: FinePlan = { aliasesById: new Map(), impliedById: new Map(), fineDraftIds: new Set() };
  const byId = new Map(channels.map(c => [c.id, c as FineChannelDraft]));
  const globalUseIds = new Set(modes.flatMap(m => m.entries.filter(e => !e.perHead).map(e => e.channelId)));
  /** OFL key of a channel name in the given namespace. */
  const refName = (name: string, template: boolean) => (template ? `${name} $pixelKey` : name);
  const used = new Set(channels.map(c => refName(c.name, perHeadChannelIds.has(c.id))));

  // ── Unpacked: link the separate fine drafts (8-bit coarse channels only) ──
  for (const ch of byId.values()) {
    if (ch.resolution !== '8bit' || !ch.fineChannelIds?.length || plan.fineDraftIds.has(ch.id)) continue;
    const template = perHeadChannelIds.has(ch.id);
    const fines = ch.fineChannelIds
      .map(id => byId.get(id))
      .filter((f): f is FineChannelDraft => !!f
        && f.id !== ch.id
        && f.resolution === '8bit'
        && !plan.fineDraftIds.has(f.id)
        && !plan.aliasesById.has(f.id)
        // The fine draft must be referenced in the namespace of its coarse channel.
        && !(template ? globalUseIds.has(f.id) : perHeadChannelIds.has(f.id)))
      .slice(0, 2); // OFL resolutions end at 24 bit
    if (fines.length === 0) continue;
    const aliases = fines.map(f => refName(f.name, template));
    plan.aliasesById.set(ch.id, aliases);
    for (const f of fines) plan.fineDraftIds.add(f.id);
    for (const alias of aliases) used.add(alias);
  }

  // ── Packed: name the implicit fine byte of every '16bit' draft ───────────
  for (const ch of byId.values()) {
    if (ch.resolution !== '16bit') continue;
    const template = perHeadChannelIds.has(ch.id);
    const source = ch.fineAliasSource;
    const loaded = source && source.coarseName === ch.name
      && source.alias.includes('$pixelKey') === template ? source.alias : undefined;
    let alias = loaded !== undefined && !used.has(loaded) ? loaded : undefined;
    for (let n = 1; alias === undefined; n++) {
      const candidate = refName(n === 1 ? `${ch.name} fine` : `${ch.name} fine ${n}`, template);
      if (!used.has(candidate)) alias = candidate;
    }
    used.add(alias);
    plan.aliasesById.set(ch.id, [alias]);
    plan.impliedById.set(ch.id, alias);
  }
  return plan;
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
  headPositions: Record<string, { x: number; y: number }> = {},
): OflFixture {
  // ── Determine which channels are per-pixel ────────────────────────────────
  // A channel is per-pixel when it appears as perHead:true in at least one mode.
  const perHeadChannelIds = new Set<string>();
  for (const m of modes) {
    for (const e of m.entries) {
      if (e.perHead) perHeadChannelIds.add(e.channelId);
    }
  }

  // ── Fine bytes of 16/24-bit channels ──────────────────────────────────────
  const fine = planFineChannels(channels, modes, perHeadChannelIds);

  // ── Build availableChannels / templateChannels ────────────────────────────
  const availableChannels: Record<string, OflChannel> = {};
  const templateChannelMap: Record<string, OflChannel> = {};

  for (const ch of channels) {
    // A linked fine draft is written as an alias of its coarse channel only.
    if (fine.fineDraftIds.has(ch.id)) continue;

    // Convert CapabilityRange[] back to OflCapability[]
    // IMPORTANT: translate editor ChannelType (RED/GREEN/…) into proper OFL
    // capability shape ({type:'ColorIntensity', color:'Red'}, …). Without this
    // the downstream resolver falls back to 'CUSTOM' for all custom fixtures.
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
      // Translate the editor's internal type enum to OFL's vocabulary.
      const mapped = editorTypeToOflCap(cap.type as ChannelType);
      cap.type = mapped.type;
      if (mapped.color && !cap.color) cap.color = mapped.color;
      return cap as OflCapability;
    });

    // If no sub-ranges were defined, synthesize a single full-range capability
    // from the channel's capabilityType. Required so the factory can classify
    // the channel (RED/GREEN/DIMMER/…) — without a capability it falls back
    // to heuristic name-matching which fails for names like "Red"/"Green".
    if (caps.length === 0) {
      const mapped = editorTypeToOflCap(ch.capabilityType);
      const synth: any = { type: mapped.type, dmxRange: [0, 255] };
      if (mapped.color) synth.color = mapped.color;
      caps.push(synth as OflCapability);
    }

    // Fine bytes: 16-bit with one alias, 24-bit with two.
    const aliases = fine.aliasesById.get(ch.id);
    const oflCh: OflChannel = {
      name: ch.name,
      ...(aliases ? { fineChannelAliases: aliases } : {}),
      defaultValue: ch.defaultValue,
      dmxValueResolution: aliases ? (aliases.length > 1 ? '24bit' : '16bit') : ch.resolution,
      capabilities: caps,
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
        // A '16bit' draft takes two addresses: its fine byte follows directly.
        const implied = ch ? fine.impliedById.get(ch.id) : undefined;
        if (implied) modeChannels.push(implied);
        i++;
      } else {
        // Consecutive perHead entries → single OflMatrixChannelInsert
        const templateNames: (string | null)[] = [];
        const order = e.order; // use order from first entry in group
        while (i < m.entries.length && m.entries[i]!.perHead) {
          const ch = channels.find((c) => c.id === m.entries[i]!.channelId);
          templateNames.push(ch ? `${ch.name} $pixelKey` : null);
          // Per-pixel fine byte of a '16bit' template channel follows directly.
          const implied = ch ? fine.impliedById.get(ch.id) : undefined;
          if (implied) templateNames.push(implied);
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

    // RDM personality (plan M4.7): only written when set, so an unset field
    // does not leave an `rdmPersonalityIndex: undefined` key behind.
    return {
      name: m.name,
      ...(isRdmPersonalityIndex(m.rdmPersonalityIndex) ? { rdmPersonalityIndex: m.rdmPersonalityIndex } : {}),
      channels: modeChannels,
    };
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
    // RDM model ID (+ preserved software version); omitted when no model ID is set.
    ...(isRdmId(state.rdmModelId)
      ? {
          rdm: {
            modelId: state.rdmModelId,
            ...(state.rdmSoftwareVersion ? { softwareVersion: state.rdmSoftwareVersion } : {}),
          },
        }
      : {}),
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
      // Custom fixtures have no OFL manufacturer entry, so the RDM
      // manufacturer ID lives in the definition; omitted when not set.
      ...(isRdmId(state.rdmManufacturerId) ? { rdmManufacturerId: state.rdmManufacturerId } : {}),
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
            headPositions: Object.keys(headPositions).length > 0 ? headPositions : undefined,
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
    // RDM identification (plan M4.7); `null` / '' = not set.
    rdmManufacturerId: isRdmId(ofl.pixelmapper?.rdmManufacturerId) ? ofl.pixelmapper!.rdmManufacturerId! : null,
    rdmModelId: isRdmId(ofl.rdm?.modelId) ? ofl.rdm!.modelId : null,
    rdmSoftwareVersion: ofl.rdm?.softwareVersion ?? '',
  };

  const rawCategory = ofl.categories?.[0];
  const category = (rawCategory === 'Custom SVG' ? 'Other' : rawCategory) as OflCategory || 'Other';

  // ── Channels ──────────────────────────────────────────────────────────────
  const channels: ChannelDraft[] = [];

  // Maps OFL channel key / template key → ChannelDraft.id for mode matching.
  const channelIdByKey = new Map<string, string>();

  // Fine bytes (16/24-bit): which coarse channels pack their fine byte into
  // one '16bit' draft (see "Fine channels" above). Global channels are
  // referenced by the mode lists, template channels by the matrix inserts.
  const globalAliasOwners = collectFineAliasOwners(ofl.availableChannels);
  const templateAliasOwners = collectFineAliasOwners(ofl.templateChannels);
  const packedGlobal = findPackedChannels(ofl.availableChannels, globalAliasOwners, modeSequences(ofl));
  const packedTemplates = findPackedChannels(ofl.templateChannels, templateAliasOwners, insertSequences(ofl));
  const packedGlobalAliases = new Set(packedGlobal.values());
  const packedTemplateAliases = new Set(packedTemplates.values());

  /**
   * Records the fine bytes of a loaded coarse channel on its draft. Packed:
   * remembers the alias so a save writes the same name. Unpacked: adds one
   * 8-bit draft per alias right after the coarse draft (mode references find
   * it via `channelIdByKey`) and links them.
   */
  function addFineDrafts(
    draft: FineChannelDraft,
    def: OflChannel,
    packedAlias: string | undefined,
    displayName: (alias: string) => string,
  ) {
    const aliases = def.fineChannelAliases ?? [];
    if (aliases.length === 0) return;
    if (packedAlias !== undefined) {
      draft.fineAliasSource = { coarseName: draft.name, alias: packedAlias };
      return;
    }
    draft.fineChannelIds = aliases.map((alias) => {
      const existing = channelIdByKey.get(alias);
      if (existing) return existing;
      const id = crypto.randomUUID();
      channelIdByKey.set(alias, id);
      channels.push({
        id,
        name: displayName(alias),
        capabilityType: 'GENERIC',
        resolution: '8bit',
        defaultValue: 0,
        capabilities: [],
      });
      return id;
    });
  }

  // 1. Global channels (availableChannels)
  if (ofl.availableChannels) {
    for (const [key, ch] of Object.entries(ofl.availableChannels)) {
      // A fine alias that is also listed as a channel comes with its coarse channel.
      const aliasOwner = globalAliasOwners.get(key);
      if (aliasOwner !== undefined && aliasOwner !== key) continue;

      const id = crypto.randomUUID();
      channelIdByKey.set(key, id);
      const draft: FineChannelDraft = {
        id,
        name: ch.name || key,
        capabilityType: resolveOflChannel(ch, key).type,
        resolution: draftResolution(ch, packedGlobal.has(key)),
        defaultValue: (ch.defaultValue as number) || 0,
        capabilities: parseOflCapabilities(ch),
      };
      channels.push(draft);
      addFineDrafts(draft, ch, packedGlobal.get(key), alias => alias);
    }
  }

  // 2. Per-pixel template channels (templateChannels)
  // Template key e.g. "Red $pixelKey" → display name "Red"
  if (ofl.templateChannels) {
    for (const [templateKey, ch] of Object.entries(ofl.templateChannels)) {
      // A fine alias that is also listed as a template comes with its coarse channel.
      const aliasOwner = templateAliasOwners.get(templateKey);
      if (aliasOwner !== undefined && aliasOwner !== templateKey) continue;

      const id = crypto.randomUUID();
      channelIdByKey.set(templateKey, id);
      const draft: FineChannelDraft = {
        id,
        name: templateDisplayName(templateKey),
        capabilityType: resolveOflChannel(ch, templateKey).type,
        resolution: draftResolution(ch, packedTemplates.has(templateKey)),
        defaultValue: (ch.defaultValue as number) || 0,
        capabilities: parseOflCapabilities(ch),
      };
      channels.push(draft);
      addFineDrafts(draft, ch, packedTemplates.get(templateKey), templateDisplayName);
    }
  }

  // ── Pixel grid ────────────────────────────────────────────────────────────
  // Restore from OFL matrix.pixelCount ([cols, rows, layers]).
  // Falls back to 1×1 for single-head fixtures that have no matrix block.
  // (Computed before the modes: folding explicit pixel channels needs headCount.)
  const pixelCols = ofl.matrix?.pixelCount?.[0] ?? 1;
  const pixelRows = ofl.matrix?.pixelCount?.[1] ?? 1;
  const headCount = Math.max(
    1,
    ofl.pixelmapper?.headLayout?.headCount
      ?? ofl.pixelmapper?.customSvg?.headCount
      ?? ((pixelCols || 1) * (pixelRows || 1)),
  );

  // Pixel keys of the source matrix in head order. Explicitly listed pixel
  // channels ("Red 1", "Green 1", …) are only folded into a per-head group when
  // the matrix has exactly one pixel per editor head, so the DMX footprint of
  // every mode stays the same after saving.
  const sourcePixelKeys = collectPixelKeysRowMajor(ofl.matrix);
  const canFoldPixelRuns = sourcePixelKeys.length > 0 && sourcePixelKeys.length === headCount;
  const sourcePixelKeySet = new Set(sourcePixelKeys);

  /**
   * Tries to fold the run of explicit per-pixel references starting at
   * `start` into perHead entries (see custom-fixture-template-runs.ts).
   * Returns the entries and how many mode items they consumed, or `null`.
   */
  function foldPixelRunAt(items: OflMode['channels'], start: number) {
    if (!canFoldPixelRuns) return null;
    const run: TemplateRef[] = [];
    for (let j = start; j < items.length; j++) {
      const key = items[j];
      // A run consists of strings that are no global channel but an
      // instance of a template channel the editor has a draft for.
      if (typeof key !== 'string' || ofl.availableChannels?.[key]) break;
      const ref = resolveTemplateRef(key, ofl, sourcePixelKeySet);
      if (!ref || !channelIdByKey.has(ref.templateKey)) break;
      // A packed '16bit' template would gain fine bytes these strings do not list.
      if (packedTemplates.has(ref.templateKey)) break;
      run.push(ref);
    }
    const folded = foldTemplateRun(run, sourcePixelKeys);
    if (!folded) return null;
    const entries: ModeDraft['entries'] = folded.templateKeys.map(templateKey => ({
      entryId: crypto.randomUUID(),
      channelId: channelIdByKey.get(templateKey)!,
      perHead: true,
      order: folded.order,
    }));
    return { entries, consumed: run.length };
  }

  // ── Modes ─────────────────────────────────────────────────────────────────
  const modes: ModeDraft[] = (ofl.modes || []).map((m, i) => {
    const entries: ModeDraft['entries'] = [];
    const items = m.channels || [];

    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
      const item = items[itemIdx];
      if (!item) continue;

      if (typeof item === 'string') {
        // Fine byte of a packed '16bit' channel: the coarse entry covers it.
        if (packedGlobalAliases.has(item)) continue;

        // Explicit per-pixel channels ("Red 1" … "Blue 4") → one per-head group.
        const folded = foldPixelRunAt(items, itemIdx);
        if (folded) {
          entries.push(...folded.entries);
          itemIdx += folded.consumed - 1;
          continue;
        }

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
              // Instance fine bytes ("Red fine Master") stay separate drafts.
              resolution: draftResolution(chDef, false),
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
          // Per-pixel fine byte of a packed '16bit' template: covered by the coarse entry.
          if (packedTemplateAliases.has(tplName)) continue;
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
      // RDM personality (plan M4.7); only kept when it is a valid index.
      ...(isRdmPersonalityIndex(m.rdmPersonalityIndex) ? { rdmPersonalityIndex: m.rdmPersonalityIndex } : {}),
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

  // ── Custom SVG ────────────────────────────────────────────────────────────
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
