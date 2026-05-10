import { registerLiveOp } from '~/stores/live-bus-store';

// ── widget.trigger ─────────────────────────────────────────────────────────────
// Broadcast a button press so all clients see the visual feedback.
// Actual DMX side-effects are applied locally by the pressing client; this op
// only carries the visual event so remote canvases can animate the button.

export interface WidgetTriggerPayload {
  pageId: string;
  widgetId: string;
  active: boolean; // true = pressed, false = released
}

registerLiveOp<WidgetTriggerPayload>('widget.trigger', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ pageId, widgetId, active }) => {
    // Handled reactively by LiveButtonWidget via useLiveWidgetTriggers()
    widgetTriggerHandlers.forEach(h => h(pageId, widgetId, active));
  },
});

// Simple in-process event bus for widget trigger events (UI components subscribe)
type TriggerHandler = (pageId: string, widgetId: string, active: boolean) => void;
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
}

registerLiveOp<WidgetSlidePayload>('widget.slide', {
  scope: 'shared',
  throttle: 'raf',
  apply: ({ pageId, widgetId, value, value2 }) => {
    widgetSlideHandlers.forEach(h => h(pageId, widgetId, value, value2));
  },
});

type SlideHandler = (pageId: string, widgetId: string, value: number, value2?: number) => void;
const widgetSlideHandlers = new Set<SlideHandler>();

export function onWidgetSlide(handler: SlideHandler): () => void {
  widgetSlideHandlers.add(handler);
  return () => widgetSlideHandlers.delete(handler);
}
