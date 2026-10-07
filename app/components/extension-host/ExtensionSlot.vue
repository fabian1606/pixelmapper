<script setup lang="ts">
/**
 * Renders all extension contributions for one slot (ADR §5.3).
 *
 * Usually rendered by layout primitives with a `position` (the id is derived
 * from the inherited primitive path). May be used explicitly with a full
 * `id` where no primitive fits. Renders nothing when empty (no wrapper DOM).
 *
 * `menuItem` contributions are exposed through the `menu-item` scoped slot so
 * the surrounding menu can render them in its own style; without that slot a
 * plain button is rendered.
 */
import { computed } from 'vue';
import type { MenuItemSpec, ScopeSnapshot } from '@pixelmapper/extension-api';
import { useScopeSnapshot, useScopes } from '~/composables/extensions/use-scope';
import { getSlotContributions, recordRenderedSlot } from '~/utils/extensions/slot-matching';
import { slotIdOf, useSlotPath } from '~/utils/extensions/slot-path';
import ExtensionContributionHost from './ExtensionContributionHost.vue';

const props = defineProps<{
  /** Full slot id, e.g. `'properties/color:actions'`. Takes precedence over `position`. */
  id?: string;
  /** Position relative to the enclosing primitive path, e.g. `'actions'`. */
  position?: string;
}>();

defineSlots<{
  /** Custom rendering of menu-item contributions. */
  'menu-item'?(p: { item: MenuItemSpec; extensionId: string; run: () => void; disabled: boolean }): unknown;
}>();

const path = useSlotPath();
const scopes = useScopeSnapshot();
/** Names of the scopes available here (no projection). */
const scopeNames = Object.keys(useScopes());

/** Resolved full slot id. */
const slotId = computed(() => props.id ?? slotIdOf(path.value, props.position ?? ''));

/**
 * Visible contributions: matching the slot and passing `when`. Scopes are
 * only read (projected) when a matching contribution has a `when`, so empty
 * slots cost a map lookup.
 */
const visible = computed(() => {
  const id = slotId.value;
  if (import.meta.dev) recordRenderedSlot(id, scopeNames);
  const matching = getSlotContributions(id);
  if (matching.length === 0) return matching;
  if (!matching.some(c => c.contribution.when)) return matching;
  const snap = scopes.value;
  return matching.filter((c) => {
    const when = c.contribution.when;
    if (!when) return true;
    try {
      return when(snap);
    }
    catch (err) {
      console.error(`[extensions] "when" of "${c.extensionId}" in "${id}" threw:`, err);
      return false;
    }
  });
});

/** Runs a menu item action with the current scope snapshot. */
function runItem(item: MenuItemSpec, snap: ScopeSnapshot) {
  try {
    item.action(snap);
  }
  catch (err) {
    console.error('[extensions] menu item action failed:', err);
  }
}
</script>

<template>
  <template v-for="c in visible" :key="`${c.extensionId}:${c.contribution.slot}:${c.contribution.menuItem?.label ?? ''}`">
    <ExtensionContributionHost
      v-if="c.contribution.component"
      :extension-id="c.extensionId"
      :slot-id="slotId"
      :component="c.contribution.component"
    />
    <template v-else-if="c.contribution.menuItem">
      <slot
        name="menu-item"
        :item="c.contribution.menuItem"
        :extension-id="c.extensionId"
        :disabled="c.contribution.menuItem.disabled?.(scopes) ?? false"
        :run="() => runItem(c.contribution.menuItem!, scopes)"
      >
        <button
          type="button"
          class="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent disabled:opacity-50"
          :disabled="c.contribution.menuItem.disabled?.(scopes) ?? false"
          @click="runItem(c.contribution.menuItem!, scopes)"
        >
          {{ c.contribution.menuItem.label }}
        </button>
      </slot>
    </template>
  </template>
</template>
