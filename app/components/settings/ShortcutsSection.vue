<script setup lang="ts">
/**
 * Settings → Shortcuts: every rebindable editor shortcut, grouped by where
 * it is active (`shortcut-registry.ts`). Changes apply immediately and are
 * stored on this device.
 */
import { SCOPE_TITLES, SHORTCUTS, type ShortcutScope } from '~/utils/shortcuts/shortcut-registry';
import { resetBindings } from '~/composables/use-shortcut-bindings';
import ShortcutRow from '~/components/settings/ShortcutRow.vue';
import { Button } from '@/components/ui/button';

const SCOPES = Object.keys(SCOPE_TITLES) as ShortcutScope[];
</script>

<template>
  <section id="settings-shortcuts" class="flex flex-col gap-3">
    <div class="flex items-start justify-between gap-4">
      <p class="text-xs text-muted-foreground">
        Click a key to change it. A key used elsewhere on the same page moves to the new action.
        Stored on this device only.
      </p>
      <Button variant="outline" size="sm" class="h-7 shrink-0 text-xs" @click="resetBindings()">
        Reset all
      </Button>
    </div>
    <div class="flex max-h-[55vh] flex-col gap-4 overflow-y-auto pr-1">
      <div v-for="scope in SCOPES" :key="scope">
        <h3 class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ SCOPE_TITLES[scope] }}
        </h3>
        <div class="divide-y divide-border/50">
          <ShortcutRow v-for="def in SHORTCUTS.filter(s => s.scope === scope)" :key="def.id" :def="def" />
        </div>
      </div>
    </div>
  </section>
</template>
