/**
 * Fixture matching cascade for discovered RDM devices (plan M6.2, D10):
 *
 * 1. **lookup** — a custom fixture or OFL definition with the device's RDM
 *    manufacturer + model ID (`findFixtureDefinitionByRdm`); the mode follows
 *    the current personality (`rdmPersonalityIndex`).
 * 2. **generated** — none found but the device describes its slots: an OFL
 *    definition generated from SLOT_INFO / SLOT_DESCRIPTION /
 *    DEFAULT_SLOT_VALUE, stored as a custom fixture so the user can edit it.
 * 3. **generic** — no slot descriptions either: N dimmer channels per
 *    personality footprint, stored the same way.
 *
 * Stored definitions carry the RDM IDs and personalities, so the next lookup
 * (step 1) finds them. Within one matcher, concurrent matches of the same
 * model share one lookup + generation ("Add all"), so a model is stored at
 * most once.
 */
import { findFixtureDefinitionByRdm, saveCustomFixtureDefinition } from '@pixelmapper/extension-api';
import type { FixtureDefinitionKey, Json, RdmDefinitionMatch } from '@pixelmapper/extension-api';
import type { RdmDeviceDescription } from '../bridge/protocol-model';
import { generateDefinition, generateGenericDefinition, generatedDefinitionMatch } from './fixture-generation';

// ── Types ──────────────────────────────────────

/** What the matcher needs from the core (defaults: the extension API). */
export interface MatchingDeps {
  /** `findFixtureDefinitionByRdm`: custom fixtures first, then OFL; `null` when nothing matches. */
  findByRdm(manufacturerId: number, modelId: number): Promise<RdmDefinitionMatch | null>;
  /** `saveCustomFixtureDefinition`: stores a NEW custom fixture, returns its key; throws when invalid. */
  saveDefinition(definition: Json): FixtureDefinitionKey;
}

/** The definition and mode to add a device with. */
export interface DeviceMatch {
  /** Definition to add (`commands.addFixtures` item `definition`). */
  key: FixtureDefinitionKey;
  /** 0-based mode for the device's CURRENT personality. */
  modeIndex: number;
  /** Cascade step that produced the definition. */
  via: 'lookup' | 'generated' | 'generic';
  /** Definition name (a generated one as generated; the store may add a " (2)" suffix). */
  name: string;
  /** Channels the core creates for the chosen mode. */
  channelCount: number;
  /** RDM personality (1-based) → 0-based mode index. */
  modeByPersonality: Record<number, number>;
  /** 0-based mode index → RDM personality, for DMX_PERSONALITY SETs when the user changes the mode. */
  personalityByMode: Record<number, number>;
  /** User-facing warnings (English), e.g. a mode whose channel count differs from the footprint. */
  warnings: string[];
}

/** Matches discovered devices to fixture definitions. */
export interface DeviceMatcher {
  /**
   * Runs the cascade for one device.
   * @throws NoDmxFootprintError (rejects) for devices without a DMX footprint
   *   (footprint 0 or start address 0xFFFF) — skip those.
   * @throws Error (rejects) for a malformed UID or when even the generic
   *   definition cannot be stored.
   */
  match(description: RdmDeviceDescription): Promise<DeviceMatch>;
}

/** Rejection of `match` for a device that uses no DMX slots. */
export class NoDmxFootprintError extends Error {
  constructor(readonly uid: string) {
    super('The device has no DMX footprint');
    this.name = 'NoDmxFootprintError';
  }
}

/** The definition shared by all concurrent matches of one model. */
interface ResolvedDefinition {
  match: RdmDefinitionMatch;
  via: DeviceMatch['via'];
  warnings: string[];
}

/** Real dependencies: the extension API. */
const API_DEPS: MatchingDeps = {
  findByRdm: (manufacturerId, modelId) => findFixtureDefinitionByRdm(manufacturerId, modelId),
  saveDefinition: definition => saveCustomFixtureDefinition(definition),
};

// ── Helpers ────────────────────────────────────

/** RDM manufacturer ID of a UID: `"7FF0:74B6510C"` → `0x7FF0`. Throws for a malformed UID. */
export function manufacturerIdOfUid(uid: string): number {
  const m = /^([0-9a-f]{4}):[0-9a-f]{8}$/i.exec(uid.trim());
  if (!m) throw new Error(`Invalid RDM UID "${uid}"`);
  return parseInt(m[1]!, 16);
}

/** Picks the mode of the device's current personality from a definition match. */
function selectMode(resolved: ResolvedDefinition, description: RdmDeviceDescription): DeviceMatch {
  const { match, via } = resolved;
  const { currentPersonality, dmxFootprint } = description.deviceInfo;
  const warnings = [...resolved.warnings];
  if (match.modes.length === 0) throw new Error(`Fixture definition "${match.name}" has no modes`);

  let mode = match.modes.find(m => m.index === match.modeByPersonality[currentPersonality]);
  if (!mode) {
    // Personality not mapped: a mode with the device's footprint, else the first.
    mode = match.modes.find(m => m.channelCount === dmxFootprint) ?? match.modes[0]!;
    warnings.push(`Personality ${currentPersonality} of the device has no mode in "${match.name}"; using mode "${mode.name}".`);
  }
  if (mode.channelCount !== dmxFootprint) {
    warnings.push(`Mode "${mode.name}" has ${mode.channelCount} channels, the device reports a DMX footprint of ${dmxFootprint}.`);
  }

  const personalityByMode: Record<number, number> = {};
  for (const m of match.modes) {
    if (m.rdmPersonalityIndex !== undefined) personalityByMode[m.index] = m.rdmPersonalityIndex;
  }
  return {
    key: match.key,
    modeIndex: mode.index,
    via,
    name: match.name,
    channelCount: mode.channelCount,
    modeByPersonality: { ...match.modeByPersonality },
    personalityByMode,
    warnings,
  };
}

// ── Matcher ────────────────────────────────────

/** Creates a matcher; `deps` default to the extension API. */
export function createDeviceMatcher(deps: MatchingDeps = API_DEPS): DeviceMatcher {
  /** In-flight lookup + generation per `"<manufacturer>:<model>"`. */
  const inFlight = new Map<string, Promise<ResolvedDefinition>>();

  /** Step 1, treating a failing lookup like "not found". */
  async function lookup(manufacturerId: number, modelId: number): Promise<RdmDefinitionMatch | null> {
    try {
      return await deps.findByRdm(manufacturerId, modelId);
    }
    catch (err) {
      console.warn(`[artnet] fixture lookup for RDM ${manufacturerId}/${modelId} failed:`, err);
      return null;
    }
  }

  /** Stores `definition` and returns its match. */
  function store(definition: Json, via: DeviceMatch['via'], warnings: string[]): ResolvedDefinition {
    const key = deps.saveDefinition(definition);
    return { match: generatedDefinitionMatch(key, definition), via, warnings };
  }

  /** Steps 1–3 for one model (run once per in-flight model). */
  async function resolve(manufacturerId: number, description: RdmDeviceDescription): Promise<ResolvedDefinition> {
    const found = await lookup(manufacturerId, description.deviceInfo.deviceModelId);
    if (found) return { match: found, via: 'lookup', warnings: [] };

    const warnings: string[] = [];
    if (description.slots.length > 0) {
      try {
        return store(generateDefinition(description, manufacturerId), 'generated', warnings);
      }
      catch (err) {
        console.warn(`[artnet] generated fixture definition for ${description.uid} rejected:`, err);
        warnings.push(`The slot descriptions of the device could not be turned into a fixture definition (${(err as Error).message ?? err}); using generic dimmer channels.`);
      }
    }
    return store(generateGenericDefinition(description, manufacturerId), 'generic', warnings);
  }

  /** Shares the resolution of concurrent matches of the same model. */
  function resolveShared(manufacturerId: number, description: RdmDeviceDescription): Promise<ResolvedDefinition> {
    const key = `${manufacturerId}:${description.deviceInfo.deviceModelId}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = resolve(manufacturerId, description).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  return {
    async match(description) {
      const { dmxFootprint, dmxStartAddress } = description.deviceInfo;
      if (!(dmxFootprint > 0) || dmxStartAddress === 0xffff) throw new NoDmxFootprintError(description.uid);
      const manufacturerId = manufacturerIdOfUid(description.uid);
      return selectMode(await resolveShared(manufacturerId, description), description);
    },
  };
}
