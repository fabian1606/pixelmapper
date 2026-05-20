import type { Command } from '../composables/use-history';
import { type SerializableCommand, registerCommand } from './serializable-command';
import { useConnectionsStore } from '~/stores/connections-store';
import { fromConfig, applyConfig } from '~/utils/connectors/registry';

// Connector persistence is modelled on AddLiveControllerCommand /
// RemoveLiveControllerCommand in live-widget-commands.ts — every mutation
// flows through useHistory().execute(), which routes it into the
// project_changes tail via pushChange (batched, beforeunload-safe). The
// ConnectorSnapshot baked into ProjectSnapshot remains as a redundant
// fallback if the tail is empty.

type ConnectorType = 'websocket' | 'serial';

// ─── Add ──────────────────────────────────────────────────────────────────────

export class AddConnectorCommand implements SerializableCommand {
  readonly commandType = 'connector.add';
  description = 'Add Connector';

  constructor(
    private connectorId: string,
    private connectorType: ConnectorType,
    private initialConfig: Record<string, unknown> = {},
  ) {}

  execute() {
    const store = useConnectionsStore();
    if (store.connectors.find(c => c.id === this.connectorId)) return;
    const c = fromConfig(this.connectorType, this.connectorId, this.initialConfig);
    if (c) store.add(c);
  }

  undo() {
    useConnectionsStore().remove(this.connectorId);
  }

  inverse(): Command {
    return new RemoveConnectorCommand(this.connectorId, this.connectorType, this.initialConfig);
  }

  toPayload() {
    return { id: this.connectorId, type: this.connectorType, config: this.initialConfig };
  }
}

registerCommand('connector.add', (p) =>
  new AddConnectorCommand(p.id, p.type as ConnectorType, p.config ?? {}),
);

// ─── Remove ───────────────────────────────────────────────────────────────────

export class RemoveConnectorCommand implements SerializableCommand {
  readonly commandType = 'connector.remove';
  description = 'Remove Connector';

  constructor(
    private connectorId: string,
    private connectorType: ConnectorType,
    private restoredConfig: Record<string, unknown>,
  ) {}

  execute() {
    useConnectionsStore().remove(this.connectorId);
  }

  undo() {
    const store = useConnectionsStore();
    if (store.connectors.find(c => c.id === this.connectorId)) return;
    const c = fromConfig(this.connectorType, this.connectorId, this.restoredConfig);
    if (c) store.add(c);
  }

  inverse(): Command {
    return new AddConnectorCommand(this.connectorId, this.connectorType, this.restoredConfig);
  }

  toPayload() {
    return { id: this.connectorId, type: this.connectorType, config: this.restoredConfig };
  }
}

registerCommand('connector.remove', (p) =>
  new RemoveConnectorCommand(p.id, p.type as ConnectorType, p.config ?? {}),
);

// ─── Update (full-replace config) ─────────────────────────────────────────────

export class UpdateConnectorConfigCommand implements SerializableCommand {
  readonly commandType = 'connector.update';
  description = 'Update Connector';
  private _before: Record<string, unknown> | undefined;

  constructor(
    private connectorId: string,
    private nextConfig: Record<string, unknown>,
  ) {}

  execute() {
    const c = useConnectionsStore().connectors.find(x => x.id === this.connectorId);
    if (!c) return;
    if (this._before === undefined) this._before = c.getConfig();
    applyConfig(c, this.nextConfig);
  }

  undo() {
    if (this._before === undefined) return;
    const c = useConnectionsStore().connectors.find(x => x.id === this.connectorId);
    if (c) applyConfig(c, this._before);
  }

  inverse(): Command | null {
    if (this._before === undefined) return null;
    return new UpdateConnectorConfigCommand(this.connectorId, this._before);
  }

  toPayload() {
    return { id: this.connectorId, config: this.nextConfig };
  }
}

registerCommand('connector.update', (p) =>
  new UpdateConnectorConfigCommand(p.id, p.config ?? {}),
);
