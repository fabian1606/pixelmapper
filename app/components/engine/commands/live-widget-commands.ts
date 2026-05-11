import type { Command } from '../composables/use-history';
import { type SerializableCommand, registerCommand } from './serializable-command';
import type { LivePage, LiveWidget, LiveMapping, ControllerChildBinding } from '~/utils/live/types';
import { useLiveModeStore } from '~/stores/live-mode-store';

function getLiveStore() {
  return useLiveModeStore();
}

// ─── AddLivePage ──────────────────────────────────────────────────────────────

export class AddLivePageCommand implements SerializableCommand {
  readonly commandType = 'live.addPage';
  description = 'Add Live Page';

  constructor(private page: LivePage) {}

  execute() { getLiveStore().addPage(this.page); }
  undo() { getLiveStore().removePage(this.page.id); }
  inverse(): Command { return new RemoveLivePageCommand(this.page.id, this.page); }
  toPayload() { return { page: this.page }; }
}

registerCommand('live.addPage', (p) => new AddLivePageCommand(p.page));

// ─── RemoveLivePage ───────────────────────────────────────────────────────────

export class RemoveLivePageCommand implements SerializableCommand {
  readonly commandType = 'live.removePage';
  description = 'Remove Live Page';
  private _removed: LivePage | null = null;

  constructor(private pageId: string, removedSnapshot?: LivePage) {
    if (removedSnapshot) this._removed = JSON.parse(JSON.stringify(removedSnapshot));
  }

  execute() {
    const store = getLiveStore();
    if (!this._removed) {
      const found = store.pages.find((p: LivePage) => p.id === this.pageId);
      if (found) this._removed = JSON.parse(JSON.stringify(found));
    }
    store.removePage(this.pageId);
  }
  undo() {
    if (this._removed) getLiveStore().addPage(JSON.parse(JSON.stringify(this._removed)));
  }
  inverse(): Command | null {
    if (!this._removed) return null;
    return new AddLivePageCommand(JSON.parse(JSON.stringify(this._removed)));
  }
  toPayload() { return { pageId: this.pageId }; }
}

registerCommand('live.removePage', (p) => new RemoveLivePageCommand(p.pageId));

// ─── UpdateLivePage ───────────────────────────────────────────────────────────

export class UpdateLivePageCommand implements SerializableCommand {
  readonly commandType = 'live.updatePage';
  description = 'Update Live Page';
  private _before: Partial<Omit<LivePage, 'id' | 'widgets'>> | null = null;

  constructor(private pageId: string, private changes: Partial<Omit<LivePage, 'id' | 'widgets'>>) {}

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    if (page) {
      this._before = Object.fromEntries(Object.keys(this.changes).map(k => [k, (page as any)[k]])) as any;
    }
    store.updatePage(this.pageId, this.changes);
  }
  undo() {
    if (this._before) getLiveStore().updatePage(this.pageId, this._before);
  }
  inverse(): Command | null {
    if (!this._before) return null;
    return new UpdateLivePageCommand(this.pageId, this._before);
  }
  toPayload() { return { pageId: this.pageId, changes: this.changes }; }
}

registerCommand('live.updatePage', (p) => new UpdateLivePageCommand(p.pageId, p.changes));

// ─── AddLiveWidget ────────────────────────────────────────────────────────────

export class AddLiveWidgetCommand implements SerializableCommand {
  readonly commandType = 'live.addWidget';
  description = 'Add Widget';

  constructor(private pageId: string, private widget: LiveWidget) {}

  execute() { getLiveStore().addWidget(this.pageId, this.widget); }
  undo() { getLiveStore().removeWidget(this.pageId, this.widget.id); }
  inverse(): Command { return new RemoveLiveWidgetCommand(this.pageId, this.widget.id, this.widget); }
  toPayload() { return { pageId: this.pageId, widget: this.widget }; }
}

registerCommand('live.addWidget', (p) => new AddLiveWidgetCommand(p.pageId, p.widget));

// ─── RemoveLiveWidget ─────────────────────────────────────────────────────────

export class RemoveLiveWidgetCommand implements SerializableCommand {
  readonly commandType = 'live.removeWidget';
  description = 'Remove Widget';
  private _removed: LiveWidget | null = null;

  constructor(private pageId: string, private widgetId: string, removedSnapshot?: LiveWidget) {
    if (removedSnapshot) this._removed = JSON.parse(JSON.stringify(removedSnapshot));
  }

  execute() {
    const store = getLiveStore();
    if (!this._removed) {
      const page = store.pages.find((p: LivePage) => p.id === this.pageId);
      const w = page?.widgets.find((x: LiveWidget) => x.id === this.widgetId);
      if (w) this._removed = JSON.parse(JSON.stringify(w));
    }
    store.removeWidget(this.pageId, this.widgetId);
  }
  undo() {
    if (this._removed) getLiveStore().addWidget(this.pageId, JSON.parse(JSON.stringify(this._removed)));
  }
  inverse(): Command | null {
    if (!this._removed) return null;
    return new AddLiveWidgetCommand(this.pageId, JSON.parse(JSON.stringify(this._removed)));
  }
  toPayload() { return { pageId: this.pageId, widgetId: this.widgetId }; }
}

registerCommand('live.removeWidget', (p) => new RemoveLiveWidgetCommand(p.pageId, p.widgetId));

// ─── MoveResizeLiveWidget ─────────────────────────────────────────────────────

export class MoveResizeLiveWidgetCommand implements SerializableCommand {
  readonly commandType = 'live.moveWidget';
  description = 'Move Widget';
  private _before: { gridX: number; gridY: number; gridW: number; gridH: number } | null = null;

  constructor(
    private pageId: string,
    private widgetId: string,
    private gridX: number,
    private gridY: number,
    private gridW: number,
    private gridH: number,
    /** Optional original state. Required for correct local undo because the
     *  live drag preview has already mutated the widget by the time execute()
     *  runs. When omitted (e.g. on remote replay), execute() captures the
     *  current state instead. */
    before?: { gridX: number; gridY: number; gridW: number; gridH: number },
  ) {
    if (before) this._before = { ...before };
  }

  execute() {
    const store = getLiveStore();
    if (!this._before) {
      const page = store.pages.find((p: LivePage) => p.id === this.pageId);
      const widget = page?.widgets.find((w: LiveWidget) => w.id === this.widgetId);
      if (widget) this._before = { gridX: widget.gridX, gridY: widget.gridY, gridW: widget.gridW, gridH: widget.gridH };
    }
    store.moveResizeWidget(this.pageId, this.widgetId, this.gridX, this.gridY, this.gridW, this.gridH);
  }
  undo() {
    if (this._before) {
      const { gridX, gridY, gridW, gridH } = this._before;
      getLiveStore().moveResizeWidget(this.pageId, this.widgetId, gridX, gridY, gridW, gridH);
    }
  }
  inverse(): Command | null {
    if (!this._before) return null;
    return new MoveResizeLiveWidgetCommand(
      this.pageId, this.widgetId,
      this._before.gridX, this._before.gridY, this._before.gridW, this._before.gridH,
      { gridX: this.gridX, gridY: this.gridY, gridW: this.gridW, gridH: this.gridH },
    );
  }
  toPayload() { return { pageId: this.pageId, widgetId: this.widgetId, gridX: this.gridX, gridY: this.gridY, gridW: this.gridW, gridH: this.gridH }; }
}

registerCommand('live.moveWidget', (p) => new MoveResizeLiveWidgetCommand(p.pageId, p.widgetId, p.gridX, p.gridY, p.gridW, p.gridH));

// ─── UpdateWidgetMapping ──────────────────────────────────────────────────────

export class UpdateWidgetMappingCommand implements SerializableCommand {
  readonly commandType = 'live.updateMapping';
  description = 'Update Widget Mapping';
  private _before: Partial<Pick<LiveWidget, 'mapping' | 'label' | 'color'>> | null = null;

  constructor(
    private pageId: string,
    private widgetId: string,
    private patch: Partial<Pick<LiveWidget, 'mapping' | 'label' | 'color'>>,
  ) {}

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    const widget = page?.widgets.find((w: LiveWidget) => w.id === this.widgetId);
    if (widget) {
      this._before = {};
      if ('mapping' in this.patch) this._before.mapping = JSON.parse(JSON.stringify(widget.mapping));
      if ('label' in this.patch) this._before.label = widget.label;
      if ('color' in this.patch) this._before.color = widget.color;
    }
    store.updateWidgetMapping(this.pageId, this.widgetId, this.patch);
  }
  undo() {
    if (this._before) getLiveStore().updateWidgetMapping(this.pageId, this.widgetId, this._before);
  }
  inverse(): Command | null {
    if (!this._before) return null;
    return new UpdateWidgetMappingCommand(this.pageId, this.widgetId, this._before);
  }
  toPayload() { return { pageId: this.pageId, widgetId: this.widgetId, patch: this.patch }; }
}

registerCommand('live.updateMapping', (p) => new UpdateWidgetMappingCommand(p.pageId, p.widgetId, p.patch));

// ─── BatchMoveResizeLiveWidgets ───────────────────────────────────────────────
// Atomic move/resize of multiple widgets. Used by multi-drag so the whole
// movement is one history step and one network update.

export interface BatchMoveResizeUpdate {
  widgetId: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
}

export class BatchMoveResizeLiveWidgetsCommand implements SerializableCommand {
  readonly commandType = 'live.batchMoveWidgets';
  description = 'Move Widgets';
  private _before: BatchMoveResizeUpdate[] | null = null;

  /**
   * @param before  Original positions captured BEFORE the live drag preview.
   *                Required locally (preview already mutated widgets).
   *                On remote replay omit it — execute() will capture the
   *                actual pre-replay state from the store.
   */
  constructor(
    private pageId: string,
    private updates: BatchMoveResizeUpdate[],
    before?: BatchMoveResizeUpdate[],
  ) {
    if (before) this._before = before.map(b => ({ ...b }));
  }

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    if (!page) return;
    if (!this._before) {
      this._before = [];
      for (const u of this.updates) {
        const w = page.widgets.find((x: LiveWidget) => x.id === u.widgetId);
        if (w) this._before.push({ widgetId: u.widgetId, gridX: w.gridX, gridY: w.gridY, gridW: w.gridW, gridH: w.gridH });
      }
    }
    for (const u of this.updates) {
      store.moveResizeWidget(this.pageId, u.widgetId, u.gridX, u.gridY, u.gridW, u.gridH);
    }
  }
  undo() {
    if (!this._before) return;
    const store = getLiveStore();
    for (const u of this._before) {
      store.moveResizeWidget(this.pageId, u.widgetId, u.gridX, u.gridY, u.gridW, u.gridH);
    }
  }
  inverse(): Command | null {
    if (!this._before) return null;
    return new BatchMoveResizeLiveWidgetsCommand(
      this.pageId,
      this._before.map(b => ({ ...b })),
      this.updates.map(u => ({ ...u })),
    );
  }
  toPayload() { return { pageId: this.pageId, updates: this.updates }; }
}

registerCommand('live.batchMoveWidgets', (p) => new BatchMoveResizeLiveWidgetsCommand(p.pageId, p.updates));

// ─── GroupLiveWidgets ─────────────────────────────────────────────────────────
// Assign the same groupId to a set of widgets. Their previous groupIds (if any)
// are remembered so undo restores them.

export class GroupLiveWidgetsCommand implements SerializableCommand {
  readonly commandType = 'live.groupWidgets';
  description = 'Group Widgets';
  private _before: Array<{ widgetId: string; groupId: string | null }> = [];

  constructor(private pageId: string, private widgetIds: string[], private groupId: string) {}

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    if (!page) return;
    this._before = [];
    for (const id of this.widgetIds) {
      const w = page.widgets.find((x: LiveWidget) => x.id === id);
      if (w) {
        this._before.push({ widgetId: id, groupId: w.groupId ?? null });
        store.setWidgetGroupId(this.pageId, id, this.groupId);
      }
    }
  }
  undo() {
    const store = getLiveStore();
    for (const u of this._before) {
      store.setWidgetGroupId(this.pageId, u.widgetId, u.groupId);
    }
  }
  inverse(): Command | null {
    if (this._before.length === 0) return null;
    return new BatchSetWidgetGroupIdsCommand(
      this.pageId,
      this._before.map(b => ({ widgetId: b.widgetId, groupId: b.groupId })),
      this.widgetIds.map(id => ({ widgetId: id, groupId: this.groupId })),
    );
  }
  toPayload() { return { pageId: this.pageId, widgetIds: this.widgetIds, groupId: this.groupId }; }
}

registerCommand('live.groupWidgets', (p) => new GroupLiveWidgetsCommand(p.pageId, p.widgetIds, p.groupId));

// ─── UngroupLiveWidgets ───────────────────────────────────────────────────────

export class UngroupLiveWidgetsCommand implements SerializableCommand {
  readonly commandType = 'live.ungroupWidgets';
  description = 'Ungroup Widgets';
  private _before: Array<{ widgetId: string; groupId: string | null }> = [];

  constructor(private pageId: string, private widgetIds: string[]) {}

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    if (!page) return;
    this._before = [];
    for (const id of this.widgetIds) {
      const w = page.widgets.find((x: LiveWidget) => x.id === id);
      if (w) {
        this._before.push({ widgetId: id, groupId: w.groupId ?? null });
        store.setWidgetGroupId(this.pageId, id, null);
      }
    }
  }
  undo() {
    const store = getLiveStore();
    for (const u of this._before) {
      if (u.groupId !== null) store.setWidgetGroupId(this.pageId, u.widgetId, u.groupId);
    }
  }
  inverse(): Command | null {
    if (this._before.length === 0) return null;
    return new BatchSetWidgetGroupIdsCommand(
      this.pageId,
      this._before.map(b => ({ widgetId: b.widgetId, groupId: b.groupId })),
      this.widgetIds.map(id => ({ widgetId: id, groupId: null as string | null })),
    );
  }
  toPayload() { return { pageId: this.pageId, widgetIds: this.widgetIds }; }
}

registerCommand('live.ungroupWidgets', (p) => new UngroupLiveWidgetsCommand(p.pageId, p.widgetIds));

// ─── BatchSetWidgetGroupIds ───────────────────────────────────────────────────
// Used as the inverse of group/ungroup so we can restore each widget's previous
// groupId individually (which may be a mix of "had a group" and "had none").

export interface BatchGroupIdUpdate {
  widgetId: string;
  groupId: string | null; // null = clear
}

export class BatchSetWidgetGroupIdsCommand implements SerializableCommand {
  readonly commandType = 'live.batchSetGroupIds';
  description = 'Restore Groups';
  private _before: BatchGroupIdUpdate[] | null = null;

  constructor(
    private pageId: string,
    private updates: BatchGroupIdUpdate[],
    before?: BatchGroupIdUpdate[],
  ) {
    if (before) this._before = before.map(b => ({ ...b }));
  }

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    if (!page) return;
    if (!this._before) {
      this._before = [];
      for (const u of this.updates) {
        const w = page.widgets.find((x: LiveWidget) => x.id === u.widgetId);
        if (w) this._before.push({ widgetId: u.widgetId, groupId: w.groupId ?? null });
      }
    }
    for (const u of this.updates) {
      store.setWidgetGroupId(this.pageId, u.widgetId, u.groupId);
    }
  }
  undo() {
    if (!this._before) return;
    const store = getLiveStore();
    for (const u of this._before) {
      store.setWidgetGroupId(this.pageId, u.widgetId, u.groupId);
    }
  }
  inverse(): Command | null {
    if (!this._before) return null;
    return new BatchSetWidgetGroupIdsCommand(
      this.pageId,
      this._before.map(b => ({ ...b })),
      this.updates.map(u => ({ ...u })),
    );
  }
  toPayload() { return { pageId: this.pageId, updates: this.updates }; }
}

registerCommand('live.batchSetGroupIds', (p) => new BatchSetWidgetGroupIdsCommand(p.pageId, p.updates));

// ─── UpdateControllerChildMapping ─────────────────────────────────────────────
// Updates a single per-control binding inside a controller-twin widget.
// Children are not canvas widgets — they are mapping records keyed by controlId.

export class UpdateControllerChildMappingCommand implements SerializableCommand {
  readonly commandType = 'live.updateChildMapping';
  description = 'Update Controller Mapping';
  private _before: Partial<Pick<ControllerChildBinding, 'mapping' | 'label' | 'color'>> | null = null;
  private _wasMissing = false;

  constructor(
    private pageId: string,
    private twinId: string,
    private controlId: string,
    private patch: Partial<Pick<ControllerChildBinding, 'mapping' | 'label' | 'color'>>,
  ) {}

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    const twin = page?.widgets.find((w: LiveWidget) => w.id === this.twinId);
    if (twin) {
      const child = twin.controllerChildren?.find(c => c.controlId === this.controlId);
      if (child) {
        this._before = {};
        if ('mapping' in this.patch) this._before.mapping = JSON.parse(JSON.stringify(child.mapping));
        if ('label' in this.patch) this._before.label = child.label;
        if ('color' in this.patch) this._before.color = child.color;
      } else {
        this._wasMissing = true;
        this._before = { mapping: { type: 'none' } };
      }
    }
    store.updateControllerChildMapping(this.pageId, this.twinId, this.controlId, this.patch);
  }
  undo() {
    if (!this._before) return;
    const store = getLiveStore();
    if (this._wasMissing) {
      // Restore the empty default — the child didn't exist before.
      store.updateControllerChildMapping(this.pageId, this.twinId, this.controlId, { mapping: { type: 'none' } });
    } else {
      store.updateControllerChildMapping(this.pageId, this.twinId, this.controlId, this._before);
    }
  }
  inverse(): Command | null {
    if (!this._before) return null;
    return new UpdateControllerChildMappingCommand(this.pageId, this.twinId, this.controlId, this._before);
  }
  toPayload() {
    return { pageId: this.pageId, twinId: this.twinId, controlId: this.controlId, patch: this.patch };
  }
}

registerCommand(
  'live.updateChildMapping',
  (p) => new UpdateControllerChildMappingCommand(p.pageId, p.twinId, p.controlId, p.patch),
);
