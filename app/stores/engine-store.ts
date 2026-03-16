import { defineStore } from 'pinia';
import { ref, shallowRef, computed, watch, watchEffect, markRaw, triggerRef } from 'vue';
import type { Preset } from '~/utils/engine/preset-types';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useHistory } from '~/components/engine/composables/use-history';
import { useConnectionsStore } from '~/stores/connections-store';
import {
  TYPE_LAYOUT_BIN, TYPE_CHAN_BIN, TYPE_FX_BIN,
  buildLayoutBin, buildChannelsBin, buildEffectsBin,
} from '~/utils/connectors/binary-encoder';

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

  // ── Binary packet cache + revision counters ───────────────────────────────

  let layoutPacket:   Uint8Array = new Uint8Array(0);
  let channelsPacket: Uint8Array = new Uint8Array(0);
  let effectsPacket:  Uint8Array = new Uint8Array(0);

  const layoutRevision   = ref(0);
  const channelsRevision = ref(0);
  const effectsRevision  = ref(0);

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

    // Watch effects → rebuild effects packet
    watch(activeEffects, () => {
      const allIds = flatFixtures.value.map(f =>
        typeof f.id === 'string' ? (parseInt(f.id, 10) || 0) : (f.id as number)
      );
      effectsPacket = buildEffectsBin(activeEffects.value, allIds);
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
        currentElapsed.value = elapsed;
        connectionsStore.sendFrame(engine.dmxBuffer);
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
    initEngine,
  };
});
