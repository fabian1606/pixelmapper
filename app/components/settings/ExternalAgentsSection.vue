<script setup lang="ts">
/**
 * Settings → MCP Server (plan M3): lets Claude Code / Claude Desktop drive
 * this window through `pixelmapper-mcp`. Per-device toggle, pairing token,
 * live connection status and copyable setup snippets. The desktop app reads
 * the token and CLI path from this machine (`getMcpSetupInfo`), so pairing
 * is one click there.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { getAgentBridge, getMcpSetupInfo } from '#platform';
import { claudeCodeCommand, claudeDesktopConfig, UNKNOWN_MCP_SETUP, type McpSetupInfo } from '~/utils/agents/mcp-setup';
import { notify } from '~/composables/use-notifications';
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

/** Local setup info (token file, token, CLI path); empty in the browser. */
const setup = ref<McpSetupInfo>({ ...UNKNOWN_MCP_SETUP });
onMounted(async () => { setup.value = await getMcpSetupInfo(); });

/** True when this machine's token differs from the stored one (desktop). */
const localTokenAvailable = computed(() => !!setup.value.token && normalizeToken(setup.value.token) !== settings.value.token);

/** Pairs with the token found on this machine and turns the bridge on. */
async function useLocalToken() {
  if (!setup.value.token) return;
  await bridge.setToken(setup.value.token);
  if (!settings.value.enabled) await bridge.setEnabled(true);
}

/** Snippets with the real CLI path when known. */
const codeCommand = computed(() => claudeCodeCommand(setup.value.cliPath));
const desktopConfig = computed(() => claudeDesktopConfig(setup.value.cliPath));

/** Copies a snippet and confirms with a toast. */
async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify({ title: `Copied ${what}` }, 3000);
  } catch (error) {
    console.warn('[mcp] clipboard write failed', error);
  }
}
</script>

<template>
  <section id="settings-mcp" class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <Label for="agent-bridge-enabled">MCP Server</Label>
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
      <div v-if="localTokenAvailable" class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Found a token on this computer ({{ setup.tokenFile }}).</span>
        <Button variant="secondary" size="sm" @click="useLocalToken">Use it</Button>
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
      <p v-if="!setup.token">1. Print the pairing token and paste it above:</p>
      <code v-if="!setup.token" class="block rounded bg-background px-2 py-1 font-mono text-foreground select-all">bun run mcp token</code>
      <div class="flex items-center justify-between gap-2">
        <p>{{ setup.token ? '1.' : '2.' }} Claude Code: run in a terminal</p>
        <Button variant="ghost" size="sm" class="h-6 px-2" @click="copy(codeCommand, 'Claude Code command')">Copy</Button>
      </div>
      <code class="block rounded bg-background px-2 py-1 font-mono text-foreground select-all break-all">{{ codeCommand }}</code>
      <div class="flex items-center justify-between gap-2">
        <p>{{ setup.token ? '2.' : '3.' }} Claude Desktop: add to claude_desktop_config.json</p>
        <Button variant="ghost" size="sm" class="h-6 px-2" @click="copy(desktopConfig, 'Claude Desktop config')">Copy</Button>
      </div>
      <pre class="rounded bg-background px-2 py-1 font-mono text-foreground select-all whitespace-pre-wrap break-all">{{ desktopConfig }}</pre>
      <p v-if="!setup.cliPath">Replace &lt;repo&gt; with the Pixelmapper checkout. If Claude Desktop cannot find bun, use its absolute path (<code>which bun</code>).</p>
      <p v-else>If Claude Desktop cannot find bun, use its absolute path (<code>which bun</code>).</p>
    </div>
  </section>
</template>
