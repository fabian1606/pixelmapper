import { defineStore } from 'pinia';
import { ref, shallowRef, computed, watch, watchEffect, markRaw, triggerRef } from 'vue';
import type { Preset } from '~/utils/engine/preset-types';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useHistory, setPersistenceHooks, lastSeenSequenceNumber } from '~/components/engine/composables/use-history';
import { useConnectionsStore } from '~/stores/connections-store';
import { WebSocketConnector } from '~/utils/connectors/websocket-connector';
import { ArtNetConnector } from '~/utils/connectors/artnet-connector';
import {
  TYPE_LAYOUT_BIN, TYPE_CHAN_BIN,
  buildLayoutBin, buildChannelsBin, buildModifiersBin,
} from '~/utils/connectors/binary-encoder';
import {
  serializeProject,
  deserializeProject,
  IncompatibleProjectError,
  type ProjectSnapshot,
} from '~/utils/engine/serialize';
import { commandFromPayload, type ReplayContext } from '~/components/engine/commands/serializable-command';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useControllerStore } from '~/stores/controller-store';
import { SetModifiersCommand } from '~/components/engine/commands/set-modifiers-command';
import { cloneModifiers } from '~/utils/engine/modifiers';
import { getManifest, loadWasm, resolve as resolvePlugin, resolveErrors } from '~/utils/plugins/plugin-store';
import { BUILTIN_PLUGINS } from '~/utils/plugins/builtin-index';
import { registerCommand } from '~/components/engine/commands/serializable-command';
// Side-effect import — registers 'connector.add' / 'connector.remove' /
// 'connector.update' factories so the tail replay can recreate connector
// mutations on project load even before any UI page has been visited.
import '~/components/engine/commands/connector-commands';
// Side-effect import — registers the 'SetChannelRange' factory so per-channel
// range edits replay correctly on project load.
import '~/components/engine/commands/set-channel-range-command';
import '~/components/engine/commands/set-fixture-kind-config-command';
// Side-effect import — registers all live-op handlers (section.setActive,
// preset-ops, etc.) so getLiveOpConfig() resolves during tail replay even
// before any live-mode UI component has been mounted.
import '~/composables/live-ops/index';
import { resetFixtureChannels, applyPreset } from '~/components/engine/composables/preset-apply';
import {
  useLiveBusStore,
  setPersistHook,
  setPersistAckHook,
  enqueuePersist,
  flushPersistQueue,
  clearPersistQueue,
  getPersistQueueSnapshot,
  getLiveOpConfig,
  type LiveContext,
} from '~/stores/live-bus-store';
import type { GlobalFunctionType, GlobalFunctionConfig, StrobeConfig, BlindConfig } from '~/utils/live/types';
import { parseHexColor } from '~/utils/engine/color-math';
import { usePinnedModifiersStore } from '~/stores/pinned-modifiers-store';
import { trace } from '~/utils/perf';
import { walAppend, walMarkAcked, walGetPending } from '~/utils/persistence/wal';
import { liveHub, type SignatureFrame } from '~/utils/extensions/live-hub';
import { bumpModelTick } from '~/utils/extensions/model-tick';
import { notify } from '~/composables/use-notifications';
import { isBuiltinHash } from '~/utils/plugins/builtin-index';

export const useEngineStore = defineStore('engine', () => {
  const savedPresets = ref<Preset[]>([]);
  const selectedPresetId = ref<string | null>(null);
  /** Press-and-hold flash stack. Each entry = one held flash trigger. Top wins. */
  const flashStack = ref<Array<{ key: string; presetId: string }>>([]);
  /** The preset actually rendering: top of flash stack, or the latched base preset. */
  const effectivePresetId = computed<string | null>(() => flashStack.value.at(-1)?.presetId ?? selectedPresetId.value);

  /** Global overwrite stack (highest priority). Top entry's effect is visible. */
  type OverwriteEntry = {
    key: string;
    type: GlobalFunctionType;
    config: GlobalFunctionConfig;
  };
  const overwriteStack = ref<OverwriteEntry[]>([]);
  const effectiveOverwrite = computed(() => overwriteStack.value.at(-1) ?? null);

  /**
   * One snapshot of the "clean" channel state, captured the moment the stack
   * goes from empty → non-empty. Restored when the stack returns to empty.
   * Per-entry snapshots cannot work because removing a non-top entry would
   * leave the stack-top entry's snapshot referencing already-overwritten state.
   */
  type ChannelSnap = { stepValues: number[]; stepsCount: number; isPlaying: boolean };
  let baseSnapshot: Map<string, ChannelSnap> | null = null;
  let baseModifiersSnapshot: import('~/utils/engine/types').ModifierInstance[] | null = null;

  /** Strobe needs a timer to alternate dimmer values. Only the top-of-stack strobe is active. */
  let strobeTimer: ReturnType<typeof setInterval> | null = null;
  let strobePhase = false;

  function _stopStrobeTimer() {
    if (strobeTimer != null) { clearInterval(strobeTimer); strobeTimer = null; }
    strobePhase = false;
  }

  /** Snapshot ALL channels — an overwrite preset can touch any channel type. */
  function _captureBaseSnapshot(): Map<string, ChannelSnap> {
    const snap = new Map<string, ChannelSnap>();
    for (const f of flatFixtures.value) {
      for (let i = 0; i < f.channels.length; i++) {
        const ch = f.channels[i]!;
        snap.set(`${f.id}:${i}`, {
          stepValues: [...ch.chaserConfig.stepValues],
          stepsCount: ch.chaserConfig.stepsCount,
          isPlaying: ch.chaserConfig.isPlaying,
        });
      }
    }
    return snap;
  }

  function _restoreModifiersSnapshot(snap: import('~/utils/engine/types').ModifierInstance[]) {
    const cloned = cloneModifiers(snap);
    modifiers.value.splice(0, modifiers.value.length, ...cloned);
    engine.modifiers = modifiers.value;
  }

  function _restoreBaseSnapshot(snap: Map<string, ChannelSnap>) {
    for (const f of flatFixtures.value) {
      for (let i = 0; i < f.channels.length; i++) {
        const key = `${f.id}:${i}`;
        const entry = snap.get(key);
        if (entry) {
          const cfg = f.channels[i]!.chaserConfig;
          cfg.stepValues = [...entry.stepValues];
          cfg.stepsCount = entry.stepsCount;
          cfg.isPlaying = entry.isPlaying;
        }
      }
    }
  }

  /** Flatten a channel to a single static step value, stopping any running chaser. */
  function _setStaticValue(ch: { chaserConfig: { stepValues: number[]; stepsCount: number; isPlaying: boolean } }, value: number) {
    ch.chaserConfig.stepValues[0] = value;
    ch.chaserConfig.stepsCount = 1;
    ch.chaserConfig.isPlaying = false;
  }

  function _findOverwritePreset(type: GlobalFunctionType): Preset | undefined {
    const isMatch = (p: Preset) => p.type === 'overwrite' && p.overwriteTarget === type;
    const activeId = effectivePresetId.value;
    if (activeId) {
      // Prefer an overwrite tied to the active preset's variant family.
      const byId = new Map(savedPresets.value.map(p => [p.id, p]));
      let rootId = activeId;
      for (let i = 0; i < 16; i++) {
        const cur = byId.get(rootId);
        if (!cur?.basePresetId) break;
        rootId = cur.basePresetId;
      }
      const related = savedPresets.value.find(
        p => (p.id === rootId || p.basePresetId === rootId) && isMatch(p)
      );
      if (related) return related;
    }
    // Fall back to a standalone (top-level) overwrite preset for this target,
    // which applies globally regardless of the active preset.
    return savedPresets.value.find(p => !p.basePresetId && isMatch(p));
  }

  /** Apply the current top-of-stack overwrite to channels (start strobe timer if needed). */
  function _applyTopOverwrite() {
    _stopStrobeTimer();
    const top = overwriteStack.value.at(-1);
    if (!top) return;
    const fixtures = flatFixtures.value;

    const overwritePreset = _findOverwritePreset(top.type);
    if (overwritePreset) {
      // Blackout everything first so an overwrite is a clean slate: only the
      // channels/effects the override preset defines should be lit, everything
      // else goes to zero (not the previously-played preset's look).
      // Movement channels (PAN/TILT/…) are excluded — overwrites should not
      // snap moving heads to 0.
      const MOVEMENT_TYPES = new Set(['PAN', 'PAN_CONTINUOUS', 'TILT', 'TILT_CONTINUOUS', 'PANTILT_SPEED']);
      for (const f of fixtures) {
        for (const ch of f.channels) {
          if (MOVEMENT_TYPES.has(ch.type)) continue;
          ch.chaserConfig.stepValues = [0];
          ch.chaserConfig.stepsCount = 1;
          ch.chaserConfig.activeEditStep = 0;
          ch.chaserConfig.isPlaying = false;
          ch.currentBaseValue = 0;
        }
      }
      modifiers.value.splice(0, modifiers.value.length);
      // Use the exact same code path as the preset Play button so the result
      // matches what the user programmed (type-checks snapshots, sets base
      // values, reconstructs modifiers).
      applyPreset(overwritePreset, fixtures, modifiers.value);
      engine.modifiers = modifiers.value;
      return;
    }

    if (top.type === 'blackout') {
      for (const f of fixtures) {
        // Prefer killing the dimmer (scales all colors). Fixtures without a
        // dimmer have no master intensity, so zero their COLOR channels instead.
        const hasDimmer = f.channels.some(ch => ch.role === 'DIMMER');
        for (const ch of f.channels) {
          if (hasDimmer ? ch.role === 'DIMMER' : ch.role === 'COLOR') {
            _setStaticValue(ch, 0);
          }
        }
      }
    } else if (top.type === 'blind') {
      const cfg = top.config as BlindConfig;
      const rgb = parseHexColor(cfg.color ?? '#ffffff') ?? { r: 255, g: 255, b: 255 };
      for (const f of fixtures) {
        for (const ch of f.channels) {
          if (ch.role === 'DIMMER') _setStaticValue(ch, 255);
          else if (ch.type === 'RED')   _setStaticValue(ch, rgb.r);
          else if (ch.type === 'GREEN') _setStaticValue(ch, rgb.g);
          else if (ch.type === 'BLUE')  _setStaticValue(ch, rgb.b);
        }
      }
    } else if (top.type === 'strobe') {
      const cfg = top.config as StrobeConfig;
      const hz = cfg.beatSync
        ? (engine.globalBpm.value / 60) * (cfg.beatDivision ?? 8)
        : (cfg.frequency ?? 8);
      const halfPeriodMs = Math.max(10, 500 / Math.max(0.1, hz));
      const tick = () => {
        strobePhase = !strobePhase;
        const v = strobePhase ? 255 : 0;
        for (const f of fixtures) {
          for (const ch of f.channels) {
            if (ch.role === 'DIMMER') _setStaticValue(ch, v);
          }
        }
        flushEngineOutput();
      };
      tick();
      strobeTimer = setInterval(tick, halfPeriodMs);
    }
  }

  function pressOverwrite(key: string, type: GlobalFunctionType, config: GlobalFunctionConfig) {
    // If the same key is already on the stack (e.g. missed release after a
    // dropped pointer event), remove it first so the new press is fresh.
    const existingIdx = overwriteStack.value.findIndex(e => e.key === key);
    const wasEmpty = overwriteStack.value.length === 0;
    if (existingIdx !== -1) overwriteStack.value.splice(existingIdx, 1);
    if (wasEmpty) {
      baseSnapshot = _captureBaseSnapshot();
      baseModifiersSnapshot = cloneModifiers(modifiers.value);
    }
    overwriteStack.value.push({ key, type, config });
    if (baseSnapshot) _restoreBaseSnapshot(baseSnapshot);
    if (baseModifiersSnapshot) _restoreModifiersSnapshot(baseModifiersSnapshot);
    _applyTopOverwrite();
    flushEngineOutput();
  }

  function releaseOverwrite(key: string) {
    const idx = overwriteStack.value.findIndex(e => e.key === key);
    if (idx === -1) return;
    overwriteStack.value.splice(idx, 1);
    _stopStrobeTimer();
    if (overwriteStack.value.length === 0) {
      if (baseSnapshot) _restoreBaseSnapshot(baseSnapshot);
      if (baseModifiersSnapshot) _restoreModifiersSnapshot(baseModifiersSnapshot);
      baseSnapshot = null;
      baseModifiersSnapshot = null;
    } else {
      // Restore base first so a different overwrite type (e.g. strobe → blind)
      // doesn't leak the previous overwrite's values into untouched channels.
      if (baseSnapshot) _restoreBaseSnapshot(baseSnapshot);
      if (baseModifiersSnapshot) _restoreModifiersSnapshot(baseModifiersSnapshot);
      _applyTopOverwrite();
    }
    flushEngineOutput();
  }

  function clearOverwriteStack() {
    _stopStrobeTimer();
    if (overwriteStack.value.length > 0) {
      if (baseSnapshot) _restoreBaseSnapshot(baseSnapshot);
      if (baseModifiersSnapshot) _restoreModifiersSnapshot(baseModifiersSnapshot);
    }
    overwriteStack.value.splice(0);
    baseSnapshot = null;
    baseModifiersSnapshot = null;
    flushEngineOutput();
  }

  const engine = markRaw(new EffectEngine());

  // Base BPM (what tap-tempo writes) and speed multiplier (set by speed buttons).
  // Effective globalBpm = baseBpm * speedMultiplier. multiplier === 0 = freeze.
  const baseBpm = ref(120);
  const speedMultiplier = ref(1);
  function setSpeedMultiplier(m: number) {
    speedMultiplier.value = m;
  }

  // Create a reactive array for effects that the UI can track,
  // and bind it into the engine so the render loop uses it.
  const modifiers = ref<import('~/utils/engine/types').ModifierInstance[]>([]);
  engine.modifiers = modifiers.value;

  const sceneNodes = shallowRef<SceneNode[]>([]);
  const selectedIds = shallowRef<Set<string | number>>(new Set());

  const globalBases = ref<Record<string, number>>({
    RED: 0,
    GREEN: 0,
    BLUE: 0,
    DIMMER: 0,
  });

  const flatFixtures = computed(() => {
    const result: Fixture[] = [];
    function traverse(nodes: SceneNode[]) {
      for (const node of nodes) {
        if (node instanceof FixtureGroup) traverse(node.children);
        else result.push(node as Fixture);
      }
    }
    traverse(sceneNodes.value);
    return result;
  });

  const currentElapsed = ref(0);

  // ── Universe tracking ─────────────────────────────────────────────────────

  /** Universe numbers currently used by fixtures (derived from startAddress). */
  const usedUniverses = computed(() => {
    const universes = new Set<number>();
    for (const fixture of flatFixtures.value) {
      universes.add(fixture.universe);
    }
    return Array.from(universes).sort((a, b) => a - b);
  });

  /** Total number of 512-channel universes the engine buffer can hold. */
  const totalUniverses = computed(() => {
    return Math.max(1, Math.ceil(engine.dmxBuffer.length / 512));
  });

  // Trigger reactive updates when the buffer grows after WASM render
  const bufferLength = ref(512);
  /** Incremented every render frame — lets fader computeds track individual DMX byte changes. */
  const bufferRevision = ref(0);
  watch(() => engine.dmxBuffer.length, (len) => {
    bufferLength.value = len;
  });

  const reactiveTotalUniverses = computed(() => {
    return Math.max(1, Math.ceil(bufferLength.value / 512));
  });

  // ── Binary packet cache + revision counters ───────────────────────────────

  let layoutPacket:   Uint8Array = new Uint8Array(0);
  let channelsPacket: Uint8Array = new Uint8Array(0);
  let modifiersPacket: Uint8Array = new Uint8Array(0);
  /** Plugin table (index → hash) of the current modifiers packet. */
  let modifierPlugins: string[] = [];

  const layoutRevision   = ref(0);
  const channelsRevision = ref(0);
  const effectsRevision  = ref(0);

  // ── Override layer ────────────────────────────────────────────────────────

  /**
   * Priority 1 (highest): Manual channel overrides from the Simple Desk.
   * Key = 0-based buffer index, value = 0–255.
   * Future layers (programmer, background) will be inserted below this.
   */
  const overrideMap = shallowRef(new Map<number, number>());

  /** SSR-safe accessor — Pinia hydration can strip Map objects to undefined. */
  function getOverrideMap(): Map<number, number> {
    return overrideMap.value ?? new Map();
  }

  /** Mixed output buffer (all layers combined). Read by faders + connectors. */
  let outputBuffer = new Uint8Array(0);
  /** Accessor for the current mixed output buffer (not reactive — use bufferRevision). */
  function getOutputBuffer(): Uint8Array { return outputBuffer; }

  /**
   * Flush any queued, unsent pushChange commands. Set inside loadProject when
   * persistence hooks are wired up. Call from drag-end / unmount / beforeunload
   * to ensure no commands are lost in the settle window.
   */
  let commitPendingChanges: () => Promise<void> = async () => {};
  function commitPendingPersistence() { return commitPendingChanges(); }
  /**
   * Force an immediate snapshot save (flush persist queue + save-snapshot).
   * Used by the public patch share so the shared link reflects current state.
   * No-op until a project is loaded (hooks wired in loadProject).
   */
  function saveSnapshotNow() { return triggerSaveSnapshotInternal(); }

  // ── Time-triggered snapshot persistence ───────────────────────────────────
  // The snapshot captures all "live" state that has no dedicated Command
  // (BPM, direct channel mutations, in-flight modifier params, etc.). It is
  // the safety net that bounds how stale a reload can be. Triggered by:
  //   - 10s of idle after the last dirty mark, OR
  //   - 30s hard cap during continuous editing.
  let engineDirty = false;
  let snapshotInFlight = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let hardCapTimer: ReturnType<typeof setTimeout> | null = null;
  let persistenceHooksReady = false;
  let triggerSaveSnapshotInternal: () => Promise<void> = async () => {};
  const SNAPSHOT_IDLE_MS = 10_000;
  const SNAPSHOT_HARDCAP_MS = 30_000;

  function markEngineDirty() {
    engineDirty = true;
    // Setting the flag pre-wiring is harmless — the first dirty event after
    // loadProject() finishes wiring will arm both timers.
    if (!persistenceHooksReady) return;
    if (idleTimer != null) clearTimeout(idleTimer);
    idleTimer = setTimeout(flushSnapshotIfDirty, SNAPSHOT_IDLE_MS);
    if (hardCapTimer == null) {
      hardCapTimer = setTimeout(flushSnapshotIfDirty, SNAPSHOT_HARDCAP_MS);
    }
  }

  async function flushSnapshotIfDirty() {
    if (snapshotInFlight) {
      // Leave dirty=true; whichever timer fires after the in-flight save will retry.
      return;
    }
    if (idleTimer != null) { clearTimeout(idleTimer); idleTimer = null; }
    if (hardCapTimer != null) { clearTimeout(hardCapTimer); hardCapTimer = null; }
    if (!engineDirty) return;
    engineDirty = false;
    snapshotInFlight = true;
    try {
      await triggerSaveSnapshotInternal();
    } catch (err) {
      console.warn('[engine] time-triggered snapshot failed:', err);
      engineDirty = true; // retry on next dirty mark
    } finally {
      snapshotInFlight = false;
    }
  }

  function setOverride(bufferIndex: number, value: number) {
    const next = new Map(getOverrideMap());
    next.set(bufferIndex, Math.max(0, Math.min(255, Math.round(value))));
    overrideMap.value = next;
  }

  function clearOverride(bufferIndex: number) {
    const cur = getOverrideMap();
    if (!cur.has(bufferIndex)) return;
    const next = new Map(cur);
    next.delete(bufferIndex);
    overrideMap.value = next;
  }

  function clearAllOverrides() {
    overrideMap.value = new Map();
    resetFixtureChannels(flatFixtures.value);
    // Route effects clear through history so it's pushed to the Supabase tail
    // and survives page reloads. Without this, the tail still contains the
    // SetModifiers command that added the effect, which gets replayed on load.
    const before = cloneModifiers(modifiers.value);
    const history = useHistory();
    history.execute(new SetModifiersCommand(engine, before, [], 'Clear all'));
  }

  function clearUniverseOverrides(universe: number) {
    const start = (universe - 1) * 512;
    const end = start + 512;
    const next = new Map(getOverrideMap());
    for (const key of next.keys()) {
      if (key >= start && key < end) next.delete(key);
    }
    overrideMap.value = next;
  }

  // ── Render loop state ─────────────────────────────────────────────────────

  // Extension scope views re-project when the (mostly non-reactive) model changes.
  watch([layoutRevision, channelsRevision, sceneNodes], bumpModelTick);

  const clockEpoch = ref(Date.now());
  function setClockEpoch(ms: number) { clockEpoch.value = ms; engine.postEpoch(ms); }

  let initialized = false;
  let animFrameId: number;
  let lastDispatchedLayout   = -1;
  let lastDispatchedChannels = -1;
  let lastDispatchedEffects  = -1;
  /** Cheap fingerprint of layout-relevant fixture data — used to skip buildLayoutBin
   *  when only channel values changed (the common case during preset/flash transitions). */
  let lastLayoutFingerprint = '';

  /**
   * Rebuild all three binary packets (layout / channels / effects) from current
   * state and bump revisions so the next dispatch picks them up. Layout build
   * is skipped via fingerprint compare unless layout-relevant fields changed.
   *
   * Replaces the two deep `watch(flatFixtures, …, { deep: true })` watchers
   * that used to fire on any nested mutation — those traversed the entire
   * fixture graph to track Vue dependencies, which became measurable per
   * preset switch. Now any caller that mutates fixtures must invoke this
   * explicitly (or use `flushEngineOutput` / `markChannelsDirty`).
   */
  function rebuildLayoutAndChannels(): void {
    let fp = '';
    for (const f of flatFixtures.value) {
      // positionZ/tiltX/rollZ are 3D-only (the worker layout ignores them) but
      // are included so layoutRevision doubles as the 3D scene's rebuild signal.
      fp += `${f.id};${f.startAddress};${f.fixturePosition.x};${f.fixturePosition.y};${f.rotation ?? 0};${f.positionZ ?? 0};${f.tiltX ?? 0};${f.rollZ ?? 0};${f.fixtureSize.x};${f.fixtureSize.y};`;
      // Kind geometry (curves, shapes) moves beams without changing channels
      // or the AABB, so the config must bust the layout cache too.
      if (f.kind) fp += `k${JSON.stringify(f.kind.config)};`;
      for (const ch of f.channels) {
        fp += `${ch.addressOffset};${ch.type};${ch.beamId ?? ''};${ch.rangeMin ?? 0};${ch.rangeMax ?? 255};`;
      }
      fp += '|';
    }
    if (fp !== lastLayoutFingerprint) {
      lastLayoutFingerprint = fp;
      layoutPacket = trace('packet.layout', () => buildLayoutBin(flatFixtures.value));
      layoutRevision.value++;
    }
    channelsPacket = trace('packet.channels', () => buildChannelsBin(flatFixtures.value));
    channelsRevision.value++;
    ({ packet: modifiersPacket, plugins: modifierPlugins } = trace('packet.modifiers', () =>
      buildModifiersBin(modifiers.value, flatFixtures.value, getManifest)));
    ensurePluginsLoaded(modifierPlugins);
    resolveUnknownPlugins(modifiers.value);
    effectsRevision.value++;
  }

  /**
   * Sends plugin modules the worker does not have yet. When a module arrives
   * the worker re-prepares instances that were disabled for lack of it.
   */
  function ensurePluginsLoaded(hashes: string[]): void {
    for (const hash of hashes) {
      if (engine.hasPlugin(hash)) continue;
      void loadWasm(hash).then((wasm) => {
        if (wasm && !engine.hasPlugin(hash)) engine.loadPlugin(hash, wasm);
      });
    }
  }

  /**
   * Resolves plugins referenced by modifiers whose manifest is unknown here
   * (shared projects, live collaboration). The modifiers packet skips such
   * instances; once a plugin resolves the packet is rebuilt.
   */
  function resolveUnknownPlugins(list: readonly import('~/utils/engine/types').ModifierInstance[]): void {
    for (const m of list) {
      // Known, or already failed (no retry storm on every flush).
      if (getManifest(m.plugin) || resolveErrors.value.has(m.plugin)) continue;
      void resolvePlugin(m.plugin).then((known) => {
        if (known) flushEngineOutput();
      });
    }
  }

  const initEngine = async () => {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;

    // Wait for WASM to be fully loaded before setting up watches and render loop
    await engine.ready;

    const history = useHistory();
    const connectionsStore = useConnectionsStore();
    const liveStore = useLiveModeStore();

    // Clear overwrite stack on page switch (avoids stuck overwrite after navigation).
    watch(() => liveStore.activePageId, () => {
      overwriteStack.value.splice(0);
    });

    // Sync UI trigger on history undo/redo. Also re-flush the engine pipeline
    // since the deep-watcher rebuilds are gone — without an explicit flush
    // here, undoing a fixture/effect change wouldn't propagate to WASM.
    watch(() => history.version.value, () => {
      triggerRef(sceneNodes);

      // History undo/redo replaces the effects array entirely in SetModifiersCommand
      if (engine.modifiers !== modifiers.value) {
        modifiers.value.splice(0, modifiers.value.length, ...engine.modifiers);
        engine.modifiers = modifiers.value;
      }

      flushEngineOutput();
    });

    // Create default fixtures
    const COLS = 5;
    const ROWS = 4;
    const fixtureCount = COLS * ROWS;
    const stepX = 0.04;
    const stepY = 0.06;
    const startX = 0.5 - (9 * stepX) / 2;
    const startY = 0.5 - (3 * stepY) / 2;

    const fixtures = Array.from({ length: fixtureCount }, (_, i) => {
      const row = Math.floor(i / COLS);
      const col = i % COLS;

      const fixture = Fixture.createRGBFixture(i);
      fixture.startAddress = (i * 4) + 1;

      if (i === 0) fixture.name = 'Front Left';
      if (i === 9) fixture.name = 'Front Right';
      if (i === 30) fixture.name = 'Back Left';
      if (i === 39) fixture.name = 'Back Right';

      fixture.fixturePosition = {
        x: startX + col * stepX,
        y: startY + row * stepY,
      };
      fixture.fixtureSize = { x: 1, y: 1 };
      return fixture;
    });

    sceneNodes.value = [...fixtures];

    // Auto-sync global bases into channel stepValues
    watchEffect(() => {
      for (const fixture of flatFixtures.value) {
        for (const channel of fixture.channels) {
          const base = globalBases.value[channel.type];
          if (base !== undefined) {
            const isProgrammed = channel.chaserConfig.isPlaying || channel.chaserConfig.stepValues.some((v: number) => v !== 0);
            if (!isProgrammed) {
              channel.chaserConfig.stepValues[0] = base;
            }
          }
        }
      }
    });

    // Initial packet build after default fixtures have been created. Subsequent
    // rebuilds happen explicitly from `_doFlush()` (preset/flash/color paths),
    // `markChannelsDirty()` (drag paths), or direct callers of
    // `flushEngineOutput()` (fixture add/remove/move/address-edit, undo/redo,
    // project load). The two old deep watchers on `flatFixtures` have been
    // replaced with these explicit calls to avoid the Vue dependency-traversal
    // cost on every channel mutation.
    rebuildLayoutAndChannels();

    // globalBases bakes into stepValues via watchEffect above; an explicit watch
    // here ensures channelsPacket rebuilds after the globalBases watchEffect runs.
    watch(globalBases, () => {
      channelsPacket = buildChannelsBin(flatFixtures.value);
      channelsRevision.value++;
    }, { deep: true });

    // Sync BPM changes to the worker engine
    watch(engine.globalBpm, (bpm) => engine.postBpm(bpm));

    // Derive effective BPM from base × multiplier (multiplier === 0 → freeze)
    watch([baseBpm, speedMultiplier], ([base, mult]) => {
      engine.globalBpm.value = base * mult;
    });

    // Built-in modifier plugins are loaded up front so adding one is instant.
    ensurePluginsLoaded(BUILTIN_PLUGINS.map(p => p.hash));

    // Plugin runtime events: errors disable the instance in the worker; tell the user.
    engine.isTrustedPlugin = isBuiltinHash;
    engine.onPluginEvent = (ev) => {
      if (ev.type === 'plugin-error') {
        notify({ variant: 'error', title: 'Modifier stopped', description: ev.message });
      }
      else if (import.meta.dev) {
        console.info(`[plugin ${ev.hash.slice(7, 15)}] ${ev.message}`);
      }
    };
    engine.onRespawn = (suspended) => {
      notify({
        variant: 'warning',
        title: 'Engine restarted',
        description: suspended.length > 0
          ? `The render engine stopped responding. ${suspended.length} generated modifier(s) were suspended.`
          : 'The render engine stopped responding and was restarted.',
      });
    };

    // Live-value hub (extension API): channel addresses are cached per layout
    // revision so per-frame lookups are O(1).
    let addressCacheRevision = -1;
    const addressCache = new Map<string | number, Fixture>();
    liveHub.configure({
      resolveChannelAddress(fixtureId, channelIndex) {
        if (addressCacheRevision !== layoutRevision.value) {
          addressCache.clear();
          for (const f of flatFixtures.value) addressCache.set(f.id, f);
          addressCacheRevision = layoutRevision.value;
        }
        const fixture = addressCache.get(fixtureId);
        const ch = fixture?.channels[channelIndex];
        return fixture && ch ? fixture.startAddress + ch.addressOffset : null;
      },
      beatSource: () => ({ bpm: engine.globalBpm.value, clockEpoch: clockEpoch.value }),
      // Signature tuples are read by the worker; fixtures map to their layout
      // group index (position in flatFixtures).
      requestSignatures(targets, generation) {
        const index = new Map(flatFixtures.value.map((f, i) => [f.id, i]));
        const ids = { scalar: 0, rgb: 1, panTilt: 2 } as const;
        const flat = new Uint32Array(targets.length * 2);
        targets.forEach((t, i) => {
          flat[i * 2] = index.get(t.fixtureId) ?? 0xffffffff;
          flat[i * 2 + 1] = ids[t.signature];
        });
        engine.requestSignatures(flat, generation);
      },
    });
    // Group indexes change with the layout.
    watch(layoutRevision, () => liveHub.refreshSignatureRequests());

    // Frame-receive handler: called by the worker engine on every rendered frame.
    // Runs off the main-thread render loop — Vue cascade can't block it.
    engine.onFrame = (dmx: Uint8Array, elapsedMs: number, signatures?: SignatureFrame) => {
      bufferLength.value = dmx.length;
      bufferRevision.value++;
      currentElapsed.value = elapsedMs;

      const overrides = getOverrideMap();
      if (overrides.size === 0) {
        // dmx comes from a transferred ArrayBuffer — safe to use directly
        outputBuffer = new Uint8Array(dmx.buffer as ArrayBuffer, dmx.byteOffset, dmx.byteLength);
      } else {
        if (outputBuffer.length !== dmx.length) outputBuffer = new Uint8Array(dmx.length);
        outputBuffer.set(dmx);
        for (const [idx, val] of overrides) {
          if (idx < outputBuffer.length) outputBuffer[idx] = val;
        }
      }

      connectionsStore.sendFrame(outputBuffer);
      // Extension live values (no-op without subscribers).
      liveHub.ingest(outputBuffer, elapsedMs, Date.now(), signatures);
      try {
        connectionsStore.notifyEngineState({
          bpm: engine.globalBpm.value,
          elapsedMs,
          layoutRevision: layoutRevision.value,
          channelsRevision: channelsRevision.value,
          effectsRevision: effectsRevision.value,
          layoutPacket,
          channelsPacket,
          effectsPacket: modifiersPacket,
          dmxBuffer: outputBuffer,
          fixtures: flatFixtures.value,
          modifiers: modifiers.value,
          blendMode: engine.stackBlendMode.value,
        });
      } catch (e) {
        console.warn('[engine] notifyEngineState threw:', e);
      }
    };

    // Lightweight rAF loop: only dispatches changed packets to the worker.
    // The worker renders independently — this loop exists solely so that
    // markChannelsDirty() drag updates reach the worker within one frame.
    const renderLoop = () => {
      const lr = layoutRevision.value;
      const cr = channelsRevision.value;
      const er = effectsRevision.value;
      if (lr !== lastDispatchedLayout)   { engine.dispatch(TYPE_LAYOUT_BIN,  layoutPacket.subarray(5));  lastDispatchedLayout   = lr; }
      if (cr !== lastDispatchedChannels) { engine.dispatch(TYPE_CHAN_BIN,     channelsPacket.subarray(5)); lastDispatchedChannels = cr; }
      if (er !== lastDispatchedEffects)  { engine.syncModifiers(modifiersPacket.subarray(5), modifierPlugins); lastDispatchedEffects = er; }
      animFrameId = requestAnimationFrame(renderLoop);
    };

    animFrameId = requestAnimationFrame(renderLoop);
  };

  /**
   * Inner flush: rebuild packets and dispatch to the worker engine.
   * The worker renders and posts frames back via onFrame — no render/sendFrame here.
   */
  function _doFlush(): void {
    trace('flush.rebuild', rebuildLayoutAndChannels);
    trace('flush.dispatch', () => {
      if (layoutRevision.value !== lastDispatchedLayout) {
        engine.dispatch(TYPE_LAYOUT_BIN, layoutPacket.subarray(5));
        lastDispatchedLayout = layoutRevision.value;
      }
      engine.dispatch(TYPE_CHAN_BIN, channelsPacket.subarray(5));
      lastDispatchedChannels = channelsRevision.value;
      engine.syncModifiers(modifiersPacket.subarray(5), modifierPlugins);
      lastDispatchedEffects  = effectsRevision.value;
    });
  }

  // Leading + trailing throttle: first call in a frame runs immediately (low
  // latency), subsequent calls within the same rAF window are coalesced into
  // one trailing flush so the last state is always sent without spam-flooding
  // the main thread.
  let _flushScheduled = false;
  let _flushPending   = false;

  function flushEngineOutput(): void {
    if (!initialized) return;
    if (_flushScheduled) {
      _flushPending = true;
      return;
    }
    _flushScheduled = true;
    _doFlush();
    requestAnimationFrame(() => {
      _flushScheduled = false;
      if (_flushPending) {
        _flushPending = false;
        flushEngineOutput();
      }
    });
  }

  const triggerCanvasSync = () => {
    flushEngineOutput();
  };

  /**
   * Lightweight alternative to triggerCanvasSync for use during continuous
   * drags (e.g. color wheel). Rebuilds the channels binary packet and bumps
   * the revision so the rAF render loop picks it up on the next frame — without
   * doing an immediate WASM dispatch, render, or notifyEngineState call.
   * This avoids doubling hardware/network messages at 60fps during drag.
   */
  function markChannelsDirty(): void {
    if (!initialized) return;
    channelsPacket = buildChannelsBin(flatFixtures.value);
    channelsRevision.value++;
  }

  // ── Project persistence ───────────────────────────────────────────────────

  const currentProjectId = ref<string | null>(null);
  const projectLoading = ref(false);
  const projectError = ref<'unauthorized' | 'error' | 'incompatible' | null>(null);

  // Register SetModifiers replay here to avoid circular imports
  registerCommand('SetModifiers', (payload, _ctx) => {
    const before = cloneModifiers(payload.before ?? []);
    const after  = cloneModifiers(payload.after  ?? []);
    return new SetModifiersCommand(engine, before, after, 'SetModifiers (replay)');
  });

  function getReplayContext(): ReplayContext {
    return {
      sceneNodes: sceneNodes.value,
      flatFixtures: flatFixtures.value,
      modifiers: modifiers.value,
      savedPresets: savedPresets.value,
      setSavedPresets: (p) => { savedPresets.value = p; },
      getSelectedPresetId: () => selectedPresetId.value,
      setSelectedPresetId: (id) => { selectedPresetId.value = id; },
    };
  }

  function applyProjectSnapshot(snapshot: ProjectSnapshot) {
    const connectionsStore = useConnectionsStore();
    connectionsStore.restoreFromSnapshots(snapshot.connectors ?? []);
    const { sceneNodes: nodes, savedPresets: presets, globalBases: bases, modifiers: effects, livePages, selectedPresetId: restoredPresetId, globalBpm: restoredBpm, clockEpoch: restoredEpoch, activeSectionMembers: restoredSectionMembers, savedPositions: restoredPositions } = deserializeProject(snapshot);
    sceneNodes.value = nodes;
    savedPresets.value = presets;
    globalBases.value = bases;
    modifiers.value = effects;
    engine.modifiers = modifiers.value;
    selectedPresetId.value = restoredPresetId;
    // Restore global engine state captured in the snapshot (BPM + shared clock).
    // Snapshot stores the effective BPM at save time; treat it as the base.
    // The persistent `engine.speed` live-op will re-apply any latched multiplier.
    baseBpm.value = restoredBpm;
    speedMultiplier.value = 1;
    engine.globalBpm.value = restoredBpm;
    engine.postBpm(restoredBpm);
    clockEpoch.value = restoredEpoch;
    engine.postEpoch(restoredEpoch);
    triggerRef(sceneNodes);
    // Load live pages SYNCHRONOUSLY so the tail replay (which runs immediately
    // after this in loadProject) sees the pages and can mutate them. Earlier
    // dynamic-import version dropped any tail live-widget commands silently.
    const liveStore = useLiveModeStore();
    liveStore.loadPages(livePages);
    // Restore latched section state so buttons remain lit after reload.
    // loadPages resets activeSectionMembers — this re-populates it from snapshot.
    liveStore.activeSectionMembers = new Map(
      Object.entries(restoredSectionMembers).map(([k, v]) => [k, new Set(v)]),
    );
    liveStore.loadLiveControllers(snapshot.liveControllers ?? []);
    liveStore.loadPositions(restoredPositions);
    // Reset the worker engine so no stale state from a previous project leaks
    // into the first frames, then dispatch fresh packets.
    engine.reset();
    flushEngineOutput();
  }

  async function loadProject(projectId: string) {
    const supabase = useSupabaseClient();
    const runtimeConfig = useRuntimeConfig();
    currentProjectId.value = projectId;
    projectLoading.value = true;
    projectError.value = null;

    // Reset snapshot timer state in case a previous project was loaded.
    if (idleTimer != null) { clearTimeout(idleTimer); idleTimer = null; }
    if (hardCapTimer != null) { clearTimeout(hardCapTimer); hardCapTimer = null; }
    engineDirty = false;
    snapshotInFlight = false;
    persistenceHooksReady = false;
    // Clear persist queue from any previous project and remove the old hook so
    // stale entries cannot be flushed against the new project's connection.
    clearPersistQueue();
    setPersistHook(null);
    setPersistAckHook(null);

    // ── WAL Recovery ────────────────────────────────────────────────────────
    // Push any pending changes that survived a crash / failed unload from a
    // previous session BEFORE loading the snapshot+tail. The push-change edge
    // function is idempotent via (project_id, change_id) so re-pushing an entry
    // that already made it last time is safe — the server returns the existing
    // sequence_number. We then drop the WAL entries that the server confirmed.
    try {
      const pending = await walGetPending(projectId);
      if (pending.length > 0) {
        console.info(`[engine] WAL recovery: pushing ${pending.length} unacked change(s)`);
        const { data: recData, error: recErr } = await supabase.functions.invoke('push-change', {
          body: {
            projectId,
            changes: pending.map(e => ({
              commandType: e.commandType,
              payload: e.payload,
              changeId: e.id,
            })),
          },
        });
        if (recErr) throw recErr;
        // Only ack the entries the server confirmed. Filter out null/undefined
        // (one row failed → keep that one in the WAL for next retry).
        const returnedIds: Array<string | undefined> = recData?.changeIds ?? [];
        const ackedIds = returnedIds.filter((id): id is string => typeof id === 'string');
        // Edge case: server didn't return changeIds at all (e.g. old function
        // pre-deployment). Then assume all pending entries made it.
        const toAck = ackedIds.length > 0 || returnedIds.length > 0
          ? ackedIds
          : pending.map(e => e.id);
        await walMarkAcked(toAck);
      }
    } catch (err) {
      // Don't block the load on recovery failure — degrade gracefully. The WAL
      // entries stay; the next attempt (or the next reload) will retry.
      console.error('[engine] WAL recovery failed — proceeding with possibly stale state:', err);
    }

    const { data, error } = await supabase.functions.invoke('load-project', {
      body: { projectId },
    });
    if (error || !data) {
      console.error('[engine] loadProject failed:', error);
      projectLoading.value = false;
      const status = error?.context?.status ?? 0;
      if (status === 401) {
        const router = useRouter();
        await supabase.auth.signOut();
        router.push(`/auth/login?redirect=/project/${projectId}`);
      } else if (status === 403) {
        projectError.value = 'unauthorized';
      } else {
        projectError.value = 'error';
      }
      return;
    }

    // Clear default fixtures so the project starts from a clean slate
    sceneNodes.value = [];
    savedPresets.value = [];
    selectedPresetId.value = null;

    // Disconnect any hardware-controller instances from the previous project
    // so MIDI/HID ports don't leak across project loads. Bindings cleared too.
    await useControllerStore().reset();
    // Same idea for output connectors — kill their websockets + retry timers
    // before applyProjectSnapshot() recreates the (possibly differently-shaped)
    // connector list from the new project's snapshot.
    await useConnectionsStore().reset();

    // Apply the base snapshot if present. Version-1 projects are rejected (ADR D24).
    if (data.snapshot) {
      try {
        applyProjectSnapshot(data.snapshot);
      }
      catch (err) {
        if (err instanceof IncompatibleProjectError) {
          console.warn('[engine] incompatible project snapshot:', err.found);
          projectError.value = 'incompatible';
          projectLoading.value = false;
          return;
        }
        throw err;
      }
    }

    // Replay the tail: changes after the snapshot's sequence_number.
    // The tail may contain two kinds of records:
    //   1. History commands (Undo-able ops) — replayed via the command registry.
    //   2. Persistent live-ops (BPM, modifier scrubs, color overrides, section
    //      latches, …) — replayed via the live-op registry. These are written
    //      to project_changes by the LiveBus persist queue and were NOT in the
    //      tail before this architectural change.
    const tail: Array<{ command_type: string; payload: any; sequence_number: number; user_id: string }> = data.tail ?? [];
    // Build a minimal LiveContext for replaying live-ops without a realtime
    // channel. We only need the engineStore reference; awareness fields are
    // empty because replay happens before any collaborators are present.
    const replayLiveCtx: LiveContext = {
      cursors: new Map(),
      remoteSelections: new Map(),
      remoteEditingModifier: new Map(),
      remoteEditSteps: new Map(),
      remoteCameras: new Map(),
      triggerCursorUpdate: () => {},
      triggerSelectionUpdate: () => {},
      triggerEditingModifierUpdate: () => {},
      triggerEditStepUpdate: () => {},
      triggerCameraUpdate: () => {},
      displayNameOf: () => '',
      colorOf: () => '',
      engineStore: useEngineStore(),
    };
    for (const change of tail) {
      // Try history command registry first
      const cmd = commandFromPayload(change.command_type, change.payload, getReplayContext());
      if (cmd) { cmd.execute(); continue; }

      // Fall back to live-op registry
      const liveOp = getLiveOpConfig(change.command_type);
      if (liveOp) {
        try {
          liveOp.apply(change.payload, change.user_id ?? '', replayLiveCtx, '');
        } catch (e) {
          console.warn(`[loadProject] live-op replay failed for "${change.command_type}":`, e);
        }
        continue;
      }

      console.warn(`[loadProject] no handler for tail entry "${change.command_type}"`);
    }
    if (tail.length > 0) {
      lastSeenSequenceNumber.value = tail[tail.length - 1].sequence_number;
    } else if (data.snapshot?.sequence_number) {
      lastSeenSequenceNumber.value = data.snapshot.sequence_number;
    }
    triggerRef(sceneNodes);

    // Auto-connect controllers that were persisted with the project.
    // Fire-and-forget: MIDI access is async and non-blocking.
    {
      const controllerStore = useControllerStore();
      const liveStore = useLiveModeStore();
      for (const inst of liveStore.liveControllers) {
        const driver = controllerStore.createDriver(inst.id, inst.definitionKey);
        if (driver) driver.connect().catch((e: unknown) => console.warn('[engine] auto-connect failed:', inst.id, e));
      }
    }

    // Auto-connect WebSocket strip connectors that are fully configured. One
    // attempt per connector; the per-connector autoReconnect flag arms only on
    // a successful 'connected', so failed initial attempts leave the card
    // showing "Verbinden" instead of spinning forever. Serial is intentionally
    // skipped — requestPort() needs a user gesture.
    for (const c of useConnectionsStore().connectors) {
      if (c instanceof WebSocketConnector && c.url.value && c.fixtureId != null) {
        c.connect().catch((e: unknown) => console.warn('[engine] ws auto-connect failed:', c.id, e));
      }
      if (c instanceof ArtNetConnector && c.bridgeUrl.value) {
        c.connect().catch((e: unknown) => console.warn('[engine] artnet auto-connect failed:', c.id, e));
      }
    }

    // ── Persistence: unified queue ──────────────────────────────────────────
    // Both history commands AND persistent live-ops flow through the LiveBus
    // persist queue. A single in-flight guard there serializes the push-change
    // round-trip; `lastSeenSequenceNumber` is updated synchronously inside the
    // hook, so any caller awaiting flushPersistQueue() sees an accurate value
    // before reading it. This is the architectural fix for the
    // race-against-snapshot bug that produced stale-state reloads.

    async function persistBatch(
      entries: Array<{ type: string; payload: any; changeId?: string }>,
    ): Promise<Array<number | undefined>> {
      const { data, error } = await supabase.functions.invoke('push-change', {
        body: {
          projectId,
          changes: entries.map(e => ({
            commandType: e.type,
            payload: e.payload,
            changeId: e.changeId,
          })),
        },
      });
      if (error) throw error;
      const seqs: number[] = (data?.sequenceNumbers ?? []).filter((s: any) => s != null);
      const maxSeq = seqs.length ? Math.max(...seqs) : undefined;
      if (maxSeq != null && maxSeq > lastSeenSequenceNumber.value) {
        lastSeenSequenceNumber.value = maxSeq;
      }
      return data?.sequenceNumbers ?? [];
    }
    setPersistHook(persistBatch);
    // ACK hook: when the server confirms a batch, drop the matching WAL entries
    // so they aren't re-pushed on the next reload's recovery pass.
    setPersistAckHook((changeIds) => {
      walMarkAcked(changeIds).catch(err =>
        console.warn('[engine] walMarkAcked failed:', err));
    });
    commitPendingChanges = flushPersistQueue;

    // Build a snapshot of the full project state. The caller must drain the
    // persist queue first (via flushPersistQueue) so lastSeenSequenceNumber
    // matches the state about to be captured.
    function buildSnapshot() {
      const pinnedStore = usePinnedModifiersStore();
      const liveStore = useLiveModeStore();
      const connectionsStore = useConnectionsStore();
      return serializeProject(
        sceneNodes.value,
        savedPresets.value,
        pinnedStore.pinnedModifiers,
        globalBases.value,
        modifiers.value,
        liveStore.pages,
        liveStore.liveControllers,
        selectedPresetId.value,
        connectionsStore.getSnapshots(),
        engine.globalBpm.value,
        clockEpoch.value,
        Object.fromEntries(
          [...liveStore.activeSectionMembers.entries()].map(([k, v]) => [k, [...v]]),
        ),
        liveStore.savedPositions,
      );
    }

    async function doSaveSnapshot() {
      await flushPersistQueue();
      const snapshot = buildSnapshot();
      await supabase.functions.invoke('save-snapshot', {
        body: {
          projectId,
          snapshot,
          sequenceNumber: lastSeenSequenceNumber.value,
        },
      });
    }

    // History commands flow into the same persist queue. Each one carries its
    // own resolve/reject so use-history can still chain its snapshot-threshold
    // logic off the returned sequence number. History commands are append-only
    // (no dedup) — every undo-able op is recorded individually.
    setPersistenceHooks({
      pushChange: (commandType, payload, changeId) =>
        new Promise<number | undefined>((resolve, reject) => {
          enqueuePersist({ type: commandType, payload, changeId, resolve, reject });
        }),
      saveSnapshot: doSaveSnapshot,
      markDirty: markEngineDirty,
      walAppend: (entry) => walAppend(entry),
      currentProjectId: () => currentProjectId.value,
    });

    // Allow markEngineDirty() to arm its timers and bind the snapshot trigger
    // to the just-wired hook.
    triggerSaveSnapshotInternal = doSaveSnapshot;
    persistenceHooksReady = true;
    // If a live op fired during loadProject (before hooks were ready), the
    // dirty flag is set but no timer is armed. Arm them now.
    if (engineDirty) markEngineDirty();

    projectLoading.value = false;

    // Cache the JWT so the unload handler can use it synchronously.
    // keepalive fetch requires a token at fire time, not after an async getSession().
    let cachedToken = (await supabase.auth.getSession()).data.session?.access_token ?? '';
    supabase.auth.onAuthStateChange((_, session) => {
      if (session?.access_token) cachedToken = session.access_token;
    });
    const supabaseUrl: string = (runtimeConfig.public as any).supabase?.url
      ?? (supabase as any).supabaseUrl
      ?? '';
    const pushChangeUrl = `${supabaseUrl}/functions/v1/push-change`;
    const saveSnapshotUrl = `${supabaseUrl}/functions/v1/save-snapshot`;

    // On unload: best-effort keepalive push so the next reload's WAL recovery
    // has less work. CORRECTNESS no longer depends on this fetch succeeding —
    // every entry in the persist queue ALSO has a WAL row in IndexedDB, and
    // those are reconciled on the next loadProject() via the idempotent
    // push-change endpoint. We therefore deliberately DO NOT clearPersistQueue()
    // here: if the keepalive is dropped (browser limit, network), the entries
    // stay in memory; if the tab actually closes, the WAL takes over.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        if (idleTimer != null) { clearTimeout(idleTimer); idleTimer = null; }
        if (hardCapTimer != null) { clearTimeout(hardCapTimer); hardCapTimer = null; }
        if (!cachedToken) return;

        // (a) Optimistic keepalive push — passes changeIds so the server can
        // dedupe against entries that were already written by an in-flight
        // batch and against the next session's WAL recovery.
        const pending = getPersistQueueSnapshot();
        if (pending.length > 0) {
          const changesBody = JSON.stringify({
            projectId,
            changes: pending.map(e => ({
              commandType: e.type,
              payload: e.payload,
              changeId: e.changeId,
            })),
          });
          fetch(pushChangeUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cachedToken}`, 'Content-Type': 'application/json' },
            body: changesBody,
            keepalive: true,
          });
        }

        // (b) Final snapshot — but ONLY if there are no pending entries left.
        //
        // If there are pending entries, the keepalive push above will (on
        // success) assign them sequence numbers > lastSeenSequenceNumber, while
        // the snapshot we'd send here was built from in-memory state that
        // ALREADY includes those commands' effects but carries the stale
        // lastSeenSequenceNumber. On reload, tail = `> stale-seq` would replay
        // those commands → double-apply for non-idempotent ops like AddFixtures.
        //
        // Skipping the snapshot in that case is safe because:
        //   - Every SerializableCommand is in the WAL → recovered next load.
        //   - The pending entries themselves carry changeIds → idempotent
        //     against the keepalive push above.
        //   - Tail replay from the last committed snapshot rebuilds state.
        if (engineDirty && pending.length === 0) {
          try {
            const snapshot = buildSnapshot();
            const snapBody = JSON.stringify({
              projectId,
              snapshot,
              sequenceNumber: lastSeenSequenceNumber.value,
            });
            fetch(saveSnapshotUrl, {
              method: 'POST',
              headers: { Authorization: `Bearer ${cachedToken}`, 'Content-Type': 'application/json' },
              body: snapBody,
              keepalive: true,
            });
          } catch (err) {
            console.warn('[engine] beforeunload snapshot failed:', err);
          }
        }
      }, { once: true });
    }
  }

  return {
    savedPresets,
    selectedPresetId,
    flashStack,
    effectivePresetId,
    overwriteStack,
    effectiveOverwrite,
    pressOverwrite,
    releaseOverwrite,
    clearOverwriteStack,
    clockEpoch,
    setClockEpoch,
    baseBpm,
    speedMultiplier,
    setSpeedMultiplier,
    engine,
    modifiers,
    sceneNodes,
    selectedIds,
    flatFixtures,
    globalBases,
    currentElapsed,
    usedUniverses,
    totalUniverses: reactiveTotalUniverses,
    bufferRevision,
    channelsRevision,
    layoutRevision,
    overrideMap,
    setOverride,
    clearOverride,
    clearAllOverrides,
    clearUniverseOverrides,
    getOutputBuffer,
    initEngine,
    triggerCanvasSync,
    markChannelsDirty,
    flushEngineOutput,
    currentProjectId,
    projectLoading,
    projectError,
    loadProject,
    applyProjectSnapshot,
    getReplayContext,
    commitPendingPersistence,
    saveSnapshotNow,
    markEngineDirty,
  };
});
