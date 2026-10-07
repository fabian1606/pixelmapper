/**
 * Connector types from extensions (ADR D17: every connector is an
 * extension; the core keeps only the frame plumbing). Replaces the former
 * hard-coded connector lists.
 */
import type { Connector, ConnectorDefinition } from '@pixelmapper/extension-api';
import { getContributions } from '~/utils/extensions/registry';

/** A registered connector type with its owning extension. */
export interface RegisteredConnector {
  extensionId: string;
  def: ConnectorDefinition;
}

/** All connector types of one direction. */
export function listConnectorTypes(direction: ConnectorDefinition['direction'] = 'output'): RegisteredConnector[] {
  return getContributions('connectors')
    .map(c => ({ extensionId: c.extensionId, def: c.contribution }))
    .filter(c => c.def.direction === direction);
}

/** A connector type by id. */
export function getConnectorType(type: string): RegisteredConnector | undefined {
  return getContributions('connectors')
    .map(c => ({ extensionId: c.extensionId, def: c.contribution }))
    .find(c => c.def.type === type);
}

/** Restores a connector from a stored config; null when its extension is missing. */
export function restoreConnector(type: string, id: string, config: Record<string, unknown>): Connector | null {
  const reg = getConnectorType(type);
  if (!reg) return null;
  try {
    return reg.def.fromConfig(id, config);
  }
  catch (err) {
    console.error(`[connectors] cannot restore ${type} ${id}:`, err);
    return null;
  }
}
