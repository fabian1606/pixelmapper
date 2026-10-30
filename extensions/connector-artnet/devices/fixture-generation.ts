/**
 * Fixture definitions generated from a device's RDM description (plan M6.2,
 * decision D10 steps 2 and 3), in Open Fixture Library JSON as
 * `saveCustomFixtureDefinition` stores them. Pure: no storage, no clock
 * (the core fills `meta` dates and `$schema` when it stores the definition).
 *
 * One channel per DMX slot: every mode lists exactly one channel per slot,
 * in slot order, so the core gives each channel an address offset equal to
 * its slot offset. Modes never contain `null` entries (the core skips those
 * without advancing the offset) or matrix inserts; slots nobody describes
 * become `Generic` channels.
 *
 * Fine slots (ST_SEC_FINE) become `fineChannelAliases` of their primary slot
 * with `dmxValueResolution` 16bit (24bit for a second fine slot). The core
 * still creates one channel per slot — a fine `GENERIC` channel at the fine
 * slot's offset — and gives the coarse channel `resolution` and
 * `fineAddressOffsets`, so the engine outputs 16/24-bit values. A fine slot
 * whose primary is missing (or a third one) is a separate `Generic` channel.
 *
 * Every definition carries `rdm.modelId`, `pixelmapper.rdmManufacturerId` and
 * one mode per personality with `rdmPersonalityIndex`, so the next
 * `findFixtureDefinitionByRdm` finds it and a later mode change knows which
 * personality to set on the device.
 */
import type { FixtureDefinitionKey, Json, RdmDefinitionMatch, RdmDefinitionMode } from '@pixelmapper/extension-api';
import type { RdmDeviceDescription, RdmPersonality, RdmSlot } from '../bridge/protocol-model';
import { SLOT_TYPE, secondarySlotCapability, secondarySlotName, slotLabelCapability, slotLabelName } from './rdm-slot-labels';
import type { JsonObject } from './rdm-slot-labels';

/**
 * Author written into `meta.authors` of generated definitions. The core's RDM
 * lookup recognizes it (`RDM_GENERATED_AUTHOR`) and ranks such definitions
 * below library fixtures — keep both strings equal.
 */
const GENERATED_AUTHOR = 'Pixelmapper (generated from RDM)';

// ── Helpers ────────────────────────────────────

/** Unique names: `base`, else `base 2`, `base 3`, … */
class UniqueNames {
  /** Names handed out so far. */
  private readonly used = new Set<string>();

  /** Reserves and returns a name derived from `base`. */
  reserve(base: string): string {
    let name = base;
    for (let n = 2; this.used.has(name); n++) name = `${base} ${n}`;
    this.used.add(name);
    return name;
  }
}

/** `availableChannels` under unique names; fine aliases share the namespace. */
class ChannelTable {
  /** The definition's `availableChannels`, by unique name. */
  readonly channels: Record<string, JsonObject> = {};
  /** Every name in use: channel keys and fine aliases. */
  readonly names = new UniqueNames();

  /** Adds `channel` under a unique name derived from `base`; returns the name. */
  add(base: string, channel: JsonObject): string {
    const name = this.names.reserve(base);
    this.channels[name] = channel;
    return name;
  }

  /** Returns a lazily grown pool `<prefix> 1…n` of channels with `capability`. */
  pool(prefix: string, capability: JsonObject): (count: number) => string[] {
    const names: string[] = [];
    return (count) => {
      while (names.length < count) names.push(this.add(`${prefix} ${names.length + 1}`, { capability: { ...capability } }));
      return names.slice(0, count);
    };
  }
}

/** Trimmed non-empty text, else `null`. */
const text = (s: string | null | undefined): string | null => (s?.trim() ? s.trim() : null);

/** A valid 8-bit DMX value, else `null`. */
const dmxValue = (v: number | null | undefined): number | null =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255 ? v : null);

/** `0x7ff0` → `"7FF0"`. */
const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

/** OFL category for an E1.20 product category (Table A-5) where it is obvious. */
function oflCategory(productCategory: number): string {
  if (productCategory === 0x0102 || productCategory === 0x0302) return 'Moving Head'; // *_MOVING_YOKE
  if (productCategory === 0x0103 || productCategory === 0x0303) return 'Scanner'; // *_MOVING_MIRROR
  if ((productCategory & 0xff00) === 0x0500) return 'Dimmer'; // PRODUCT_CATEGORY_DIMMER_*
  return 'Other';
}

// ── Slots → channels ───────────────────────────

/** Turns the fine slots of one primary into `fineChannelAliases` and a 16/24-bit default. */
function makeFine(channel: JsonObject, coarse: RdmSlot, fines: { slot: RdmSlot; alias: string }[]): void {
  channel.fineChannelAliases = fines.map(f => f.alias);
  channel.dmxValueResolution = fines.length === 2 ? '24bit' : '16bit';
  const bytes = [coarse, ...fines.map(f => f.slot)].map(s => dmxValue(s.defaultValue));
  if (bytes.every(b => b === null)) return;
  const combined = bytes.reduce<number>((acc, b) => acc * 256 + (b ?? 0), 0);
  // The core reads a default ≤ 255 as the coarse byte, so such a small
  // multi-byte value cannot be expressed: fall back to 0.
  channel.defaultValue = combined > 255 ? combined : 0;
}

/** One channel name per slot offset `0…footprint-1` of the current personality. */
function slotChannels(slots: readonly RdmSlot[], footprint: number, table: ChannelTable): string[] {
  const byOffset = new Map<number, RdmSlot>();
  for (const s of slots) {
    if (Number.isInteger(s.offset) && s.offset >= 0 && s.offset < footprint && !byOffset.has(s.offset)) byOffset.set(s.offset, s);
  }
  const primaryAt = (offset: number) => (byOffset.get(offset)?.type === SLOT_TYPE.PRIMARY ? byOffset.get(offset)! : null);
  const names: string[] = [];

  // Pass 1: primary slots, and offsets SLOT_INFO does not describe.
  for (let o = 0; o < footprint; o++) {
    const s = byOffset.get(o);
    if (s && s.type !== SLOT_TYPE.PRIMARY) continue;
    const channel: JsonObject = { capability: s ? slotLabelCapability(s.labelId) : { type: 'Generic' } };
    const value = dmxValue(s?.defaultValue);
    if (value !== null) channel.defaultValue = value;
    names[o] = table.add(text(s?.description) ?? (s ? slotLabelName(s.labelId) : null) ?? `Channel ${o + 1}`, channel);
  }

  // Pass 2: secondary slots (labelId = offset of their primary), named after it.
  const fines = new Map<number, { slot: RdmSlot; alias: string }[]>();
  for (let o = 0; o < footprint; o++) {
    const s = byOffset.get(o);
    if (!s || s.type === SLOT_TYPE.PRIMARY) continue;
    const primary = primaryAt(s.labelId);
    const base = text(s.description) ?? (primary ? secondarySlotName(s.type, names[primary.offset]!) : `Channel ${o + 1}`);
    const list = primary ? (fines.get(primary.offset) ?? []) : [];
    if (primary && s.type === SLOT_TYPE.SEC_FINE && list.length < 2) {
      names[o] = table.names.reserve(base);
      fines.set(primary.offset, [...list, { slot: s, alias: names[o]! }]);
      continue;
    }
    const channel: JsonObject = { capability: secondarySlotCapability(s.type, primary?.labelId ?? null) };
    const value = dmxValue(s.defaultValue);
    if (value !== null) channel.defaultValue = value;
    names[o] = table.add(base, channel);
  }

  for (const [offset, list] of fines) makeFine(table.channels[names[offset]!]!, byOffset.get(offset)!, list);
  return names;
}

// ── Definition ─────────────────────────────────

/** 1-based current personality (devices without personalities report 1). */
const currentPersonality = (description: RdmDeviceDescription): number => Math.max(1, description.deviceInfo.currentPersonality);

/** Personalities that get a mode: the described ones with a footprint plus the current one, by index. */
function personalities(description: RdmDeviceDescription): RdmPersonality[] {
  const byIndex = new Map<number, RdmPersonality>();
  for (const p of description.personalities) {
    if (Number.isInteger(p.index) && p.index >= 1 && p.footprint > 0 && !byIndex.has(p.index)) byIndex.set(p.index, p);
  }
  const current = currentPersonality(description);
  // The current personality's footprint is the one DEVICE_INFO reports.
  byIndex.set(current, { index: current, footprint: description.deviceInfo.dmxFootprint, description: byIndex.get(current)?.description ?? null });
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** Assembles the definition: header, channels and one mode per personality. */
function assemble(description: RdmDeviceDescription, manufacturerId: number, table: ChannelTable, how: string, channelsOf: (p: RdmPersonality) => string[]): Json {
  const info = description.deviceInfo;
  const ids = `${hex4(manufacturerId)}:${hex4(info.deviceModelId)}`;
  const model = text(description.deviceModelDescription);
  const maker = text(description.manufacturerLabel) ?? `Manufacturer ${hex4(manufacturerId)}`;
  const rdm: JsonObject = { modelId: info.deviceModelId };
  const software = text(description.softwareVersionLabel);
  if (software) rdm.softwareVersion = software;

  const modeNames = new UniqueNames();
  const modes: JsonObject[] = personalities(description).map(p => ({
    name: modeNames.reserve(text(p.description) ?? `Personality ${p.index}`),
    rdmPersonalityIndex: p.index,
    channels: channelsOf(p),
  }));
  return {
    name: model ?? `RDM device ${ids}`,
    categories: [oflCategory(info.productCategory)],
    meta: { authors: [GENERATED_AUTHOR] },
    comment: `${maker} ${model ?? 'device'} (RDM ${ids}), generated by Pixelmapper ${how}. Edit it to refine the channels.`,
    rdm,
    pixelmapper: { rdmManufacturerId: manufacturerId },
    availableChannels: table.channels,
    modes,
  };
}

/**
 * OFL definition generated from the device's SLOT_INFO / SLOT_DESCRIPTION /
 * DEFAULT_SLOT_VALUE (D10 step 2). The current personality's mode has one
 * channel per slot (capability from the slot label, see `rdm-slot-labels.ts`;
 * name from the slot description, else the label, made unique: "Red 2");
 * the other personalities get `Generic` channels "Channel 1…n" of their
 * footprint. Expects a device with a DMX footprint > 0.
 */
export function generateDefinition(description: RdmDeviceDescription, manufacturerId: number): Json {
  const table = new ChannelTable();
  const current = slotChannels(description.slots, description.deviceInfo.dmxFootprint, table);
  const generic = table.pool('Channel', { type: 'Generic' });
  return assemble(description, manufacturerId, table, 'from the RDM slot descriptions', p =>
    (p.index === currentPersonality(description) ? current : generic(p.footprint)));
}

/**
 * Generic OFL definition for a device that does not describe its slots (D10
 * step 3): every personality's mode has "Dimmer 1…n" `Intensity` channels of
 * its footprint. Expects a device with a DMX footprint > 0.
 */
export function generateGenericDefinition(description: RdmDeviceDescription, manufacturerId: number): Json {
  const table = new ChannelTable();
  const dimmers = table.pool('Dimmer', { type: 'Intensity' });
  return assemble(description, manufacturerId, table, 'as generic dimmer channels (the device does not describe its slots)', p => dimmers(p.footprint));
}

/**
 * The `findFixtureDefinitionByRdm`-style match of a definition made by this
 * module and stored under `key`: modes with their channel counts (one
 * channel per entry) and the personality → mode mapping.
 */
export function generatedDefinitionMatch(key: FixtureDefinitionKey, definition: Json): RdmDefinitionMatch {
  const generated = definition as unknown as { name: string; modes: { name: string; rdmPersonalityIndex: number; channels: string[] }[] };
  const modeByPersonality: Record<number, number> = {};
  const modes = generated.modes.map((mode, index): RdmDefinitionMode => {
    if (!(mode.rdmPersonalityIndex in modeByPersonality)) modeByPersonality[mode.rdmPersonalityIndex] = index;
    return { index, name: mode.name, channelCount: mode.channels.length, rdmPersonalityIndex: mode.rdmPersonalityIndex };
  });
  return { key, source: 'custom', name: generated.name, manufacturer: '', modes, modeByPersonality };
}
