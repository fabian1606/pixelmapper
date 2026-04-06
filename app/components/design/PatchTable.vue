<script setup lang="ts">
import { computed } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

const engineStore = useEngineStore();

const sortedFixtures = computed(() => {
  return [...engineStore.flatFixtures].sort((a, b) => {
    if (a.universe !== b.universe) return a.universe - b.universe;
    return a.localAddress - b.localAddress;
  });
});

function isSelected(id: string | number) {
  return engineStore.selectedIds.has(id);
}

function toggleSelection(id: string | number, event: MouseEvent) {
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    const next = new Set(engineStore.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    engineStore.selectedIds = next;
  } else {
    engineStore.selectedIds = new Set([id]);
  }
}
</script>

<template>
  <div class="flex-1 min-h-0 h-full flex flex-col bg-background overflow-hidden font-sans">
    <ScrollArea class="flex-1 h-full w-full">
      <Table>
        <TableHeader class="sticky top-0 bg-background z-10 shadow-sm">
          <TableRow>
            <TableHead class="w-[80px] pl-4">ID</TableHead>
            <TableHead>Fixture Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead class="text-center w-[60px]">Univ</TableHead>
            <TableHead class="text-center w-[80px]">Address</TableHead>
            <TableHead class="text-right w-[100px] pr-6">Channels</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="(fixture, idx) in sortedFixtures"
            :key="fixture.id"
            class="cursor-pointer transition-colors border-border/40"
            :class="[
              isSelected(fixture.id) 
                ? 'bg-amber-400/15 border-amber-500/40 hover:bg-amber-400/20 shadow-[inset_2px_0_0_rgb(251,191,36)]' 
                : 'hover:bg-muted/50'
            ]"
            @click="toggleSelection(fixture.id, $event)"
          >
            <TableCell class="font-mono text-[10px] text-muted-foreground/60 pl-4">
              #{{ idx + 1 }}
            </TableCell>
            <TableCell class="font-medium text-xs">
              {{ fixture.name }}
            </TableCell>
            <TableCell class="text-xs text-muted-foreground">
              {{ fixture.manufacturer || 'Generic' }}
            </TableCell>
            <TableCell class="text-xs text-muted-foreground/80">
              {{ fixture.fixtureType || 'Standard' }}
            </TableCell>
            <TableCell class="text-center text-xs font-mono">
              {{ fixture.universe }}
            </TableCell>
            <TableCell class="text-center text-xs font-mono">
              {{ fixture.localAddress }}
            </TableCell>
            <TableCell class="text-right text-xs font-mono text-muted-foreground pr-6">
              {{ fixture.channels.length }}ch
            </TableCell>
          </TableRow>
          
          <TableRow v-if="sortedFixtures.length === 0">
            <TableCell colspan="7" class="h-32 text-center text-muted-foreground/40 text-xs mt-10">
              No fixtures patched yet.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ScrollArea>
  </div>
</template>

<style scoped>
/* Ensure the sticky header stays on top during scroll */
:deep(thead) {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: hsl(var(--background));
}

/* Row selection styles */
.bg-amber-400\/15 {
  background-color: rgba(251, 191, 36, 0.12);
}
</style>
