import { getAppShell } from '#platform';
import { flushOpenSession } from '~/utils/sync/unload-handlers';

/**
 * Desktop quit hook (ADR 0004 §3.1): before the window closes or the app
 * quits, the backend (`src-tauri/src/lifecycle.rs`) waits until pending
 * outbox rows and the open project's working snapshot are written to
 * IndexedDB (bounded by a timeout). Local-only projects persist only through
 * the working snapshot, so edits of the last second would be lost otherwise.
 * Web: `onBeforeQuit` is a no-op; `beforeunload` stays best-effort.
 */
export default defineNuxtPlugin(() => {
  getAppShell().onBeforeQuit(flushOpenSession);
});
