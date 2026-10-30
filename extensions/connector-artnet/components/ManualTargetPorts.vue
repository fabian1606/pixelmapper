<script setup lang="ts">
/**
 * Card of a manual target (an `artnet` device added by IP that has never
 * answered ArtPoll; WP13 layout): a header with the IP, then one flat,
 * collapsible block per output — the Pixelmapper universe and the
 * Port-Address the device receives, sent as unicast ArtDmx to its IP
 * through the bridge's `ip` DMX routes — and “+ Output” below the list.
 * Once the device answers ArtPoll the card shows the normal node card.
 */
import { computed } from 'vue';
import { formatPortAddress } from '../bridge/protocol-model';
import { ArtNetNodeConnector, MAX_MANUAL_OUTPUTS } from '../node/node-connector';
import { defaultManualPortAddress } from '../node/output-ports';
import CardSection from '../card/CardSection.vue';
import InfoTip from '../card/InfoTip.vue';
import { PORTS_OPEN_BY_DEFAULT_MAX, provideCardCollapse } from '../card/use-card-collapse';

const props = defineProps<{ connector: ArtNetNodeConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

provideCardCollapse(props.connector.id);

/** Current outputs as universe + Port-Address pairs. */
const outputs = computed(() => props.connector.outputMapping.value.slice(0, props.connector.outputCount).map((universe, i) => ({
  universe,
  portAddress: props.connector.portAddresses.value[i] ?? defaultManualPortAddress(universe),
})));

/** Parses a number input, clamped to `min…max`; null when empty or invalid. */
function parse(raw: string, min: number, max: number): number | null {
  const n = Math.floor(Number(raw));
  return raw.trim() !== '' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
}

/** Emits the outputs as one patch (the host applies and persists it). */
function save(next: { universe: number; portAddress: number }[]) {
  emit('change', ArtNetNodeConnector.manualOutputsPatch(next));
}

/** Sets the universe of one output (empty = off). */
function setUniverse(index: number, raw: string) {
  const next = outputs.value.slice();
  next[index] = { ...next[index]!, universe: parse(raw, 1, 32768) ?? 0 };
  save(next);
}

/** Sets the Port-Address of one output (0–32767). */
function setPortAddress(index: number, raw: string) {
  const value = parse(raw, 0, 0x7fff);
  if (value === null) return;
  const next = outputs.value.slice();
  next[index] = { ...next[index]!, portAddress: value };
  save(next);
}

/** Adds an output for the universe after the highest one in use. */
function addOutput() {
  const universe = Math.min(32768, Math.max(0, ...outputs.value.map(o => o.universe)) + 1);
  save([...outputs.value, { universe, portAddress: defaultManualPortAddress(universe) }]);
}

function removeOutput(index: number) {
  save(outputs.value.filter((_, i) => i !== index));
}

const field = 'rounded border border-border bg-background text-xs px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring';
</script>

<template>
  <div class="flex flex-col gap-2" data-manual-target>
    <div class="flex flex-col gap-0.5 text-xs">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate font-medium">{{ connector.label.value || connector.ip.value }}</span>
        <span class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">No discovery</span>
        <InfoTip topic="manualTarget" />
      </div>
      <span class="text-[11px] text-muted-foreground">
        <span class="font-mono">{{ connector.ip.value }}</span> · no ArtPollReply — DMX is sent unicast to this IP
      </span>
    </div>
    <section class="flex flex-col">
      <div class="flex min-h-7 items-center text-xs font-medium">Outputs</div>
      <CardSection
        v-for="(o, i) in outputs"
        :key="i"
        :section-id="`output:${i}`"
        :title="`Output ${i + 1}`"
        variant="block"
        :default-open="outputs.length <= PORTS_OPEN_BY_DEFAULT_MAX"
        data-manual-output
      >
        <template #summary>
          <span class="truncate pl-1 font-mono text-[11px] text-muted-foreground">{{ o.universe ? `U${o.universe}` : 'off' }} → {{ formatPortAddress(o.portAddress) }}</span>
        </template>
        <div class="flex flex-col gap-1 text-xs">
          <div class="flex min-h-7 items-center gap-2">
            <span class="flex w-24 shrink-0 items-center gap-1 text-muted-foreground">Universe <InfoTip topic="universeMapping" /></span>
            <input
              type="number"
              min="0"
              max="32768"
              placeholder="off"
              :class="[field, 'w-16']"
              :value="o.universe || ''"
              aria-label="Pixelmapper universe"
              data-universe
              @change="setUniverse(i, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <div class="flex min-h-7 items-center gap-2">
            <span class="flex w-24 shrink-0 items-center gap-1 text-muted-foreground">Port-Address <InfoTip topic="portAddress" /></span>
            <input
              type="number"
              min="0"
              max="32767"
              :class="[field, 'w-20 font-mono']"
              :value="o.portAddress"
              aria-label="Port-Address"
              data-port-address
              @change="setPortAddress(i, ($event.target as HTMLInputElement).value)"
            >
            <span class="font-mono text-[11px] text-muted-foreground">{{ formatPortAddress(o.portAddress) }}</span>
          </div>
          <button
            type="button"
            class="self-end rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Remove this output"
            data-remove-output
            @click="removeOutput(i)"
          >
            Remove
          </button>
        </div>
      </CardSection>
    </section>
    <button
      v-if="outputs.length < MAX_MANUAL_OUTPUTS"
      type="button"
      class="self-start px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px]"
      data-add-output
      @click="addOutput"
    >
      + Output
    </button>
  </div>
</template>
