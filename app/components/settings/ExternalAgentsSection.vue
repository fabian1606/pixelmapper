<script setup lang="ts">
/**
 * Settings → External agents (plan M3): lets Claude Code / Claude Desktop
 * drive this window through `pixelmapper-mcp`. Per-device toggle, pairing
 * token, live connection status and setup help.
 */
import { computed, ref, watch } from 'vue';
import { getAgentBridge } from '#platform';
import { bridgeStatusLabel } from '~/utils/agents/bridge-status';
import type { BridgeStatus } from '~/utils/agents/bridge-status';
import { normalizeToken } from '~/utils/agents/agent-bridge-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const bridge = getAgentBridge();
const settings = bridge.settings;
const status = bridge.status;

/** Token being edited; saved explicitly so typing does not reconnect per key. */
const tokenDraft = ref(settings.value.token);
watch(() => settings.value.token, (token) => { tokenDraft.value = token; });

/** True when the draft differs from the stored token. */
const tokenDirty = computed(() => normalizeToken(tokenDraft.value) !== settings.value.token);

/** Status line, e.g. "Connected · claude-code". */
const statusLabel = computed(() => bridgeStatusLabel(status.value as BridgeStatus));

/** Dot colour per state. */
const statusDot = computed(() => {
  switch (status.value.state) {
    case 'connected': return 'bg-emerald-500';
    case 'connecting':
    case 'waiting': return 'bg-amber-500';
    case 'disabled': return 'bg-muted-foreground/40';
    default: return 'bg-destructive';
  }
});

/** States after which the client stops retrying and needs a manual retry. */
const canRetry = computed(() => ['unauthorized', 'superseded', 'incompatible'].includes(status.value.state)
  && settings.value.enabled && !!settings.value.token);

/** Toggles the bridge. */
function onToggle(value: boolean) {
  void bridge.setEnabled(value);
}

/** Stores the pasted token (reconnects when enabled). */
function saveToken() {
  void bridge.setToken(tokenDraft.value);
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <Label for="agent-bridge-enabled">External agents</Label>
        <p class="text-xs text-muted-foreground">
          Let Claude Code or Claude Desktop inspect and edit this window through pixelmapper-mcp.
          Stored on this device only.
        </p>
      </div>
      <Switch
        id="agent-bridge-enabled"
        :model-value="settings.enabled"
        @update:model-value="onToggle"
      />
    </div>

    <div class="flex flex-col gap-2">
      <Label for="agent-bridge-token">Pairing token</Label>
      <div class="flex gap-2">
        <Input
          id="agent-bridge-token"
          v-model="tokenDraft"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="Paste the token printed by `bun run mcp token`"
          class="font-mono"
          @keydown.enter="saveToken"
        />
        <Button variant="outline" :disabled="!tokenDirty" @click="saveToken">Save</Button>
      </div>
    </div>

    <div class="flex items-center gap-2 text-sm">
      <span class="inline-block size-2 rounded-full" :class="statusDot" />
      <span>{{ statusLabel }}</span>
      <Button v-if="canRetry" variant="link" size="sm" class="h-auto p-0" @click="bridge.reconnect()">
        Retry
      </Button>
    </div>
    <p v-if="status.lastError && status.state !== 'connected'" class="text-xs text-muted-foreground">
      {{ status.lastError }}
    </p>

    <div class="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex flex-col gap-2">
      <p>1. Print the pairing token and paste it above:</p>
      <code class="block rounded bg-background px-2 py-1 font-mono text-foreground select-all">bun run mcp token</code>
      <p>2. Register the MCP server with Claude Code (replace &lt;repo&gt; with the Pixelmapper checkout):</p>
      <code class="block rounded bg-background px-2 py-1 font-mono text-foreground select-all break-all">claude mcp add pixelmapper -- bun run --cwd &lt;repo&gt; mcp</code>
    </div>
  </section>
</template>
