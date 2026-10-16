<script setup lang="ts">
/**
 * Shows the modifier design principles (plan M11.4) from the bundled
 * `architecture/guides/modifier-design-principles.md`, with light formatting
 * (headings, bold labels, list items). Opened from "New from code".
 */
import { computed } from 'vue';
import principles from '~~/architecture/guides/modifier-design-principles.md?raw';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

const open = defineModel<boolean>('open', { default: false });

/** One rendered line. */
interface Line { kind: 'h2' | 'p' | 'li' | 'rule'; text: string }

/** Markdown lines → simple blocks (the title line is dropped). */
const lines = computed<Line[]>(() => principles.split('\n').flatMap((raw): Line[] => {
  const l = raw.trim();
  if (!l || l.startsWith('# ')) return [];
  if (l === '---') return [{ kind: 'rule', text: '' }];
  if (l.startsWith('## ')) return [{ kind: 'h2', text: l.slice(3) }];
  if (l.startsWith('- ')) return [{ kind: 'li', text: l.slice(2) }];
  return [{ kind: 'p', text: l }];
}));

/** Splits `**bold**` runs for rendering. */
function runs(text: string): { bold: boolean; text: string }[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(t => (t.startsWith('**') ? { bold: true, text: t.slice(2, -2) } : { bold: false, text: t.replace(/\*([^*]+)\*/g, '$1') }));
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl h-[80vh] flex flex-col" data-overlay-root>
      <DialogHeader>
        <DialogTitle>Modifier design principles</DialogTitle>
      </DialogHeader>
      <ScrollArea class="flex-1 min-h-0 pr-3">
        <div class="flex flex-col gap-1.5 text-sm" data-principles>
          <template v-for="(l, i) in lines" :key="i">
            <hr v-if="l.kind === 'rule'" class="my-2 border-border">
            <h3 v-else-if="l.kind === 'h2'" class="mt-3 font-semibold">{{ l.text }}</h3>
            <p v-else :class="l.kind === 'li' ? 'pl-4 -indent-3 text-muted-foreground' : 'text-muted-foreground'">
              <span v-if="l.kind === 'li'">• </span><template v-for="(r, k) in runs(l.text)" :key="k"><strong v-if="r.bold" class="text-foreground">{{ r.text }}</strong><template v-else>{{ r.text }}</template></template>
            </p>
          </template>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
