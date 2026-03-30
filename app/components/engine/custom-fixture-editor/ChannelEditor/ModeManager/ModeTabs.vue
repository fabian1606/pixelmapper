<script setup lang="ts">
import { Plus } from 'lucide-vue-next';
import { ref } from 'vue';
import { type ModeDraft } from '~/utils/engine/custom-fixture-types';

const props = defineProps<{
  modes: ModeDraft[];
  activeModeIdx: number;
}>();

const emit = defineEmits<{
  (e: 'update:activeModeIdx', val: number): void;
  (e: 'add'): void;
  (e: 'rename', idx: number, name: string): void;
}>();

const editingIdx = ref<number | null>(null);
const editingName = ref('');

function startRename(idx: number) {
  editingIdx.value = idx;
  editingName.value = props.modes[idx]?.name ?? '';
}

function commitRename() {
  if (editingIdx.value !== null && editingName.value.trim()) {
    emit('rename', editingIdx.value, editingName.value.trim());
  }
  editingIdx.value = null;
}
</script>

<template>
  <div class="flex items-center gap-1 border-b bg-muted/10 px-2 shrink-0 h-10 overflow-x-auto no-scrollbar">
    <div
      v-for="(m, mi) in modes" :key="m.id"
      class="h-full flex items-center px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer group"
      :class="activeModeIdx === mi ? 'border-primary text-foreground bg-muted/20' : 'border-transparent text-muted-foreground hover:text-foreground'"
      @click="emit('update:activeModeIdx', mi)"
    >
      <input v-if="editingIdx === mi" v-model="editingName" @blur="commitRename" @keyup.enter="commitRename" class="bg-transparent outline-none border-none w-24 text-primary" auto-focus />
      <span v-else @dblclick="startRename(mi)">{{ m.name }}</span>
    </div>
    <button class="size-6 rounded hover:bg-muted/50 flex items-center justify-center text-muted-foreground ml-1" @click="emit('add')">
      <Plus class="size-3.5" />
    </button>
  </div>
</template>
