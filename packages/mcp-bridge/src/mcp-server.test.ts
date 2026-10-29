// @vitest-environment node
// ── MCP layer tests ─────────────────────────────────────
//
// Drives `createMcpServer` with the SDK client over the in-memory transport,
// backed by a real hub and a fake app over WebSocket.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Hub } from './hub';
import { createMcpServer, normalizeClientName } from './mcp-server';
import { loadPrompts, renderPrompt } from './prompts';
import { FALLBACK_TOOLS, STATUS_TOOL_NAME, ToolCatalog } from './tool-catalog';
import { FakeApp, TEST_TOKEN, testConfig, waitFor } from './test-utils';

const cleanup: Array<() => Promise<void> | void> = [];

beforeAll(() => {
  process.env.PIXELMAPPER_MCP_QUIET = '1';
});

afterEach(async () => {
  while (cleanup.length) await Promise.resolve(cleanup.pop()!()).catch(() => {});
});

/** Creates a temp skills dir with the given relative files. */
function skillsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pm-skills-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Hub + MCP server + SDK client connected in memory. */
async function setup(options: { skills?: string; cacheFile?: string | null } = {}) {
  const hub = await Hub.start(testConfig(), TEST_TOKEN);
  cleanup.push(() => hub.close());
  const server = createMcpServer({
    backend: hub,
    catalog: new ToolCatalog(options.cacheFile ?? null),
    skillsDir: options.skills ?? '/nonexistent/skills',
  });
  const client = new Client({ name: 'Claude Code', version: '1.0.0' });
  let listChanged = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChanged++;
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanup.push(() => client.close());
  return { hub, server, client, listChangedCount: () => listChanged };
}

/** Joins the text blocks of a tool result. */
function text(result: { content?: unknown }): string {
  return (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n');
}

describe('MCP tools', () => {
  it('lists fallback tools + status before any app connected', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...FALLBACK_TOOLS.map((t) => t.name), STATUS_TOOL_NAME]);
  });

  it('switches to the app tools and emits tools/list_changed', async () => {
    const { client, hub, listChangedCount } = await setup();
    const app = await FakeApp.connect(hub.port);
    cleanup.push(() => app.close());
    await waitFor(() => listChangedCount() === 1);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['inspect', 'observe', STATUS_TOOL_NAME]);
    expect(tools[0]!.inputSchema).toMatchObject({ required: ['selector'] });

    // After disconnect the last-known list stays → no spurious change.
    await app.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(listChangedCount()).toBe(1);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['inspect', 'observe', STATUS_TOOL_NAME]);
  });

  it('forwards calls with the normalized MCP client name', async () => {
    const { client, hub } = await setup();
    const app = await FakeApp.connect(hub.port);
    cleanup.push(() => app.close());
    app.onCall = (call) => ({
      type: 'result',
      content: [{ type: 'text', text: 'ok' }, { type: 'json', json: { client: call.client, input: call.input } }],
    });
    const result = await client.callTool({ name: 'inspect', arguments: { selector: 'project' } });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('ok');
    expect(JSON.parse((result.content as Array<{ text: string }>)[1]!.text)).toEqual({
      client: 'claude-code',
      input: { selector: 'project' },
    });
  });

  it('marks app-reported domain errors as isError', async () => {
    const { client, hub } = await setup();
    const app = await FakeApp.connect(hub.port);
    cleanup.push(() => app.close());
    app.onCall = () => ({ type: 'result', isError: true, content: [{ type: 'text', text: 'expectation failed' }] });
    const result = await client.callTool({ name: 'observe', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('expectation failed');
  });

  it('returns a clear isError result when no app is connected', async () => {
    const { client } = await setup();
    const result = await client.callTool({ name: 'inspect', arguments: { selector: 'project' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^no_app: .*Settings → External agents/);
  });

  it('answers the status tool locally', async () => {
    const { client } = await setup();
    const result = await client.callTool({ name: STATUS_TOOL_NAME, arguments: {} });
    expect(text(result)).toContain('app: not connected');
    expect(text(result)).toContain('mcp client: claude-code');
  });

  it('serves the last-known tool list from the disk cache', async () => {
    const dir = skillsDir({});
    const cacheFile = join(dir, 'tools.json');
    writeFileSync(cacheFile, JSON.stringify([{ name: 'apply', inputSchema: { type: 'object' } }]));
    const { client } = await setup({ cacheFile });
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['apply', STATUS_TOOL_NAME]);
  });
});

describe('MCP prompts', () => {
  it('returns no prompts when the skills dir does not exist', async () => {
    const { client } = await setup();
    expect((await client.listPrompts()).prompts).toEqual([]);
  });

  it('lists and renders prompts from **/prompts/*.md', async () => {
    const dir = skillsDir({
      'effect-authoring/prompts/create-effect.md':
        '---\nname: create-effect\ndescription: Build an effect\narguments:\n  - name: idea\n    required: true\n---\nBuild this effect: {{idea}}\n',
      'effect-authoring/prompts/add-controls.md': 'Add a control page.',
      'effect-authoring/SKILL.md': 'not a prompt',
    });
    const { client } = await setup({ skills: dir });
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['add-controls', 'create-effect']);
    expect(prompts.find((p) => p.name === 'create-effect')).toMatchObject({
      description: 'Build an effect',
      arguments: [{ name: 'idea', required: true }],
    });

    const got = await client.getPrompt({ name: 'create-effect', arguments: { idea: 'a wave from the corners' } });
    expect(got.messages[0]!.content).toEqual({ type: 'text', text: 'Build this effect: a wave from the corners' });
    await expect(client.getPrompt({ name: 'create-effect', arguments: {} })).rejects.toThrow(/idea/);
    await expect(client.getPrompt({ name: 'missing' })).rejects.toThrow(/Unknown prompt/);
  });
});

describe('helpers', () => {
  it('normalizes client names', () => {
    expect(normalizeClientName('Claude Code')).toBe('claude-code');
    expect(normalizeClientName('claude-ai')).toBe('claude-ai');
    expect(normalizeClientName(undefined)).toBe('unknown');
  });

  it('keeps unknown placeholders and blanks optional ones', () => {
    const [prompt] = loadPrompts(skillsDir({ 'x/prompts/p.md': '---\narguments:\n  - name: a\n---\n{{a}}|{{b}}' }));
    expect(renderPrompt(prompt!, {})).toBe('|{{b}}');
  });
});
