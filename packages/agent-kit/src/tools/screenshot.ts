/**
 * `screenshot` tool (ADR 0002 §5, opt-in eighth tool): returns a PNG of the
 * stage plus a short caption. For visual questions (layout, orientation,
 * "how does it look"); `observe` stays the tool for verifying animation.
 */
import { ScreenshotRequestSchema } from '../screenshot';
import { errorOutput, messageOf, parseInput, text, toolInputSchema } from './shared';
import type { ToolDefinition } from './types';

/** Message when the host cannot render screenshots at all. */
export const SCREENSHOT_UNSUPPORTED = 'screenshot is not supported by this host. Use inspect (fixtures.get detail.heads, orientation) instead.';

/** Creates the `screenshot` tool. */
export function createScreenshotTool(): ToolDefinition {
  return {
    name: 'screenshot',
    description: [
      'Look at the stage: returns a PNG image plus a short caption. Use it to check a layout or rotation change, to get an overview before arranging fixtures (instead of drawing an ASCII map), and to show the user how something looks when they ask. It is a still image: verify animation, timing and colors over time with `observe`, not with screenshots.',
      'view "layout" (default): schematic top view generated from the project model, independent of what the UI shows. Shows the 0–1 world with x/y ticks (x left→right, y top→bottom, like fixture x/y), each fixture\'s footprint at its real position and rotation, every head/pixel as a dot in its real world position filled with its current output color (neutral grey when no live output is available), head 0 marked with a ring and an arrow from head 0 to the last head (patch direction), and fixture labels.',
      'Options: labels "name" | "id" | "none"; highlight [fixtureIds] (accent outline); region "fit" (default) | "world" | { minX, minY, maxX, maxY } to zoom; size = longer side in px (default 1024, max 2048).',
      'view "canvas": capture of the 2D editor canvas exactly as the user sees it (camera, selection, live colors; HTML overlays such as modifier handles are not included). Only works while the editor page is open; otherwise use "layout".',
      'Rotation: clockwise degrees on the 2D canvas. For bars whose heads run along their own x axis: 0° = head 0 on the left, heads run toward +x; 90° = heads run toward +y (top→bottom); 180° = right→left; 270° = bottom→top. fixtures.find / fixtures.get report the measured direction as orientation.runs.',
    ].join('\n'),
    inputSchema: toolInputSchema(ScreenshotRequestSchema),
    annotations: { readOnlyHint: true, title: 'Screenshot of the stage' },
    async run(host, input, ctx) {
      const parsed = parseInput('screenshot', ScreenshotRequestSchema, input);
      if (!parsed.ok) return parsed.output;
      if (!host.screenshot) return errorOutput(SCREENSHOT_UNSUPPORTED);
      try {
        const shot = await host.screenshot(parsed.value, { actor: ctx.actor, signal: ctx.signal });
        return {
          content: [
            text(shot.caption),
            { type: 'image', data: shot.data, mimeType: shot.mimeType },
          ],
        };
      }
      catch (err) {
        return errorOutput(`screenshot failed: ${messageOf(err)}`);
      }
    },
  };
}
