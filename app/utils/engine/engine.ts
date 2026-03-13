import type { Effect, EffectContext, SpeedConfig } from '~/utils/engine/types';
import type { Fixture } from './core/fixture';
import type { Channel } from './core/channel';
import { reactive, ref, type Ref } from 'vue';
import { WORLD_WIDTH, WORLD_HEIGHT, FIXTURE_RADIUS } from './constants';
import initWasm, { WasmEngine } from 'rs-engine';
import wasmUrl from 'rs-engine/rs_engine_bg.wasm?url';

// We must initialize the Wasm module before we can use WasmEngine
let isWasmInitialized = false;

export class EffectEngine {
  public effects = reactive<Effect[]>([]);
  public activeModifier: Ref<Effect | null> = ref(null);

  /**
   * Global BPM for the engine, used to calculate beat-based speeds.
   */
  public globalBpm = ref<number>(120);

  private wasmEngine: WasmEngine | null = null;
  private cachedTargetsPayload: string = "";
  private cachedEffectsPayload: string = "";

  /**
   * The DMX buffer mapped directly from Wasm memory!
   * Access via buffer[startAddress - 1 + addressOffset].
   */
  public dmxBuffer: Uint8Array = new Uint8Array(512);

  constructor() {
    this.init();
  }

  private async init() {
    if (!isWasmInitialized) {
      await initWasm(wasmUrl);
      isWasmInitialized = true;
    }
    this.wasmEngine = new WasmEngine();
    this.wasmEngine.set_bpm(this.globalBpm.value);
    this.dmxBuffer = this.wasmEngine.get_dmx_view();
  }

  public addEffect(effect: Effect) {
    this.effects.push(effect);
  }

  public clearEffects() {
    this.effects.splice(0, this.effects.length);
  }

  /**
   * Synchronizes the frontend Fixtures down into flattened RenderTargets for the Rust Engine.
   */
  private syncTargets(fixtures: Fixture[]) {
    if (!this.wasmEngine) return;

    const targets: any[] = [];

    for (const fixture of fixtures) {
      const rotRad = (fixture.rotation ?? 0) * (Math.PI / 180);
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);

      for (const channel of fixture.channels) {
        let worldX = fixture.fixturePosition.x;
        let worldY = fixture.fixturePosition.y;

        if (channel.beamId) {
          const beam = fixture.beams?.find(b => b.id === channel.beamId);
          if (beam) {
            const fWidth = fixture.fixtureSize.x * FIXTURE_RADIUS * 2;
            const fHeight = fixture.fixtureSize.y * FIXTURE_RADIUS * 2;

            const localPx = beam.localX * fWidth;
            const localPy = beam.localY * fHeight;

            const rotPx = localPx * cosR - localPy * sinR;
            const rotPy = localPx * sinR + localPy * cosR;

            worldX += rotPx / WORLD_WIDTH;
            worldY += rotPy / WORLD_HEIGHT;
          }
        }

        const chaserState = channel.chaserConfig;
        
        targets.push({
          dmxIndex: fixture.startAddress - 1 + channel.addressOffset,
          channelType: channel.type,
          groupIndex: typeof fixture.id === 'string' ? parseInt(fixture.id, 10) || 0 : fixture.id,
          worldX,
          worldY,
          // Chaser Config serialization matches Rust struct exactly
          chaserConfig: chaserState ? {
            stepValues: chaserState.stepValues,
            stepsCount: chaserState.stepsCount,
            activeEditStep: chaserState.activeEditStep,
            isPlaying: chaserState.isPlaying,
            stepDuration: {
              mode: chaserState.stepDuration.mode,
              timeMs: chaserState.stepDuration.timeMs,
              beatValue: chaserState.stepDuration.beatValue,
              beatOffset: chaserState.stepDuration.beatOffset || 0
            },
            fadeDuration: {
              mode: chaserState.fadeDuration.mode,
              timeMs: chaserState.fadeDuration.timeMs,
              beatValue: chaserState.fadeDuration.beatValue,
              beatOffset: chaserState.fadeDuration.beatOffset || 0
            }
          } : null
        });
      }
    }

    const payload = JSON.stringify(targets);
    if (payload !== this.cachedTargetsPayload) {
      this.wasmEngine.sync_targets(payload);
      this.cachedTargetsPayload = payload;
    }
  }

  /**
   * Synchronizes active Effect configurations down to the Rust Engine.
   */
  private syncEffects() {
    if (!this.wasmEngine) return;

    const effectConfigs = this.effects.map(effect => {
      let effectType = "Sine";
      // We assume standard properties exist on the effect from types.ts
      return {
        targetChannels: effect.targetChannels,
        targetGroupIndices: effect.targetFixtureIds 
          ? effect.targetFixtureIds.map(id => typeof id === 'string' ? parseInt(id, 10) || 0 : id)
          : null,
        direction: effect.direction ?? 'LINEAR',
        originX: effect.originX ?? 0.5,
        originY: effect.originY ?? 0.5,
        angle: effect.angle ?? 0,
        strength: effect.strength,
        reverse: effect.reverse ?? false,
        fanning: effect.fanning,
        speed: { ...effect.speed, beatOffset: effect.speed.beatOffset || 0 },
        effectType
      };
    });

    const payload = JSON.stringify(effectConfigs);
    if (payload !== this.cachedEffectsPayload) {
      this.wasmEngine.sync_effects(payload);
      this.cachedEffectsPayload = payload;
    }
  }

  public render(
    fixtures: Fixture[],
    timeMs: number,
    deltaTimeMs: number
  ): void {
    if (!this.wasmEngine) return;

    this.wasmEngine.set_bpm(this.globalBpm.value);
    
    // Sync state (JSON serialization only triggers when array lengths / simple props change, using a naive deep check could be added later, but stringify is fine for PoC)
    // To ensure optimal 60fps, we only stringify/sync if the objects actually changed. 
    // In a real app we'd trigger `syncTargets` ONLY when a user drags a fixture, not every frame.
    // For this port, we do it every frame but rely on string comparison caching (which is fast enough for <100 fixtures)
    this.syncTargets(fixtures);
    this.syncEffects();

    // The Rust Wasm Engine loop computes all phases and offsets natively
    this.wasmEngine.render(timeMs, deltaTimeMs);
    
    // Re-fetch the view! If the Wasm memory grew during JSON parsing or rendering, 
    // the old Uint8Array pointing to the buffer becomes detached. 
    this.dmxBuffer = this.wasmEngine.get_dmx_view();
  }
}
