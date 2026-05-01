import { defineStore } from 'pinia';
import { ref, shallowRef, computed, watch, watchEffect, markRaw, triggerRef } from 'vue';
import type { Preset } from '~/utils/engine/preset-types';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useHistory, setPersistenceHooks } from '~/components/engine/composables/use-history';
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
import { SetModifiersCommand, cloneEffectsList } from '~/components/engine/commands/set-modifiers-command';
import { registerCommand } from '~/components/engine/commands/serializable-command';

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
        const elapsed = time - startTime;
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
        if (outputBuffer.length !== engine.dmxBuffer.length) {
          outputBuffer = new Uint8Array(engine.dmxBuffer.length);
        }
        outputBuffer.set(engine.dmxBuffer);
        const overrides = getOverrideMap();
        if (overrides.size > 0) {
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
    const { sceneNodes: nodes, savedPresets: presets, globalBases: bases, activeEffects: effects } = deserializeProject(snapshot);
    sceneNodes.value = nodes;
    savedPresets.value = presets;
    globalBases.value = bases;
    activeEffects.value = effects;
    engine.effects = activeEffects.value;
    triggerRef(sceneNodes);
  }

  async function loadProject(projectId: string) {
    const supabase = useSupabaseClient();
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

    // Apply the base snapshot if present
    if (data.snapshot) {
      applyProjectSnapshot(data.snapshot);
    }

    // Replay the tail: changes after the snapshot's sequence_number
    for (const change of (data.tail ?? [])) {
      const cmd = commandFromPayload(change.command_type, change.payload, getReplayContext());
      if (cmd) (cmd as any).execute(true);
    }
    triggerRef(sceneNodes);

    // Wire up persistence hooks so future commands are pushed to Supabase
    setPersistenceHooks({
      pushChange: async (commandType, payload) => {
        await supabase.functions.invoke('push-change', {
          body: { projectId, commandType, payload },
        });
      },
      saveSnapshot: async () => {
        const user = (await supabase.auth.getUser()).data.user;
        const { data: pinnedStore } = await import('~/stores/pinned-modifiers-store').then(m => ({
          data: m.usePinnedModifiersStore(),
        }));
        const snapshot = serializeProject(
          sceneNodes.value,
          savedPresets.value,
          pinnedStore.pinnedModifiers,
          globalBases.value,
          activeEffects.value,
        );
        // Get the latest sequence_number from the last push-change call
        const { data: seqData } = await supabase
          .from('project_changes')
          .select('sequence_number')
          .eq('project_id', projectId)
          .order('sequence_number', { ascending: false })
          .limit(1)
          .single();

        await supabase.functions.invoke('save-snapshot', {
          body: {
            projectId,
            snapshot,
            sequenceNumber: seqData?.sequence_number ?? 0,
          },
        });
      },
    });

    projectLoading.value = false;

    // Force snapshot on page unload to keep tail short
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        // Best-effort synchronous snapshot hint — actual save is async
        navigator.sendBeacon?.(`/api/noop`); // placeholder; real save via saveSnapshot above
      }, { once: true });
    }
  }

  return {
    savedPresets,
    selectedPresetId,
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
    loadProject,
    applyProjectSnapshot,
  };
});
