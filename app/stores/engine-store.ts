import { defineStore } from 'pinia';
import { ref, shallowRef, computed, watch, watchEffect, markRaw, triggerRef } from 'vue';
import type { Preset } from '~/utils/engine/preset-types';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useHistory, setPersistenceHooks, lastSeenSequenceNumber } from '~/components/engine/composables/use-history';
import { useConnectionsStore } from '~/stores/connections-store';
import {
  TYPE_LAYOUT_BIN, TYPE_CHAN_BIN, TYPE_FX_BIN,
  buildLayoutBin, buildChannelsBin, buildEffectsBin,
} from '~/utils/connectors/binary-encoder';
import {
  serializeProject,
  deserializeProject,
  type ProjectSnapshot,
} from '~/utils/engine/serialize';
import { commandFromPayload, type ReplayContext } from '~/components/engine/commands/serializable-command';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useControllerStore } from '~/stores/controller-store';
import { SetModifiersCommand, cloneEffectsList } from '~/components/engine/commands/set-modifiers-command';
import { registerCommand } from '~/components/engine/commands/serializable-command';
import { resetFixtureChannels } from '~/components/engine/composables/preset-apply';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { trace } from '~/utils/perf';

export const useEngineStore = defineStore('engine', () => {
  const savedPresets = ref<Preset[]>([]);
  const selectedPresetId = ref<string | null>(null);
  /** Press-and-hold flash stack. Each entry = one held flash trigger. Top wins. */
  const flashStack = ref<Array<{ key: string; presetId: string }>>([]);
  /** The preset actually rendering: top of flash stack, or the latched base preset. */
  const effectivePresetId = computed<string | null>(() => flashStack.value.at(-1)?.presetId ?? selectedPresetId.value);

  const engine = markRaw(new EffectEngine());

  // Create a reactive array for effects that the UI can track,
  // and bind it into the engine so the render loop uses it.
  const activeEffects = ref<import('~/utils/engine/types').Effect[]>([]);
  engine.effects = activeEffects.value;

  const sceneNodes = shallowRef<SceneNode[]>([]);
  const selectedIds = shallowRef<Set<string | number>>(new Set());

  const globalBases = ref<Record<string, number>>({
    RED: 0,
    GREEN: 0,
    BLUE: 0,
    DIMMER: 255,
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
  let effectsPacket:  Uint8Array = new Uint8Array(0);

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
    const before = cloneEffectsList(activeEffects.value);
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
      fp += `${f.id};${f.startAddress};${f.fixturePosition.x};${f.fixturePosition.y};${f.rotation ?? 0};${f.fixtureSize.x};${f.fixtureSize.y};`;
      // Strip vertices feed per-pixel layout (binary-encoder.ts arc-length sampling),
      // so any polyline mutation must bust the layout cache even when the AABB
      // happens not to move.
      if (f.stripConfig) {
        fp += `s${f.stripConfig.lengthMeters}:`;
        for (const p of f.stripConfig.points) fp += `${p.x},${p.y};`;
      }
      for (const ch of f.channels) {
        fp += `${ch.addressOffset};${ch.type};${ch.beamId ?? ''};`;
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
    effectsPacket = trace('packet.effects', () =>
      buildEffectsBin(activeEffects.value, flatFixtures.value, engine.stackBlendMode.value),
    );
    effectsRevision.value++;
  }

  const initEngine = async () => {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;

    // Wait for WASM to be fully loaded before setting up watches and render loop
    await engine.ready;

    const history = useHistory();
    const connectionsStore = useConnectionsStore();

    // Sync UI trigger on history undo/redo. Also re-flush the engine pipeline
    // since the deep-watcher rebuilds are gone — without an explicit flush
    // here, undoing a fixture/effect change wouldn't propagate to WASM.
    watch(() => history.version.value, () => {
      triggerRef(sceneNodes);

      // History undo/redo replaces the effects array entirely in SetModifiersCommand
      if (engine.effects !== activeEffects.value) {
        activeEffects.value.splice(0, activeEffects.value.length, ...engine.effects);
        engine.effects = activeEffects.value;
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

    // Frame-receive handler: called by the worker engine on every rendered frame.
    // Runs off the main-thread render loop — Vue cascade can't block it.
    engine.onFrame = (dmx: Uint8Array, elapsedMs: number) => {
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
      try {
        connectionsStore.notifyEngineState({
          bpm: engine.globalBpm.value,
          elapsedMs,
          layoutRevision: layoutRevision.value,
          channelsRevision: channelsRevision.value,
          effectsRevision: effectsRevision.value,
          layoutPacket,
          channelsPacket,
          effectsPacket,
          fixtures: flatFixtures.value,
          effects: activeEffects.value,
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
      if (er !== lastDispatchedEffects)  { engine.dispatch(TYPE_FX_BIN,      effectsPacket.subarray(5));  lastDispatchedEffects  = er; }
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
      engine.dispatch(TYPE_FX_BIN, effectsPacket.subarray(5));
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
  const projectError = ref<'unauthorized' | 'error' | null>(null);

  // Register SetModifiers replay here to avoid circular imports
  registerCommand('SetModifiers', (payload, _ctx) => {
    const before = cloneEffectsList(payload.before ?? []);
    const after  = cloneEffectsList(payload.after  ?? []);
    return new SetModifiersCommand(engine, before, after, 'SetModifiers (replay)');
  });

  function getReplayContext(): ReplayContext {
    return {
      sceneNodes: sceneNodes.value,
      flatFixtures: flatFixtures.value,
      activeEffects: activeEffects.value,
      savedPresets: savedPresets.value,
      setSavedPresets: (p) => { savedPresets.value = p; },
      getSelectedPresetId: () => selectedPresetId.value,
      setSelectedPresetId: (id) => { selectedPresetId.value = id; },
    };
  }

  function applyProjectSnapshot(snapshot: ProjectSnapshot) {
    const { sceneNodes: nodes, savedPresets: presets, globalBases: bases, activeEffects: effects, livePages, selectedPresetId: restoredPresetId } = deserializeProject(snapshot);
    sceneNodes.value = nodes;
    savedPresets.value = presets;
    globalBases.value = bases;
    activeEffects.value = effects;
    engine.effects = activeEffects.value;
    selectedPresetId.value = restoredPresetId;
    triggerRef(sceneNodes);
    // Load live pages SYNCHRONOUSLY so the tail replay (which runs immediately
    // after this in loadProject) sees the pages and can mutate them. Earlier
    // dynamic-import version dropped any tail live-widget commands silently.
    const liveStore = useLiveModeStore();
    liveStore.loadPages(livePages);
    liveStore.loadLiveControllers(snapshot.liveControllers ?? []);
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

    // Apply the base snapshot if present
    if (data.snapshot) {
      applyProjectSnapshot(data.snapshot);
    }

    // Replay the tail: changes after the snapshot's sequence_number
    const tail: Array<{ command_type: string; payload: any; sequence_number: number; user_id: string }> = data.tail ?? [];
    for (const change of tail) {
      const cmd = commandFromPayload(change.command_type, change.payload, getReplayContext());
      if (cmd) cmd.execute();
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

    // ── Persistence: batched pushChange ──────────────────────────────────────
    // Commands queue locally and flush as one bulk INSERT after a short settle
    // window. A 60 Hz drag → 1 edge-function call instead of ~60.
    type PendingChange = {
      commandType: string;
      payload: object;
      resolve: (seq: number | undefined) => void;
      reject: (err: unknown) => void;
    };
    let pendingChanges: PendingChange[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_SETTLE_MS = 250;

    async function flushPendingChanges() {
      if (flushTimer != null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pendingChanges.length === 0) return;
      const batch = pendingChanges;
      pendingChanges = [];
      try {
        const { data, error } = await supabase.functions.invoke('push-change', {
          body: {
            projectId,
            changes: batch.map(c => ({ commandType: c.commandType, payload: c.payload })),
          },
        });
        if (error) throw error;
        const seqs: number[] = data?.sequenceNumbers ?? [];
        for (let i = 0; i < batch.length; i++) batch[i].resolve(seqs[i]);
      } catch (err) {
        for (const c of batch) c.reject(err);
      }
    }
    commitPendingChanges = flushPendingChanges;

    // Wire up persistence hooks so future commands are pushed to Supabase
    setPersistenceHooks({
      pushChange: (commandType, payload) =>
        new Promise<number | undefined>((resolve, reject) => {
          pendingChanges.push({ commandType, payload, resolve, reject });
          if (flushTimer != null) clearTimeout(flushTimer);
          flushTimer = setTimeout(flushPendingChanges, FLUSH_SETTLE_MS);
        }),
      saveSnapshot: async () => {
        // Drain any queued commands first so lastSeenSequenceNumber matches
        // the state the snapshot is about to capture.
        await flushPendingChanges();
        const { data: pinnedStore } = await import('~/stores/pinned-modifiers-store').then(m => ({
          data: m.usePinnedModifiersStore(),
        }));
        const liveStore = useLiveModeStore();
        const snapshot = serializeProject(
          sceneNodes.value,
          savedPresets.value,
          pinnedStore.pinnedModifiers,
          globalBases.value,
          activeEffects.value,
          liveStore.pages,
          liveStore.liveControllers,
          selectedPresetId.value,
        );
        await supabase.functions.invoke('save-snapshot', {
          body: {
            projectId,
            snapshot,
            sequenceNumber: lastSeenSequenceNumber.value,
          },
        });
      },
    });

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

    // On unload: flush any commands still waiting in the debounce window.
    // fetch({ keepalive: true }) is sent by the browser even after the page tears down,
    // unlike a normal async fetch which the browser cancels on navigation/reload.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        if (flushTimer != null) clearTimeout(flushTimer);
        if (pendingChanges.length === 0 || !cachedToken) return;
        const body = JSON.stringify({
          projectId,
          changes: pendingChanges.map(c => ({ commandType: c.commandType, payload: c.payload })),
        });
        fetch(pushChangeUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cachedToken}`, 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
      }, { once: true });
    }
  }

  return {
    savedPresets,
    selectedPresetId,
    flashStack,
    effectivePresetId,
    clockEpoch,
    setClockEpoch,
    engine,
    activeEffects,
    sceneNodes,
    selectedIds,
    flatFixtures,
    globalBases,
    currentElapsed,
    usedUniverses,
    totalUniverses: reactiveTotalUniverses,
    bufferRevision,
    channelsRevision,
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
  };
});
