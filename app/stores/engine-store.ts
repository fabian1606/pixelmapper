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
import { dispatchChannelUpdate } from '~/composables/dispatch-channel-update';
import { useLiveBusStore } from '~/stores/live-bus-store';

export const useEngineStore = defineStore('engine', () => {
  const savedPresets = ref<Preset[]>([]);
  const selectedPresetId = ref<string | null>(null);

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
  function setClockEpoch(ms: number) { clockEpoch.value = ms; }

  let initialized = false;
  let animFrameId: number;
  let startTime: number;
  let lastTime: number;
  let lastDispatchedLayout   = -1;
  let lastDispatchedChannels = -1;
  let lastDispatchedEffects  = -1;

  const initEngine = async () => {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;

    // Wait for WASM to be fully loaded before setting up watches and render loop
    await engine.ready;

    const history = useHistory();
    const connectionsStore = useConnectionsStore();

    // Sync UI trigger on history undo/redo
    watch(() => history.version.value, () => {
      triggerRef(sceneNodes);

      // History undo/redo replaces the effects array entirely in SetModifiersCommand
      if (engine.effects !== activeEffects.value) {
        activeEffects.value.splice(0, activeEffects.value.length, ...engine.effects);
        engine.effects = activeEffects.value;
      }
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

    // Watch fixture structure/positions/chaser values → rebuild layout + channels
    watch(flatFixtures, () => {
      layoutPacket   = buildLayoutBin(flatFixtures.value);
      channelsPacket = buildChannelsBin(flatFixtures.value);
      layoutRevision.value++;
      channelsRevision.value++;
      if (!useLiveBusStore().isApplyingRemote()) dispatchChannelUpdate(flatFixtures.value);
    }, { deep: true, immediate: true });

    // globalBases bakes into stepValues via watchEffect above; an explicit watch
    // here ensures channelsPacket rebuilds after the globalBases watchEffect runs.
    watch(globalBases, () => {
      channelsPacket = buildChannelsBin(flatFixtures.value);
      channelsRevision.value++;
    }, { deep: true });

    // Watch effects, fixtures, or blend mode changes → rebuild effects packet
    watch([activeEffects, flatFixtures, engine.stackBlendMode], () => {
      effectsPacket = buildEffectsBin(activeEffects.value, flatFixtures.value, engine.stackBlendMode.value);
      effectsRevision.value++;
    }, { deep: true, immediate: true });

    // Start background render loop
    startTime = performance.now();
    lastTime  = startTime;

    const renderLoop = (time: number) => {
      try {
        const elapsed = Date.now() - clockEpoch.value;
        const delta   = time - lastTime;
        lastTime = time;

        // Dispatch changed binary packets to WASM engine
        const lr = layoutRevision.value;
        const cr = channelsRevision.value;
        const er = effectsRevision.value;

        // Only mark as dispatched if WASM is ready (dispatch returns >= 0).
        // Packets are framed with a 5-byte header [AA 55 type len_lo len_hi];
        // the WASM dispatch_bin expects only the raw payload (offset 5).
        if (lr !== lastDispatchedLayout && engine.dispatch(TYPE_LAYOUT_BIN, layoutPacket.subarray(5)) >= 0) {
          lastDispatchedLayout = lr;
        }
        if (cr !== lastDispatchedChannels && engine.dispatch(TYPE_CHAN_BIN, channelsPacket.subarray(5)) >= 0) {
          lastDispatchedChannels = cr;
        }
        if (er !== lastDispatchedEffects && engine.dispatch(TYPE_FX_BIN, effectsPacket.subarray(5)) >= 0) {
          lastDispatchedEffects = er;
        }

        engine.render(elapsed, delta);
        bufferLength.value = engine.dmxBuffer.length;
        bufferRevision.value++;
        currentElapsed.value = elapsed;

        // Mix output layers: SCENE (base) → OVERRIDE (top)
        // Fast path: no overrides → alias engine.dmxBuffer directly (no copy).
        // Consumers of getOutputBuffer() are read-only; verified.
        const overrides = getOverrideMap();
        if (overrides.size === 0) {
          outputBuffer = engine.dmxBuffer;
        } else {
          // We may currently be aliasing the engine buffer — allocate a
          // separate buffer so .set() doesn't write into WASM memory.
          if (outputBuffer === engine.dmxBuffer || outputBuffer.length !== engine.dmxBuffer.length) {
            outputBuffer = new Uint8Array(engine.dmxBuffer.length);
          }
          outputBuffer.set(engine.dmxBuffer);
          for (const [idx, val] of overrides) {
            if (idx < outputBuffer.length) outputBuffer[idx] = val;
          }
        }

        connectionsStore.sendFrame(outputBuffer);
        try {
          connectionsStore.notifyEngineState({
            bpm: engine.globalBpm.value,
            elapsedMs: elapsed,
            layoutRevision: lr,
            channelsRevision: cr,
            effectsRevision: er,
            layoutPacket,
            channelsPacket,
            effectsPacket,
          });
        } catch (e) {
          console.warn('[engine] notifyEngineState threw:', e);
        }
      } catch (e) {
        console.error('[engine] render loop error:', e);
      }

      animFrameId = requestAnimationFrame(renderLoop);
    };

    animFrameId = requestAnimationFrame(renderLoop);
  };

  let _syncTrigger = ref(0);
  const triggerCanvasSync = () => {
    _syncTrigger.value++;
  };

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
    const { sceneNodes: nodes, savedPresets: presets, globalBases: bases, activeEffects: effects, livePages } = deserializeProject(snapshot);
    sceneNodes.value = nodes;
    savedPresets.value = presets;
    globalBases.value = bases;
    activeEffects.value = effects;
    engine.effects = activeEffects.value;
    triggerRef(sceneNodes);
    // Load live pages SYNCHRONOUSLY so the tail replay (which runs immediately
    // after this in loadProject) sees the pages and can mutate them. Earlier
    // dynamic-import version dropped any tail live-widget commands silently.
    useLiveModeStore().loadPages(livePages);
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
    overrideMap,
    setOverride,
    clearOverride,
    clearAllOverrides,
    clearUniverseOverrides,
    getOutputBuffer,
    initEngine,
    _syncTrigger,
    triggerCanvasSync,
    currentProjectId,
    projectLoading,
    projectError,
    loadProject,
    applyProjectSnapshot,
    getReplayContext,
    commitPendingPersistence,
  };
});
