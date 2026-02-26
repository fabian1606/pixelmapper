<script setup lang="ts">
import { computed, ref } from 'vue';
import { SlidersHorizontal, Layers, MapPin, Info, ChevronRight, Zap } from 'lucide-vue-next';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import FixturePropertySheet from './FixturePropertySheet.vue';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PropertyRow {
  label: string;
  value: string;
  channel?: Channel;
  fixtureId?: string | number;
  category: 'channel' | 'position' | 'meta';
  color?: string;
}

// ─── Props ───────────────────────────────────────────────────────────────────

const props = defineProps<{
  selectedFixtures: Fixture[];
  colors: Map<string | number, string>;
}>();

// ─── Sheet overlay state ──────────────────────────────────────────────────────

const sheetOpen = ref(false);
const activeRow = ref<PropertyRow | null>(null);

function openSheet(row: PropertyRow) {
  activeRow.value = row;
  sheetOpen.value = true;
}

// ─── Channel type display helpers ──────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  RED: 'Red',
  GREEN: 'Green',
  BLUE: 'Blue',
  WHITE: 'White',
  WARM_WHITE: 'Warm White',
  COOL_WHITE: 'Cool White',
  AMBER: 'Amber',
  UV: 'UV',
  DIMMER: 'Dimmer',
  PAN: 'Pan',
  TILT: 'Tilt',
  STROBE: 'Strobe',
  CUSTOM: 'Custom',
};

function channelLabel(type: string): string {
  return CHANNEL_LABELS[type] ?? type;
}

function channelBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
  if (role === 'COLOR') return 'default';
  if (role === 'DIMMER') return 'secondary';
  return 'outline';
}

// ─── Computed properties ───────────────────────────────────────────────────────

const isEmpty = computed(() => props.selectedFixtures.length === 0);

const isMulti = computed(() => props.selectedFixtures.length > 1);

/**
 * When multiple fixtures are selected: show aggregated channel types with avg values.
 * When a single fixture is selected: show its channels individually.
 */
const channelRows = computed<PropertyRow[]>(() => {
  if (isEmpty.value) return [];

  if (isMulti.value) {
    // Aggregate common channel types across all fixtures
    const typeMap = new Map<string, { total: number; count: number; channel: Channel }>();
    for (const fixture of props.selectedFixtures) {
      for (const ch of fixture.channels) {
        const existing = typeMap.get(ch.type);
        if (existing) {
          existing.total += ch.value;
          existing.count++;
        } else {
          typeMap.set(ch.type, { total: ch.value, count: 1, channel: ch });
        }
      }
    }
    return [...typeMap.entries()].map(([type, { total, count, channel }]) => ({
      label: channelLabel(type),
      value: `${Math.round(total / count)} / 255`,
      channel,
      category: 'channel' as const,
      color: channel.role === 'COLOR' ? channel.colorValue : undefined,
    }));
  }

  // Single fixture
  const fixture = props.selectedFixtures[0];
  return fixture.channels.map((ch) => ({
    label: channelLabel(ch.type),
    value: `${ch.value} / 255`,
    channel: ch,
    fixtureId: fixture.id,
    category: 'channel' as const,
    color: ch.role === 'COLOR' ? ch.colorValue : undefined,
  }));
});

const metaRows = computed<PropertyRow[]>(() => {
  if (isEmpty.value) return [];

  if (isMulti.value) {
    return [
      {
        label: 'Selection',
        value: `${props.selectedFixtures.length} fixtures`,
        category: 'meta' as const,
      },
    ];
  }

  const fixture = props.selectedFixtures[0];
  return [
    { label: 'Name', value: fixture.name, category: 'meta' as const },
    { label: 'ID', value: String(fixture.id), category: 'meta' as const },
    ...(fixture.oflKey
      ? [{ label: 'OFL Key', value: fixture.oflKey, category: 'meta' as const }]
      : []),
  ];
});

const positionRows = computed<PropertyRow[]>(() => {
  if (isEmpty.value) return [];

  if (isMulti.value) {
    const avgX = props.selectedFixtures.reduce((s, f) => s + f.fixturePosition.x, 0) / props.selectedFixtures.length;
    const avgY = props.selectedFixtures.reduce((s, f) => s + f.fixturePosition.y, 0) / props.selectedFixtures.length;
    return [
      { label: 'Avg X', value: avgX.toFixed(3), category: 'position' as const },
      { label: 'Avg Y', value: avgY.toFixed(3), category: 'position' as const },
    ];
  }

  const f = props.selectedFixtures[0];
  return [
    { label: 'X', value: f.fixturePosition.x.toFixed(3), category: 'position' as const },
    { label: 'Y', value: f.fixturePosition.y.toFixed(3), category: 'position' as const },
    { label: 'Size', value: `${(f.fixtureSize?.x ?? 1).toFixed(2)}x`, category: 'position' as const },
  ];
});

// ─── "Resolved color" swatch ──────────────────────────────────────────────────
const resolvedColor = computed<string | null>(() => {
  if (isEmpty.value || isMulti.value) return null;
  const id = props.selectedFixtures[0].id;
  return props.colors.get(id) ?? null;
});
</script>

<template>
  <div class="properties-sidebar">
    <!-- ── Header ───────────────────────────────────────────────────── -->
    <div class="sidebar-header">
      <SlidersHorizontal class="size-3.5 text-muted-foreground" />
      <span class="header-title">Properties</span>
      <div v-if="!isEmpty && resolvedColor" class="color-swatch" :style="{ background: resolvedColor }" />
    </div>

    <!-- ── Empty State ───────────────────────────────────────────────── -->
    <div v-if="isEmpty" class="empty-state">
      <Zap class="empty-icon" />
      <p class="empty-title">No Selection</p>
      <p class="empty-hint">Click a fixture on the canvas or in the scene list to inspect its properties.</p>
    </div>

    <!-- ── Populated ─────────────────────────────────────────────────── -->
    <ScrollArea v-else class="sidebar-scroll">
      <div class="sidebar-content">

        <!-- Meta section -->
        <section class="prop-section">
          <div class="section-header">
            <Info class="size-3 text-muted-foreground/60" />
            <span>Info</span>
          </div>
          <div class="prop-rows">
            <button
              v-for="row in metaRows"
              :key="row.label"
              class="prop-row"
              @click="openSheet(row)"
            >
              <span class="prop-label">{{ row.label }}</span>
              <span class="prop-value">{{ row.value }}</span>
              <ChevronRight class="row-chevron" />
            </button>
          </div>
        </section>

        <Separator class="my-2 opacity-30" />

        <!-- Position section -->
        <section class="prop-section">
          <div class="section-header">
            <MapPin class="size-3 text-muted-foreground/60" />
            <span>Position</span>
          </div>
          <div class="prop-rows">
            <button
              v-for="row in positionRows"
              :key="row.label"
              class="prop-row"
              @click="openSheet(row)"
            >
              <span class="prop-label">{{ row.label }}</span>
              <span class="prop-value">{{ row.value }}</span>
              <ChevronRight class="row-chevron" />
            </button>
          </div>
        </section>

        <Separator class="my-2 opacity-30" />

        <!-- Channels section -->
        <section class="prop-section">
          <div class="section-header">
            <Layers class="size-3 text-muted-foreground/60" />
            <span>Channels</span>
            <span class="section-count">{{ channelRows.length }}</span>
          </div>
          <div class="prop-rows">
            <button
              v-for="row in channelRows"
              :key="row.label"
              class="prop-row channel-row"
              @click="openSheet(row)"
            >
              <!-- Color dot for color channels -->
              <span
                v-if="row.color"
                class="channel-dot"
                :style="{ background: row.color }"
              />
              <span v-else class="channel-dot channel-dot--neutral" />

              <span class="prop-label">{{ row.label }}</span>

              <div class="channel-right">
                <!-- DMX bar -->
                <div class="dmx-bar-track">
                  <div
                    class="dmx-bar-fill"
                    :style="{
                      width: `${(row.channel?.value ?? 0) / 255 * 100}%`,
                      background: row.color ?? 'var(--primary)',
                    }"
                  />
                </div>
                <span class="prop-value channel-value">{{ row.channel?.value ?? '—' }}</span>
              </div>

              <ChevronRight class="row-chevron" />
            </button>
          </div>
        </section>

      </div>
    </ScrollArea>

    <!-- ── Property Sheet Overlay ─────────────────────────────────────── -->
    <FixturePropertySheet
      v-model:open="sheetOpen"
      :row="activeRow"
      :fixtures="selectedFixtures"
    />
  </div>
</template>

<style scoped>
.properties-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 240px;
  background: var(--sidebar);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

/* ── Header ──────────────────────────────────────────────────────── */
.sidebar-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.header-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  flex: 1;
}

.color-swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,0.15);
  flex-shrink: 0;
  box-shadow: 0 0 6px currentColor;
}

/* ── Empty state ──────────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;
  flex: 1;
}

.empty-icon {
  width: 24px;
  height: 24px;
  color: var(--muted-foreground);
  opacity: 0.3;
}

.empty-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-foreground);
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.empty-hint {
  font-size: 10px;
  color: var(--muted-foreground);
  opacity: 0.4;
  line-height: 1.5;
  max-width: 160px;
}

/* ── Scroll area ──────────────────────────────────────────────────── */
.sidebar-scroll {
  flex: 1;
  min-height: 0;
}

.sidebar-content {
  padding: 10px 0 20px;
}

/* ── Section ──────────────────────────────────────────────────────── */
.prop-section {
  padding: 0 8px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px 6px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.6;
}

.section-count {
  margin-left: auto;
  background: var(--accent);
  color: var(--muted-foreground);
  font-size: 9px;
  padding: 0 5px;
  border-radius: 999px;
  line-height: 16px;
}

/* ── Rows ─────────────────────────────────────────────────────────── */
.prop-rows {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.prop-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s ease;
  text-align: left;
}

.prop-row:hover {
  background: var(--accent);
}

.prop-row:hover .row-chevron {
  opacity: 0.7;
  transform: translateX(1px);
}

.prop-label {
  font-size: 11px;
  color: var(--foreground);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-value {
  font-size: 10px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.row-chevron {
  width: 10px;
  height: 10px;
  color: var(--muted-foreground);
  opacity: 0.3;
  flex-shrink: 0;
  transition: opacity 0.1s ease, transform 0.1s ease;
}

/* ── Channel rows ──────────────────────────────────────────────────── */
.channel-row {
  padding: 7px 8px;
}

.channel-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 5px currentColor;
}

.channel-dot--neutral {
  background: var(--muted-foreground);
  opacity: 0.3;
  box-shadow: none;
}

.channel-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  flex-shrink: 0;
}

.channel-value {
  font-size: 10px;
}

.dmx-bar-track {
  width: 52px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.dmx-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.05s linear;
  opacity: 0.85;
}
</style>
