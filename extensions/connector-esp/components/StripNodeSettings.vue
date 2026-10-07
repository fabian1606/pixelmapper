<script setup lang="ts">
/**
 * WebSocket strip node settings: URL (or USB setup wizard), strip slots
 * (fixture, GPIO pin, start LED on shared lines), the bound strips'
 * parameters (edited as kind config via the core command) and a RAM guide.
 */
import { computed, ref } from 'vue';
import { getFixture, useExtensionContext, useScope, type FixtureId, type Json } from '@pixelmapper/extension-api';
import type { FixtureSlot, WsStripConnector } from '../ws-strip-connector';
import { NEOPIXEL_KIND_ID, stripOf, stripPixelCount, type StripView } from '../strip-view';
import StripSetupWizard from './StripSetupWizard.vue';

const props = defineProps<{ connector: WsStripConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

const ctx = useExtensionContext();
const project = useScope('project');
const wizardOpen = ref(false);

/** Strip fixtures of the project. */
const stripFixtures = computed(() => (project.value?.fixtures ?? []).filter(f => f.kindId === NEOPIXEL_KIND_ID));

/** Strip parameters of a slot's fixture (re-read via the project scope tick). */
function stripFor(slot: FixtureSlot): StripView | null {
  void project.value;
  return slot.fixtureId ? stripOf(getFixture(slot.fixtureId)) : null;
}

/** Emits a new slot list. */
function setSlots(slots: FixtureSlot[]) {
  emit('change', { fixtureSlots: slots });
}

/** Updates one slot. */
function patchSlot(index: number, patch: Partial<FixtureSlot>) {
  const slots = props.connector.fixtureSlots.value.map(s => ({ ...s }));
  const slot = slots[index];
  if (!slot) return;
  Object.assign(slot, patch);
  // Shared pin: suggest the next free LED offset unless one is set.
  if (patch.pin != null && !slot.ledOffset) slot.ledOffset = suggestedOffset(slots, index, patch.pin);
  setSlots(slots);
}

/** Sum of the LEDs of earlier slots on the same pin. */
function suggestedOffset(slots: FixtureSlot[], index: number, pin: number): number {
  let sum = 0;
  for (let i = 0; i < index; i++) if (slots[i]?.pin === pin) sum += stripFor(slots[i]!)?.ledCount ?? 0;
  return sum;
}

/** Number of slots on a pin. */
function sharing(pin: number | null): number {
  return pin == null ? 0 : props.connector.fixtureSlots.value.filter(s => s.pin === pin).length;
}

/** True when a slot's LED range overlaps another slot on the same pin. */
function overlaps(index: number): boolean {
  const slots = props.connector.fixtureSlots.value;
  const s = slots[index];
  if (!s || s.pin == null) return false;
  const a0 = s.ledOffset ?? 0;
  const a1 = a0 + (stripFor(s)?.ledCount ?? 0);
  return slots.some((o, j) => {
    if (j === index || o.pin !== s.pin) return false;
    const b0 = o.ledOffset ?? 0;
    const b1 = b0 + (stripFor(o)?.ledCount ?? 0);
    return a0 < b1 && b0 < a1;
  });
}

/**
 * Edits a bound strip's kind config through the core command (one undo
 * step). A new shape clears the points so the kind regenerates them.
 */
function patchStrip(fixtureId: FixtureId, patch: Partial<StripView>) {
  // Plain JSON copy of the current config (avoids deep readonly typing).
  const current = (getFixture(fixtureId)?.kind as { config?: unknown } | undefined)?.config;
  if (!current) return;
  const config = { ...(JSON.parse(JSON.stringify(current)) as Record<string, unknown>), ...patch, ...(patch.shapeType ? { points: [] } : {}) } as unknown as Json;
  ctx.run(ctx.commands.setFixtureKindConfig({ fixtureId, config }));
}

/** Number from an input event (null when empty). */
const num = (e: Event) => {
  const v = (e.target as HTMLInputElement).value;
  return v === '' ? null : Number(v);
};

/** RAM guide thresholds (logical pixels per node). */
const pixels = computed(() => { void project.value; return props.connector.logicalPixels(); });
const severity = computed(() => (pixels.value > 1000 ? 'hard' : pixels.value > 600 ? 'warn' : 'none'));

const input = 'mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring';
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-end gap-1.5">
      <label class="text-xs text-muted-foreground flex-1">
        WebSocket URL
        <input
          type="text"
          :class="[input, 'font-mono']"
          placeholder="ws://pixelmapper-strip-XXXX.local/ws"
          :value="props.connector.url.value"
          :disabled="props.connector.status.value === 'connected' || props.connector.status.value === 'connecting'"
          @change="emit('change', { url: ($event.target as HTMLInputElement).value })"
        >
      </label>
      <button type="button" class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors" title="Configure via USB" @click="wizardOpen = true">
        Set up
      </button>
    </div>

    <div v-for="(slot, i) in props.connector.fixtureSlots.value" :key="i" class="flex flex-col gap-1 pt-1 border-t border-border/30 mt-0.5">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground font-medium">Strip {{ props.connector.fixtureSlots.value.length > 1 ? i + 1 : '' }}</span>
        <button
          v-if="props.connector.fixtureSlots.value.length > 1"
          type="button"
          class="px-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Remove strip"
          @click="setSlots(props.connector.fixtureSlots.value.filter((_, j) => j !== i))"
        >
          ✕
        </button>
      </div>
      <div class="flex gap-1.5 items-end">
        <label class="text-xs text-muted-foreground flex-1 min-w-0">
          Strip fixture
          <select :class="input" :value="String(slot.fixtureId ?? '')" @change="patchSlot(i, { fixtureId: ($event.target as HTMLSelectElement).value })">
            <option value="">— none —</option>
            <option v-for="f in stripFixtures" :key="String(f.id)" :value="String(f.id)">{{ f.name || `Fixture ${f.id}` }}</option>
          </select>
        </label>
        <label class="text-xs text-muted-foreground w-16 shrink-0">
          GPIO
          <input type="number" min="0" max="48" placeholder="—" :class="input" :value="slot.pin ?? ''" @change="patchSlot(i, { pin: num($event) })">
        </label>
        <label v-if="sharing(slot.pin) > 1" class="text-xs text-muted-foreground w-16 shrink-0" title="Start LED on the shared data line">
          from LED
          <input type="number" min="0" :class="[input, overlaps(i) ? 'border-destructive text-destructive' : '']" :value="slot.ledOffset ?? 0" @change="patchSlot(i, { ledOffset: num($event) ?? 0 })">
        </label>
      </div>
      <p v-if="overlaps(i)" class="text-[10px] text-destructive">LED range overlaps another strip on pin {{ slot.pin }}.</p>

      <template v-if="stripFor(slot)">
        <div class="grid grid-cols-3 gap-2 pt-1">
          <label class="text-xs text-muted-foreground">
            LEDs
            <input type="number" min="1" max="2048" :class="input" :value="stripFor(slot)!.ledCount" @change="patchStrip(slot.fixtureId, { ledCount: num($event) ?? 1 })">
            <span class="mt-0.5 block text-[10px] text-muted-foreground/70">{{ stripPixelCount(stripFor(slot)!) }} pixels</span>
          </label>
          <label class="text-xs text-muted-foreground">
            Group
            <input type="number" min="1" max="64" :class="input" :value="stripFor(slot)!.groupSize" @change="patchStrip(slot.fixtureId, { groupSize: num($event) ?? 1 })">
          </label>
          <label class="text-xs text-muted-foreground">
            LEDs/m
            <input type="number" min="1" max="500" :class="input" :value="stripFor(slot)!.ledsPerMeter" @change="patchStrip(slot.fixtureId, { ledsPerMeter: num($event) ?? 60 })">
          </label>
        </div>
        <label class="text-xs text-muted-foreground">
          Shape
          <select :class="input" :value="stripFor(slot)!.shapeType" @change="patchStrip(slot.fixtureId, { shapeType: ($event.target as HTMLSelectElement).value as StripView['shapeType'] })">
            <option value="bezier">Bezier curve</option>
            <option value="line">Straight line</option>
            <option value="circle">Circle</option>
          </select>
        </label>
        <div v-if="stripFor(slot)!.shapeType === 'circle'" class="flex gap-1">
          <button
            v-for="cw in [true, false]"
            :key="String(cw)"
            type="button"
            class="flex-1 rounded border text-xs py-1 transition-colors"
            :class="stripFor(slot)!.clockwise === cw ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'"
            @click="patchStrip(slot.fixtureId, { clockwise: cw })"
          >
            {{ cw ? 'CW' : 'CCW' }}
          </button>
        </div>
      </template>
    </div>

    <button
      type="button"
      class="mt-1 text-xs text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-accent transition-colors self-start"
      @click="setSlots([...props.connector.fixtureSlots.value, { fixtureId: '', pin: null }])"
    >
      + Add strip
    </button>

    <div
      v-if="severity !== 'none'"
      class="mt-1 rounded border px-2 py-1.5 text-xs leading-relaxed"
      :class="severity === 'hard' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-muted/30 text-muted-foreground'"
    >
      <span class="font-medium">{{ pixels }} logical pixels</span>
      {{ severity === 'hard' ? '— very high; the node may become unstable. Reduce the LED count or raise the group size.' : '— at the limit; WiFi may drop frames.' }}
    </div>

    <div class="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
      <span v-if="props.connector.firmwareVersion.value">Firmware: v{{ props.connector.firmwareVersion.value }}</span>
      <span>Data pin: <span class="font-mono">{{ props.connector.devicePin.value ?? '—' }}</span></span>
    </div>
    <p v-if="!stripFixtures.length" class="text-xs text-muted-foreground">There is no LED strip fixture in this scene yet.</p>

    <StripSetupWizard v-if="wizardOpen" :connector="props.connector" @apply="patch => emit('change', patch)" @close="wizardOpen = false" />
  </div>
</template>
