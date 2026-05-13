import { registerLiveOp } from '~/stores/live-bus-store';

// ── widget.trigger ─────────────────────────────────────────────────────────────
// Broadcast a button press so all clients see the visual feedback.
// Actual DMX side-effects are applied locally by the pressing client; this op
// only carries the visual event so remote canvases can animate the button.

export interface WidgetTriggerPayload {
  pageId: string;
  widgetId: string;
  active: boolean; // true = pressed, false = released
  /** When the widget is a controller-twin, identifies which sub-control. */
  controlId?: string;
}

registerLiveOp<WidgetTriggerPayload>('widget.trigger', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ pageId, widgetId, active, controlId }) => {
    // Handled reactively by LiveButtonWidget via useLiveWidgetTriggers()
    widgetTriggerHandlers.forEach(h => h(pageId, widgetId, active, controlId));
  },
});

// Simple in-process event bus for widget trigger events (UI components subscribe)
type TriggerHandler = (pageId: string, widgetId: string, active: boolean, controlId?: string) => void;
const widgetTriggerHandlers = new Set<TriggerHandler>();

export function onWidgetTrigger(handler: TriggerHandler): () => void {
  widgetTriggerHandlers.add(handler);
  return () => widgetTriggerHandlers.delete(handler);
}

// ── widget.slide ───────────────────────────────────────────────────────────────
// Broadcast slider/xy-pad drag values in real time (ephemeral, not persisted).
// Remote clients update the DMX channel visually — same pattern as channel.update.

export interface WidgetSlidePayload {
  pageId: string;
  widgetId: string;
  value: number;   // 0–1 normalized
  value2?: number; // for xy-pad second axis
  /** When the widget is a controller-twin, identifies which sub-fader. */
  controlId?: string;
}

registerLiveOp<WidgetSlidePayload>('widget.slide', {
  scope: 'shared',
  throttle: 'raf',
  apply: ({ pageId, widgetId, value, value2, controlId }) => {
    widgetSlideHandlers.forEach(h => h(pageId, widgetId, value, value2, controlId));
  },
});

type SlideHandler = (pageId: string, widgetId: string, value: number, value2?: number, controlId?: string) => void;
const widgetSlideHandlers = new Set<SlideHandler>();

export function onWidgetSlide(handler: SlideHandler): () => void {
  widgetSlideHandlers.add(handler);
  return () => widgetSlideHandlers.delete(handler);
}

// ── section.setActive ──────────────────────────────────────────────────────────
// Broadcast the runtime "active members" set of a section. The latched state of
// single-select / multi-select sections lives only in liveStore.activeSectionMembers
// (a Map<sectionId, Set<memberKey>>) and was previously not synced across tabs —
// so tab B only saw the brief `widget.trigger` flash when tab A latched a section.
// This op is a snapshot (replaces the local set) and is idempotent.

export interface SectionSetActivePayload {
  pageId: string;
  sectionId: string;
  /** memberKey({widgetId, controlId?}) values currently active. */
  keys: string[];
}

registerLiveOp<SectionSetActivePayload>('section.setActive', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ pageId, sectionId, keys }) => {
    // Lazy import so this module can be imported before Pinia is initialized —
    // same pattern as live-bus-store's handlePageChange.
    import('~/stores/live-mode-store').then(({ useLiveModeStore }) => {
      const liveStore = useLiveModeStore();
      // Only mutate when the op belongs to the page we're currently viewing,
      // otherwise we'd silently latch state on a non-visible page.
      if (liveStore.activePageId !== pageId) return;
      const map = new Map(liveStore.activeSectionMembers);
      map.set(sectionId, new Set(keys));
      liveStore.activeSectionMembers = map;
    });
  },
});

// ── twin.snapshot ──────────────────────────────────────────────────────────────
// Bulk push of every controller-twin's visual state + latched section state.
// Used on presence:join so a late peer sees current pressed buttons, fader
// positions, and latched section selections in one broadcast — instead of N
// rAF-coalesced widget.slide ops where only the last would win.

export interface TwinSnapshotPayload {
  twins: Array<{
    pageId: string;
    widgetId: string;
    pressed: string[];
    faders: Array<[string, number]>;
  }>;
  /** Latched section state of the active page, keyed by sectionId. */
  sections?: Array<{ pageId: string; sectionId: string; keys: string[] }>;
}

registerLiveOp<TwinSnapshotPayload>('twin.snapshot', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ twins, sections }) => {
    for (const t of twins) {
      for (const controlId of t.pressed) {
        widgetTriggerHandlers.forEach(h => h(t.pageId, t.widgetId, true, controlId));
      }
      for (const [controlId, value] of t.faders) {
        widgetSlideHandlers.forEach(h => h(t.pageId, t.widgetId, value, undefined, controlId));
      }
    }
    if (sections && sections.length) {
      import('~/stores/live-mode-store').then(({ useLiveModeStore }) => {
        const liveStore = useLiveModeStore();
        const map = new Map(liveStore.activeSectionMembers);
        for (const s of sections) {
          if (liveStore.activePageId !== s.pageId) continue;
          map.set(s.sectionId, new Set(s.keys));
        }
        liveStore.activeSectionMembers = map;
      });
    }
  },
});
