import { defineStore } from 'pinia';
import { ref, shallowRef, computed, watch, watchEffect, markRaw, triggerRef } from 'vue';
import type { Preset } from '~/utils/engine/preset-types';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useHistory } from '~/components/engine/composables/use-history';
import { useConnectionsStore } from '~/stores/connections-store';

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

  let initialized = false;
  let animFrameId: number;
  let startTime: number;
  let lastTime: number;

  const initEngine = () => {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;

    const history = useHistory();
    const connectionsStore = useConnectionsStore();

    // Sync UI trigger on history undo/redo
    watch(() => history.version.value, () => {
      triggerRef(sceneNodes);

      // History undo/redo replaces the effects array entirely in SetModifiersCommand
      // Sync our reactive ref with whatever the engine currently holds
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

    // Auto-sync global bases
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

    // Start background render loop
    startTime = performance.now();
    lastTime = startTime;

    const renderLoop = (time: number) => {
      const elapsed = time - startTime;
      const deltaTime = time - lastTime;
      lastTime = time;

      engine.render(flatFixtures.value, elapsed, deltaTime);
      connectionsStore.sendFrame(engine.dmxBuffer);
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
    initEngine
  };
});
