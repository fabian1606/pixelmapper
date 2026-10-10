<script setup lang="ts">
/**
 * "New modifier from code" (plan P4.3, dev-facing): edit `manifest.json`,
 * `modifier.ts` (and the optional panel file), build + validate in the
 * browser, preview, publish and add to the stack. Uses the
 * `buildFromCode` seam that the AI loop will drive later.
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Loader2, Hammer, Upload, Plus, RotateCcw } from 'lucide-vue-next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';
import { buildFromCode, type CreateResult } from '~/utils/plugins/create-plugin';
import { publish } from '~/utils/plugins/plugin-store';
import type { PluginVisibility } from '~/utils/plugins/plugin-remote';
import { createModifier } from '~/utils/engine/modifiers';
import ModifierPreview from './ModifierPreview.vue';
import { usePluginDraft } from './use-plugin-draft';

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  /** Add an instance of the built plugin to the current stack. */
  add: [hash: string];
}>();

const route = useRoute();
const { manifestText, modifierSource, uiSource, reset } = usePluginDraft();

const building = ref(false);
const publishing = ref(false);
const result = ref<CreateResult | null>(null);
const publishState = ref<{ ok: boolean; message: string } | null>(null);
const visibility = ref<PluginVisibility>('project');

/** Current project id (for project visibility). */
const projectId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null));

/** Panel file named by the manifest, if any (shows the third tab). */
const uiPanel = computed(() => {
  try {
    return (JSON.parse(manifestText.value) as { ui?: { panel?: string } }).ui?.panel ?? null;
  }
  catch {
    return null;
  }
});

/** A preview instance of the built plugin. */
const previewInstance = computed(() => {
  const pkg = result.value?.pkg;
  return pkg ? createModifier(pkg.hash, { id: `preview-${pkg.hash}`, distribution: { mode: 'linear' }, targetChannels: ['DIMMER'] }) : null;
});

/** Builds and validates the draft. */
async function build() {
  building.value = true;
  publishState.value = null;
  try {
    const source: Record<string, string> = { 'modifier.ts': modifierSource.value };
    if (uiPanel.value) source[uiPanel.value] = uiSource.value;
    result.value = await buildFromCode({ manifest: manifestText.value, source });
  }
  catch (err) {
    result.value = { pkg: null, diagnostics: [{ stage: 'compile', severity: 'error', message: String(err) }] };
  }
  finally {
    building.value = false;
  }
}

/** Publishes the built package to the registry. */
async function doPublish(pkg: ContentPluginPackage) {
  publishing.value = true;
  try {
    await publish(pkg, visibility.value, visibility.value === 'project' ? projectId.value : null);
    publishState.value = { ok: true, message: `Published (${visibility.value}).` };
  }
  catch (err) {
    publishState.value = { ok: false, message: (err as Error).message };
  }
  finally {
    publishing.value = false;
  }
}

/**
 * Adds the built plugin to the stack and closes. Inside a project the
 * package is published to it first (if not yet), so collaborators can
 * resolve the hash (ADR §6.10); offline it stays local.
 */
async function add(pkg: ContentPluginPackage) {
  if (!publishState.value?.ok && projectId.value) {
    try {
      await publish(pkg, 'project', projectId.value);
    }
    catch (err) {
      console.warn('[new-modifier] not published, collaborators cannot resolve it yet:', err);
    }
  }
  emit('add', pkg.hash);
  open.value = false;
}

/** Severity → text color. */
const SEVERITY_CLASS = { error: 'text-destructive', warning: 'text-amber-500', info: 'text-muted-foreground' } as const;
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-5xl w-[95vw] h-[85vh] flex flex-col gap-3" data-overlay-root>
      <DialogHeader>
        <DialogTitle>New modifier from code</DialogTitle>
        <DialogDescription class="text-xs">
          AssemblyScript content plugin — see architecture/guides/authoring-content-plugins.md.
        </DialogDescription>
      </DialogHeader>

      <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4">
        <!-- Sources -->
        <Tabs default-value="modifier" class="min-h-0 flex flex-col">
          <TabsList class="self-start">
            <TabsTrigger value="modifier">modifier.ts</TabsTrigger>
            <TabsTrigger value="manifest">manifest.json</TabsTrigger>
            <TabsTrigger v-if="uiPanel" value="ui">{{ uiPanel }}</TabsTrigger>
          </TabsList>
          <TabsContent value="modifier" class="flex-1 min-h-0">
            <textarea v-model="modifierSource" spellcheck="false" class="w-full h-full resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-primary" />
          </TabsContent>
          <TabsContent value="manifest" class="flex-1 min-h-0">
            <textarea v-model="manifestText" spellcheck="false" class="w-full h-full resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-primary" />
          </TabsContent>
          <TabsContent v-if="uiPanel" value="ui" class="flex-1 min-h-0">
            <textarea v-model="uiSource" spellcheck="false" class="w-full h-full resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-primary" />
          </TabsContent>
        </Tabs>

        <!-- Build / results -->
        <div class="min-h-0 flex flex-col gap-3 overflow-y-auto">
          <div class="flex gap-2">
            <Button class="flex-1 gap-2" :disabled="building" @click="build">
              <Loader2 v-if="building" class="h-4 w-4 animate-spin" />
              <Hammer v-else class="h-4 w-4" />
              Build & validate
            </Button>
            <Button variant="ghost" size="icon" title="Reset to template" @click="reset(); result = null">
              <RotateCcw class="h-4 w-4" />
            </Button>
          </div>

          <template v-if="result">
            <div class="text-xs font-medium" :class="result.pkg ? 'text-emerald-500' : 'text-destructive'">
              {{ result.pkg ? 'Valid plugin' : 'Build failed' }}
            </div>
            <ul v-if="result.diagnostics.length" class="space-y-1 text-[11px] font-mono">
              <li v-for="(d, i) in result.diagnostics" :key="i" :class="SEVERITY_CLASS[d.severity]" class="whitespace-pre-wrap break-words">
                [{{ d.stage }}] {{ d.message }}
              </li>
            </ul>
            <div v-if="result.metrics" class="text-[11px] text-muted-foreground">
              {{ result.metrics.medianFrameMs.toFixed(3) }} ms/frame @512 · output {{ result.metrics.outputMin.toFixed(2) }}…{{ result.metrics.outputMax.toFixed(2) }}
            </div>

            <template v-if="result.pkg && previewInstance">
              <ModifierPreview :modifier="previewInstance" :height="48" />
              <div class="text-[10px] text-muted-foreground break-all">{{ result.pkg.hash }}</div>

              <div class="flex gap-2 items-center">
                <Select v-model="visibility">
                  <SelectTrigger class="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private" class="text-xs">Private</SelectItem>
                    <SelectItem value="project" class="text-xs" :disabled="!projectId">This project</SelectItem>
                    <SelectItem value="public" class="text-xs">Public</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" class="gap-1" :disabled="publishing" @click="doPublish(result.pkg)">
                  <Loader2 v-if="publishing" class="h-3.5 w-3.5 animate-spin" />
                  <Upload v-else class="h-3.5 w-3.5" />
                  Publish
                </Button>
              </div>
              <div v-if="publishState" class="text-[11px]" :class="publishState.ok ? 'text-emerald-500' : 'text-destructive'">
                {{ publishState.message }}
              </div>
              <Button class="gap-2" @click="add(result.pkg)">
                <Plus class="h-4 w-4" /> Add to stack
              </Button>
            </template>
          </template>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
