import type { Command } from '../composables/use-history';
import { type SerializableCommand, registerCommand } from './serializable-command';
import type { LivePage, LiveWidget, LiveMapping } from '~/utils/live/types';
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
  toPayload() { return { page: this.page }; }
}

registerCommand('live.addPage', (p) => new AddLivePageCommand(p.page));

// ─── RemoveLivePage ───────────────────────────────────────────────────────────

export class RemoveLivePageCommand implements SerializableCommand {
  readonly commandType = 'live.removePage';
  description = 'Remove Live Page';
  private _removed: LivePage | null = null;

  constructor(private pageId: string) {}

  execute() {
    const store = getLiveStore();
    this._removed = store.pages.find((p: LivePage) => p.id === this.pageId) ?? null;
    store.removePage(this.pageId);
  }
  undo() {
    if (this._removed) getLiveStore().addPage(this._removed);
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
  toPayload() { return { pageId: this.pageId, widget: this.widget }; }
}

registerCommand('live.addWidget', (p) => new AddLiveWidgetCommand(p.pageId, p.widget));

// ─── RemoveLiveWidget ─────────────────────────────────────────────────────────

export class RemoveLiveWidgetCommand implements SerializableCommand {
  readonly commandType = 'live.removeWidget';
  description = 'Remove Widget';
  private _removed: LiveWidget | null = null;

  constructor(private pageId: string, private widgetId: string) {}

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    this._removed = page?.widgets.find((w: LiveWidget) => w.id === this.widgetId) ?? null;
    store.removeWidget(this.pageId, this.widgetId);
  }
  undo() {
    if (this._removed) getLiveStore().addWidget(this.pageId, this._removed);
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
  ) {}

  execute() {
    const store = getLiveStore();
    const page = store.pages.find((p: LivePage) => p.id === this.pageId);
    const widget = page?.widgets.find((w: LiveWidget) => w.id === this.widgetId);
    if (widget) this._before = { gridX: widget.gridX, gridY: widget.gridY, gridW: widget.gridW, gridH: widget.gridH };
    store.moveResizeWidget(this.pageId, this.widgetId, this.gridX, this.gridY, this.gridW, this.gridH);
  }
  undo() {
    if (this._before) {
      const { gridX, gridY, gridW, gridH } = this._before;
      getLiveStore().moveResizeWidget(this.pageId, this.widgetId, gridX, gridY, gridW, gridH);
    }
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
  toPayload() { return { pageId: this.pageId, widgetId: this.widgetId, patch: this.patch }; }
}

registerCommand('live.updateMapping', (p) => new UpdateWidgetMappingCommand(p.pageId, p.widgetId, p.patch));
