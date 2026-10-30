/**
 * `screenshot` tool against the app host (WP-K): image + caption content,
 * canvas view errors, opt-in listing and unsupported hosts.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createScreenshotTool, createTools, SCREENSHOT_UNSUPPORTED, type AgentHost, type ToolOutput } from '@pixelmapper/agent-kit';
import { useEngineStore } from '~/stores/engine-store';
import { createOperationRegistry, registerCoreOperations } from '~/utils/operations';
import { makeBarFixture, resetOperationState, stubOperationGlobals } from '~/utils/operations/test-utils';
import { createAppAgentHost } from '../host';
import type { DrawScene } from './draw-commands';
import { CANVAS_UNAVAILABLE } from './index';

const tool = createScreenshotTool();
const ctx = { actor: 'agent:mcp:test' as const };
let scenes: DrawScene[] = [];

/** Host whose rasterizer records scenes and returns a fixed payload. */
function host(): AgentHost {
  return createAppAgentHost({
    registry: registerCoreOperations(createOperationRegistry()),
    observe: async () => null,
    screenshot: {
      rasterize: async (scene) => {
        scenes.push(scene);
        return { data: 'iVBORw0KGgo=', width: scene.width, height: scene.height };
      },
      editorCanvas: () => null,
    },
  });
}

/** Text of the first text item. */
function textOf(out: ToolOutput): string {
  const t = out.content.find(c => c.type === 'text');
  return t && t.type === 'text' ? t.text : '';
}

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  scenes = [];
  useEngineStore().sceneNodes = [makeBarFixture('front', 0.5, 0.2), makeBarFixture('left', 0.2, 0.5, 90)];
});

describe('screenshot tool', () => {
  it('is opt-in in createTools', () => {
    expect(createTools().map(t => t.name)).not.toContain('screenshot');
    expect(createTools({ screenshot: true }).map(t => t.name)).toContain('screenshot');
  });

  it('returns a caption and PNG image content for the layout view', async () => {
    const out = await tool.run(host(), { size: 640, highlight: ['left'] }, ctx);
    expect(out.isError).toBeUndefined();
    expect(out.content[1]).toEqual({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
    expect(textOf(out)).toContain('Layout view');
    expect(textOf(out)).toContain('"left" (left) at 0.200, 0.500 · rotation 90° · 4 heads run top→bottom');
    expect(Math.max(scenes[0]!.width, scenes[0]!.height)).toBe(640);
  });

  it('explains when the editor canvas is not open', async () => {
    const out = await tool.run(host(), { view: 'canvas' }, ctx);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(CANVAS_UNAVAILABLE);
  });

  it('rejects invalid input and hosts without screenshot support', async () => {
    expect((await tool.run(host(), { size: 99_999 }, ctx)).isError).toBe(true);
    const { screenshot: _s, ...bare } = host();
    const out = await tool.run(bare as AgentHost, {}, ctx);
    expect(textOf(out)).toBe(SCREENSHOT_UNSUPPORTED);
  });
});
