<script setup lang="ts">
import { ref, onMounted, onUnmounted, watchEffect } from 'vue';
import { SineEffect } from '~/utils/engine/effects/sine-effect';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelType } from '~/utils/engine/types';

const fixtureCount = 20;
const engine = new EffectEngine();
const fixtures = Array.from({ length: fixtureCount }, (_, i) => Fixture.createRGBFixture(i));

// Global Base Values
const globalBases = ref<Record<string, number>>({
  RED: 0,
  GREEN: 0,
  BLUE: 0,
  DIMMER: 255,
});

// Effect Parameters
const effectParams = ref({
  speed: 0.003,
  strength: 100,
  fanning: 0.5,
  targetChannel: 'GREEN' as ChannelType,
});

// SineEffect
const sine = new SineEffect();
engine.addEffect(sine);

// Update logic
watchEffect(() => {
  // Update Fixture base values
  for (const fixture of fixtures) {
    for (const channel of fixture.channels) {
      const base = globalBases.value[channel.type];
      if (base !== undefined) {
        channel.baseValue = base;
      }
    }
  }

  // Update Effect parameters
  sine.speed = effectParams.value.speed;
  sine.strength = effectParams.value.strength;
  sine.fanning = effectParams.value.fanning;
  sine.targetChannel = effectParams.value.targetChannel;
});

// Reactive snapshot of fixture channel states
interface FixtureSnapshot {
  id: string | number;
  channels: { type: string; value: number }[];
}

const fixtureSnapshots = ref<FixtureSnapshot[]>([]);

let animationFrameId: number;
const startTime = performance.now();
let lastTime = startTime;

const CHANNEL_COLORS: Record<string, string> = {
  RED: '#ef4444',
  GREEN: '#22c55e',
  BLUE: '#3b82f6',
  DIMMER: '#a1a1aa',
};

const renderLoop = (time: number) => {
  const elapsed = time - startTime;
  const deltaTime = time - lastTime;
  lastTime = time;
  
  engine.render(fixtures, elapsed, deltaTime);

  fixtureSnapshots.value = fixtures.map(f => ({
    id: f.id,
    channels: f.channels.map(c => ({ type: c.type, value: c.value })),
  }));

  animationFrameId = requestAnimationFrame(renderLoop);
};

onMounted(() => {
  animationFrameId = requestAnimationFrame(renderLoop);
});

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId);
});
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-white p-8 font-sans">
    <div class="max-w-6xl mx-auto space-y-6">

      <div>
        <h1 class="text-3xl font-bold tracking-tight">Pixelmapper Effect Engine</h1>
        <p class="text-slate-400 mt-1 text-sm">
          Testing relative effects, strength, fanning and base values.
        </p>
      </div>

      <!-- Controls UI -->
      <div class="grid grid-cols-2 gap-8 bg-slate-900 p-6 rounded-lg border border-slate-800">
        <!-- Base Values -->
        <div class="space-y-4">
          <h2 class="text-lg font-semibold text-slate-300">Base Values</h2>
          <div v-for="(v, channel) in globalBases" :key="channel" class="space-y-1">
            <div class="flex justify-between text-xs text-slate-400">
              <span>{{ channel }}</span>
              <span>{{ globalBases[channel] }}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="255" 
              v-model.number="globalBases[channel]" 
              class="w-full accent-slate-500"
            />
          </div>
        </div>

        <!-- Effect Params -->
        <div class="space-y-4">
          <h2 class="text-lg font-semibold text-slate-300">Sine Effect</h2>
          
          <div class="space-y-1">
            <div class="flex justify-between text-xs text-slate-400">
              <span>Target Channel</span>
              <span>{{ effectParams.targetChannel }}</span>
            </div>
            <select v-model="effectParams.targetChannel" class="w-full bg-slate-800 text-sm p-1 rounded border border-slate-700">
              <option value="RED">RED</option>
              <option value="GREEN">GREEN</option>
              <option value="BLUE">BLUE</option>
              <option value="DIMMER">DIMMER</option>
            </select>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-xs text-slate-400">
              <span>Strength</span>
              <span>{{ effectParams.strength }}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="255" 
              v-model.number="effectParams.strength" 
              class="w-full accent-slate-500"
            />
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-xs text-slate-400">
              <span>Speed</span>
              <span>{{ effectParams.speed.toFixed(4) }}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="0.02" 
              step="0.0001"
              v-model.number="effectParams.speed" 
              class="w-full accent-slate-500"
            />
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-xs text-slate-400">
              <span>Fanning</span>
              <span>{{ effectParams.fanning.toFixed(2) }}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.01"
              v-model.number="effectParams.fanning" 
              class="w-full accent-slate-500"
            />
          </div>
        </div>
      </div>

      <!-- Column headers -->
      <div class="grid grid-cols-5 gap-2 text-[10px] font-mono text-slate-500 px-1 mt-8">
        <div>Fixture</div>
        <div class="text-center text-red-400">RED</div>
        <div class="text-center text-green-500">GREEN</div>
        <div class="text-center text-blue-500">BLUE</div>
        <div class="text-center text-zinc-400">DIMMER</div>
      </div>

      <!-- Fixture Rows -->
      <div class="space-y-1.5">
        <div
          v-for="fixture in fixtureSnapshots"
          :key="fixture.id"
          class="grid grid-cols-5 gap-2 items-center"
        >
          <!-- Label -->
          <div class="text-[11px] font-mono text-slate-500">#{{ fixture.id }}</div>

          <!-- Channel bars -->
          <div
            v-for="ch in fixture.channels"
            :key="ch.type"
            class="relative h-6 rounded bg-slate-800 overflow-hidden"
          >
            <div
              class="absolute inset-y-0 left-0 transition-all duration-75 ease-linear rounded"
              :style="{
                width: `${(ch.value / 255) * 100}%`,
                backgroundColor: CHANNEL_COLORS[ch.type] ?? '#6b7280',
              }"
            />
            <span class="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white/60 mix-blend-plus-lighter">
              {{ ch.value }}
            </span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
