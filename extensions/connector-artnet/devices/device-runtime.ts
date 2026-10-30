/**
 * Runtime of the RDM device features (plan M6): one per app, installed by
 * the manifest's `activate` with the extension API (`run` + `commands`, so
 * commands carry this extension as initiator). Owns the device store, the
 * fixture matcher, the patch sync (M6.5) and the universe guard (M6.6), and
 * answers what the UI needs: linked fixtures, port universes, the mode ↔
 * personality maps of definitions.
 */
import { shallowReactive, watch, type WatchStopHandle } from 'vue';
import { findFixtureDefinitionByRdm, listFixtures } from '@pixelmapper/extension-api';
import type { Command, CoreCommandFactory, FixtureDefinitionKey, FixtureId } from '@pixelmapper/extension-api';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeDirectory } from '../bridge/node-directory';
import type { RdmUid } from '../bridge/protocol-model';
import { getArtNetBackend, getNodeDirectory } from '../bridge/shared';
import { activeNodeConnectors } from '../node/node-connector';
import { DeviceStore, type DeviceEntry } from './device-store';
import { createDeviceMatcher, manufacturerIdOfUid, type DeviceMatch, type DeviceMatcher } from './fixture-matching';
import { linkedFixturesOf, type LinkedFixture } from './link';
import { startPatchSync } from './patch-sync';
import { startUniverseGuard } from './universe-guard';

/** What the runtime needs from the extension API (`activate`'s `api`). */
export interface DeviceRuntimeApi {
  commands: CoreCommandFactory;
  /** Runs a command through the history as this extension. */
  run(command: Command): void;
}

/** Mode ↔ personality of one definition. */
export interface PersonalityMaps {
  /** 0-based mode index → 1-based personality. */
  personalityByMode: Record<number, number>;
  /** 1-based personality → 0-based mode index. */
  modeByPersonality: Record<number, number>;
}

/** Injectable dependencies (tests). */
export interface DeviceRuntimeDeps {
  backend?: ArtNetBackend;
  directory?: NodeDirectory;
  matcher?: DeviceMatcher;
  rereadMs?: number;
}

export class DeviceRuntime {
  readonly store: DeviceStore;
  readonly matcher: DeviceMatcher;
  readonly backend: ArtNetBackend;
  /** Mode ↔ personality per definition key (`null` = not known); reactive. */
  readonly personalityMaps: Map<FixtureDefinitionKey, PersonalityMaps | null> = shallowReactive(new Map());

  private pendingMaps = new Map<FixtureDefinitionKey, Promise<PersonalityMaps | null>>();
  private stops: (() => void)[] = [];
  private stopWatch: WatchStopHandle | null = null;

  constructor(readonly api: DeviceRuntimeApi, deps: DeviceRuntimeDeps = {}) {
    this.backend = deps.backend ?? getArtNetBackend();
    const directory = deps.directory ?? getNodeDirectory();
    this.matcher = deps.matcher ?? createDeviceMatcher();
    this.store = new DeviceStore({
      backend: this.backend,
      directory,
      // Devices of the nodes that have a connector (D9: the list lives in the node's card).
      nodeIds: () => [...activeNodeConnectors].map(c => c.nodeId.value).filter((id): id is string => !!id),
      rereadMs: deps.rereadMs,
    });
  }

  /**
   * Runs the store, the patch sync and the universe guard while at least one
   * `artnet` connector exists. Without one there is no device to talk
   * to (every link resolves to no port universe), so users who never use
   * Art-Net pay nothing — not even the core's patch observation.
   */
  start(): void {
    if (this.stopWatch) return;
    this.stopWatch = watch(() => activeNodeConnectors.size > 0, (active) => {
      if (active) this.activate();
      else this.deactivate();
    }, { immediate: true });
  }

  /** Stops everything. */
  stop(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.deactivate();
  }

  /** Starts the device features (idempotent). */
  private activate() {
    if (this.stops.length) return;
    this.store.start();
    this.stops.push(() => this.store.stop(), startPatchSync(this), startUniverseGuard(this));
  }

  /** Stops the device features (idempotent). */
  private deactivate() {
    for (const stop of this.stops.splice(0)) stop();
  }

  // ── Fixtures ─────────────────────────────────

  /** Fixtures of the project that carry a link (any state). */
  linkedFixtures(): LinkedFixture[] {
    return linkedFixturesOf(listFixtures());
  }

  /** Ids of the fixtures linked to `uid` (normally one). */
  fixturesOfUid(uid: RdmUid): LinkedFixture[] {
    return this.linkedFixtures().filter(f => f.link.uid === uid);
  }

  // ── Mode ↔ personality ───────────────────────

  /** Remembers the maps of a match (also for definitions the lookup would not return first). */
  rememberMatch(match: DeviceMatch): void {
    this.personalityMaps.set(match.key, { personalityByMode: { ...match.personalityByMode }, modeByPersonality: { ...match.modeByPersonality } });
  }

  /**
   * Mode ↔ personality of `key` for a device: from a remembered match, else
   * from the RDM lookup when it returns this definition. Null when unknown.
   */
  async loadPersonalityMaps(key: FixtureDefinitionKey, device: Pick<DeviceEntry, 'uid' | 'info' | 'description'>): Promise<PersonalityMaps | null> {
    if (this.personalityMaps.has(key)) return this.personalityMaps.get(key) ?? null;
    const modelId = device.info?.deviceModelId ?? device.description?.deviceInfo.deviceModelId;
    if (modelId === undefined) return null;
    let pending = this.pendingMaps.get(key);
    if (!pending) {
      pending = this.lookupMaps(key, device.uid, modelId).finally(() => this.pendingMaps.delete(key));
      this.pendingMaps.set(key, pending);
    }
    return pending;
  }

  /** Cached maps of `key` (reactive); starts loading them when unknown. */
  cachedPersonalityMaps(key: FixtureDefinitionKey, device: Pick<DeviceEntry, 'uid' | 'info' | 'description'> | undefined): PersonalityMaps | null {
    if (this.personalityMaps.has(key)) return this.personalityMaps.get(key) ?? null;
    if (device) void this.loadPersonalityMaps(key, device);
    return null;
  }

  /** RDM lookup of the device's definition; maps only when it is `key`. */
  private async lookupMaps(key: FixtureDefinitionKey, uid: RdmUid, modelId: number): Promise<PersonalityMaps | null> {
    let maps: PersonalityMaps | null = null;
    try {
      const match = await findFixtureDefinitionByRdm(manufacturerIdOfUid(uid), modelId);
      if (match?.key === key) {
        const personalityByMode: Record<number, number> = {};
        for (const m of match.modes) if (m.rdmPersonalityIndex !== undefined) personalityByMode[m.index] = m.rdmPersonalityIndex;
        maps = { personalityByMode, modeByPersonality: { ...match.modeByPersonality } };
      }
    }
    catch (err) {
      console.warn('[artnet] mode/personality lookup failed:', err);
    }
    this.personalityMaps.set(key, maps);
    return maps;
  }
}

// ── The app's runtime ──────────────────────────

let current: DeviceRuntime | null = null;

/** Installs and starts the runtime (manifest `activate`); returns the disposer. */
export function installDeviceRuntime(api: DeviceRuntimeApi, deps?: DeviceRuntimeDeps): () => void {
  current?.stop();
  const runtime = new DeviceRuntime(api, deps);
  current = runtime;
  runtime.start();
  return () => {
    runtime.stop();
    if (current === runtime) current = null;
  };
}

/** The app's runtime, or null before activation (and in isolated tests). */
export function getDeviceRuntime(): DeviceRuntime | null {
  return current;
}

/** Fixture ids of the effective or stored links of `uid` (for UI lookups). */
export function fixtureIdsOfUid(runtime: DeviceRuntime, uid: RdmUid): FixtureId[] {
  return runtime.fixturesOfUid(uid).map(f => f.fixtureId);
}
