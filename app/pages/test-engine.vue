<script setup lang="ts">
import { ref, onMounted, onUnmounted, watchEffect } from 'vue';
import { SineEffect } from '~/utils/engine/effects/sine-effect';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import { RedChannel, GreenChannel, BlueChannel, DimmerChannel } from '~/utils/engine/core/channel';
import type { ChannelType } from '~/utils/engine/types';
import FixtureEditor from '~/components/engine/FixtureEditor.vue';
import { shallowRef } from 'vue';

const COLS = 5;
const ROWS = 4;
const fixtureCount = COLS * ROWS;
const engine = new EffectEngine();

// Create fixtures in a grid layout (normalized 0-1 positions)
// Center a 10x4 grid (approx 0.4 wide, 0.2 high) around 0.5, 0.5
const stepX = 0.04;
const stepY = 0.06;
const startX = 0.5 - (9 * stepX) / 2; // 9 steps for 10 columns
const startY = 0.5 - (3 * stepY) / 2; // 3 steps for 4 rows

const fixtures = Array.from({ length: fixtureCount }, (_, i) => {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  
  const fixture = new Fixture(i, [new RedChannel(), new GreenChannel(), new BlueChannel(), new DimmerChannel()]);
  if (i === 0) fixture.name = 'Front Left';
  if (i === 9) fixture.name = 'Front Right';
  if (i === 30) fixture.name = 'Back Left';
  if (i === 39) fixture.name = 'Back Right';

  fixture.fixturePosition = {
    x: startX + col * stepX,
    y: startY + row * stepY,
  };
  fixture.fixtureSize = {
    x: 1,
    y: 1,
  };
  return fixture;
});

// Global Base Values
const globalBases = ref<Record<string, number>>({
  RED: 0,
  GREEN: 0,
  BLUE: 0,
  DIMMER: 255,
});

// Effect Parameters
const effectParams = ref({
  speed: 0.005,
  strength: 100,
  fanning: 0.5,
  targetChannel: 'GREEN' as ChannelType,
  direction: 'FORWARD' as any,
});

// SineEffect
const sine = new SineEffect();
engine.addEffect(sine);

// Sync reactive params → effect instance
watchEffect(() => {
  for (const fixture of fixtures) {
    for (const channel of fixture.channels) {
      const base = globalBases.value[channel.type];
      if (base !== undefined) channel.baseValue = base;
    }
  }

  sine.speed = effectParams.value.speed;
  sine.strength = effectParams.value.strength;
  sine.fanning = effectParams.value.fanning;
  sine.targetChannel = effectParams.value.targetChannel;
  sine.direction = effectParams.value.direction;
});

// Reactive color map — updated every frame, consumed by FixtureEditor
const fixtureColors = shallowRef<Map<string | number, string>>(new Map());

// Reactive snapshot — only used for the DMX table, NOT the editor
interface FixtureSnapshot {
  id: string | number;
  channels: { type: string; value: number }[];
}
const fixtureSnapshots = ref<FixtureSnapshot[]>([]);

let animFrameId: number;
const startTime = performance.now();
let lastTime = startTime;

const CHANNEL_COLORS: Record<string, string> = {
  RED: '#ef4444', GREEN: '#22c55e', BLUE: '#3b82f6', DIMMER: '#a1a1aa',
};

const renderLoop = (time: number) => {
  const elapsed = time - startTime;
  const deltaTime = time - lastTime;
  lastTime = time;

  engine.render(fixtures, elapsed, deltaTime);

  // Rebuild color map each frame so FixtureEditor stays live
  const colorMap = new Map<string | number, string>();
  fixtureSnapshots.value = fixtures.map(f => {
    colorMap.set(f.id, f.resolveColor());
    return { id: f.id, channels: f.channels.map(c => ({ type: c.type, value: c.value })) };
  });
  fixtureColors.value = colorMap;

  animFrameId = requestAnimationFrame(renderLoop);
};

onMounted(() => { animFrameId = requestAnimationFrame(renderLoop); });
onUnmounted(() => { cancelAnimationFrame(animFrameId); });
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-white p-8 font-sans">
    <div class="max-w-7xl mx-auto space-y-6">

      <div>
        <h1 class="text-3xl font-bold tracking-tight">Pixelmapper Effect Engine</h1>
        <p class="text-slate-400 mt-1 text-sm">
          {{ fixtureCount }} Fixtures · Drag fixtures to reposition · Spatial direction modes
        </p>
      </div>

      <!-- Main layout: Controls + Editor side-by-side -->
      <div class="grid grid-cols-[320px_1fr] gap-6 items-start">

        <!-- Left: Controls -->
        <div class="space-y-4">

          <!-- Base Values -->
          <div class="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-3">
            <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wider">Base Values</h2>
            <div v-for="(v, channel) in globalBases" :key="channel" class="space-y-0.5">
              <div class="flex justify-between text-xs text-slate-400">
                <span>{{ channel }}</span>
                <span class="font-mono">{{ globalBases[channel] }}</span>
              </div>
              <input
                type="range" min="0" max="255"
                v-model.number="globalBases[channel]"
                class="w-full accent-slate-500"
              />
            </div>
          </div>

          <!-- Sine Effect params -->
          <div class="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-3">
            <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wider">Sine Effect</h2>

            <div class="space-y-0.5">
              <label class="text-xs text-slate-400">Target Channel</label>
              <select v-model="effectParams.targetChannel" class="w-full bg-slate-800 text-sm p-1 rounded border border-slate-700">
                <option value="RED">RED</option>
                <option value="GREEN">GREEN</option>
                <option value="BLUE">BLUE</option>
                <option value="DIMMER">DIMMER</option>
              </select>
            </div>

            <div class="space-y-0.5">
              <label class="text-xs text-slate-400">Direction</label>
              <select v-model="effectParams.direction" class="w-full bg-slate-800 text-sm p-1 rounded border border-slate-700">
                <optgroup label="Index-based">
                  <option value="FORWARD">Forward</option>
                  <option value="BACKWARD">Backward</option>
                  <option value="CENTER_OUT">Center Out</option>
                  <option value="OUTSIDE_IN">Outside In</option>
                </optgroup>
                <optgroup label="Spatial (uses 2D position)">
                  <option value="SPATIAL_X">Spatial X (Left → Right)</option>
                  <option value="SPATIAL_Y">Spatial Y (Top → Bottom)</option>
                  <option value="SPATIAL_RADIAL">Spatial Radial (from center)</option>
                </optgroup>
              </select>
            </div>

            <div class="space-y-0.5">
              <div class="flex justify-between text-xs text-slate-400">
                <span>Strength</span><span class="font-mono">{{ effectParams.strength }}</span>
              </div>
              <input type="range" min="0" max="255" v-model.number="effectParams.strength" class="w-full accent-slate-500" />
            </div>

            <div class="space-y-0.5">
              <div class="flex justify-between text-xs text-slate-400">
                <span>Speed</span><span class="font-mono">{{ effectParams.speed.toFixed(4) }}</span>
              </div>
              <input type="range" min="0" max="0.02" step="0.0001" v-model.number="effectParams.speed" class="w-full accent-slate-500" />
            </div>

            <div class="space-y-0.5">
              <div class="flex justify-between text-xs text-slate-400">
                <span>Fanning</span><span class="font-mono">{{ effectParams.fanning.toFixed(2) }}</span>
              </div>
              <input type="range" min="0" max="2" step="0.01" v-model.number="effectParams.fanning" class="w-full accent-slate-500" />
            </div>
          </div>

        </div>

        <!-- Right: 2D Fixture Editor -->
        <div class="space-y-2">
          <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wider">Fixture Stage</h2>
          <p class="text-xs text-slate-500">Drag fixtures to reposition. Switch to a Spatial direction to see position-based effects.</p>
          <FixtureEditor :fixtures="fixtures" :colors="fixtureColors" :width="680" :height="420" />
        </div>
      </div>

      <!-- DMX Table -->
      <div class="space-y-2">
        <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wider">DMX Values</h2>
        <div class="grid grid-cols-5 gap-2 text-[10px] font-mono text-slate-500 px-1">
          <div>Fixture</div>
          <div class="text-center text-red-400">RED</div>
          <div class="text-center text-green-500">GREEN</div>
          <div class="text-center text-blue-500">BLUE</div>
          <div class="text-center text-zinc-400">DIMMER</div>
        </div>
        <div class="space-y-1">
          <div
            v-for="fixture in fixtureSnapshots"
            :key="fixture.id"
            class="grid grid-cols-5 gap-2 items-center"
          >
            <div class="text-[11px] font-mono text-slate-500">#{{ fixture.id }}</div>
            <div
              v-for="ch in fixture.channels"
              :key="ch.type"
              class="relative h-5 rounded bg-slate-800 overflow-hidden"
            >
              <div
                class="absolute inset-y-0 left-0 transition-all duration-75 ease-linear rounded"
                :style="{
                  width: `${(ch.value / 255) * 100}%`,
                  backgroundColor: CHANNEL_COLORS[ch.type] ?? '#6b7280',
                }"
              />
              <span class="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white/50">
                {{ ch.value }}
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
