/**
 * Registry of the mounted 2D editor canvas for `screenshot` `view: "canvas"`
 * (WP-K). `FixtureCanvas.vue` registers a capture function while it is
 * mounted (its drawing surface lives in the engine worker as an
 * OffscreenCanvas); the agent host asks it for a frame.
 */

/** Captures one PNG frame of the editor canvas. */
export type EditorCanvasCapture = () => Promise<Blob>;

/** Current capture provider (null while no editor canvas is mounted). */
let provider: EditorCanvasCapture | null = null;

/** Registers the mounted editor canvas; returns the unregister function. */
export function registerEditorCanvas(capture: EditorCanvasCapture): () => void {
  provider = capture;
  return () => {
    if (provider === capture) provider = null;
  };
}

/** The capture function of the mounted editor canvas, if any. */
export function editorCanvasCapture(): EditorCanvasCapture | null {
  return provider;
}
