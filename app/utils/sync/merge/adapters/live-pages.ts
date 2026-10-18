import { registerRebaseAdapter, passThroughAdapter, type RebaseAdapter, type RebaseContext } from './registry';
import { findPage, findSection, findWidget, ok, removeConflict, skip } from './helpers';

/**
 * Rebase adapters for live-mode commands (`live.*`, `livePages` and
 * `liveControllers`). These are by-id commands, so rebasing means: skip when
 * the referenced page/widget/section/controller no longer exists, filter
 * multi-target payloads to the targets that still exist, and keep entities a
 * collaborator modified before a delete (needs `previous`).
 */

// ── Payloads ─────────────────────────────────────────────────────────────────

interface PageRef { pageId: string }
interface WidgetRef extends PageRef { widgetId: string }
interface SectionRef extends PageRef { sectionId: string }

// ── Guards ───────────────────────────────────────────────────────────────────

/** Skip unless `payload.pageId` exists. */
const requirePage: RebaseAdapter = (payload: PageRef, { current }) =>
  findPage(current, payload.pageId) ? ok(payload) : skip(payload, `live page ${payload.pageId} no longer exists`);

/** Skip unless `payload.widgetId` (or `twinId`) exists on its page. */
const requireWidget: RebaseAdapter = (payload: WidgetRef & { twinId?: string }, { current }) => {
  const widgetId = payload.widgetId ?? payload.twinId;
  return findWidget(current, payload.pageId, widgetId)
    ? ok(payload)
    : skip(payload, `live widget ${widgetId} no longer exists`);
};

/** Skip unless `payload.sectionId` exists on its page. */
const requireSection: RebaseAdapter = (payload: SectionRef, { current }) =>
  findSection(current, payload.pageId, payload.sectionId)
    ? ok(payload)
    : skip(payload, `live section ${payload.sectionId} no longer exists`);

/**
 * Builds an adapter for a payload holding a list of widget references
 * (`listKey`), filtered to widgets that still exist.
 */
function filterWidgets(listKey: string, idOf: (item: any) => string): RebaseAdapter {
  return (payload: PageRef & Record<string, unknown>, ctx: RebaseContext) => {
    const items = (payload[listKey] as unknown[] | undefined) ?? [];
    const kept = items.filter(item => findWidget(ctx.current, payload.pageId, idOf(item)));
    if (kept.length === 0) return skip(payload, 'live widgets no longer exist');
    return ok({ ...payload, [listKey]: kept });
  };
}

// ── Deletes ──────────────────────────────────────────────────────────────────

/** `live.removePage`: skip if gone or modified remotely (`remove-modify`). */
const removePageAdapter: RebaseAdapter = (payload: PageRef, { current, previous }) => {
  const page = findPage(current, payload.pageId);
  if (!page) return skip(payload, `live page ${payload.pageId} already removed`);
  const conflict = removeConflict(findPage(previous, payload.pageId), page, payload.pageId, ['livePages', payload.pageId]);
  return conflict ? skip(payload, `live page ${payload.pageId} was modified remotely; kept`, [conflict]) : ok(payload);
};

/** `live.removeWidget`: skip if gone or modified remotely. */
const removeWidgetAdapter: RebaseAdapter = (payload: WidgetRef, { current, previous }) => {
  const widget = findWidget(current, payload.pageId, payload.widgetId);
  if (!widget) return skip(payload, `live widget ${payload.widgetId} already removed`);
  const path = ['livePages', payload.pageId, 'widgets', payload.widgetId];
  const conflict = removeConflict(findWidget(previous, payload.pageId, payload.widgetId), widget, payload.widgetId, path);
  return conflict ? skip(payload, `live widget ${payload.widgetId} was modified remotely; kept`, [conflict]) : ok(payload);
};

/** `live.removeSection`: skip if gone or modified remotely. */
const removeSectionAdapter: RebaseAdapter = (payload: SectionRef, { current, previous }) => {
  const section = findSection(current, payload.pageId, payload.sectionId);
  if (!section) return skip(payload, `live section ${payload.sectionId} already removed`);
  const path = ['livePages', payload.pageId, 'sections', payload.sectionId];
  const conflict = removeConflict(findSection(previous, payload.pageId, payload.sectionId), section, payload.sectionId, path);
  return conflict ? skip(payload, `live section ${payload.sectionId} was modified remotely; kept`, [conflict]) : ok(payload);
};

/** `live.removeController`: skip if the controller instance is gone. */
const removeControllerAdapter: RebaseAdapter = (payload: { instanceId: string }, { current }) => {
  const exists = current.liveControllers?.some(c => c.id === payload.instanceId);
  return exists ? ok(payload) : skip(payload, `controller ${payload.instanceId} already removed`);
};

// ── Registration ─────────────────────────────────────────────────────────────

/** Register all live-mode adapters. */
export function registerLivePageAdapters(): void {
  // Additions with fresh ids → replay as recorded.
  registerRebaseAdapter('live.addPage', passThroughAdapter);
  registerRebaseAdapter('live.addController', passThroughAdapter);
  // Need their page.
  registerRebaseAdapter('live.updatePage', requirePage);
  registerRebaseAdapter('live.addWidget', requirePage);
  registerRebaseAdapter('live.addSection', requirePage);
  // Need their widget.
  registerRebaseAdapter('live.moveWidget', requireWidget);
  registerRebaseAdapter('live.updateMapping', requireWidget);
  registerRebaseAdapter('live.setControllerInstance', requireWidget);
  registerRebaseAdapter('live.updateChildMapping', requireWidget);
  // Need their section.
  registerRebaseAdapter('live.updateSection', requireSection);
  registerRebaseAdapter('live.setSectionMembers', requireSection);
  // `section.setActive` live-op: stale member keys are harmless.
  registerRebaseAdapter('section.setActive', requireSection);
  // Multi-widget payloads: keep existing targets only.
  registerRebaseAdapter('live.batchMoveWidgets', filterWidgets('updates', u => u.widgetId));
  registerRebaseAdapter('live.batchSetGroupIds', filterWidgets('updates', u => u.widgetId));
  registerRebaseAdapter('live.groupWidgets', filterWidgets('widgetIds', id => id));
  registerRebaseAdapter('live.ungroupWidgets', filterWidgets('widgetIds', id => id));
  // Deletes.
  registerRebaseAdapter('live.removePage', removePageAdapter);
  registerRebaseAdapter('live.removeWidget', removeWidgetAdapter);
  registerRebaseAdapter('live.removeSection', removeSectionAdapter);
  registerRebaseAdapter('live.removeController', removeControllerAdapter);
}
