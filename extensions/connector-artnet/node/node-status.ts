/**
 * Connector status of an `artnet-node` connector from the backend state and
 * whether the node currently answers (M5.3). Also the user-facing texts for
 * backend states, shared by the connector and the bridge hint.
 */
import type { ConnectorStatus } from '@pixelmapper/extension-api';
import type { BackendState } from '../bridge/backend';
import type { NodeState } from '../bridge/protocol-model';
import { PMNET_SERVE_COMMAND } from '../bridge/shared';

/** Status + message shown on the connector card. */
export interface NodeConnectorStatus {
  status: ConnectorStatus;
  message: string | null;
}

/** One-line text for a backend state that blocks Art-Net, or null when connected/idle. */
export function backendProblem(state: BackendState): string | null {
  switch (state.kind) {
    case 'unsupported':
      return state.reason;
    case 'unreachable':
      return `Art-Net bridge not running — start it with “${PMNET_SERVE_COMMAND}”`;
    case 'incompatible':
      if (state.reason === 'noHello') return `Another program answers on ${state.url} (old ArtNet bridge?) — start “${PMNET_SERVE_COMMAND}” instead`;
      if (state.reason === 'appTooOld') return `The Art-Net bridge is newer than this app (protocol ${state.protocol}) — reload Pixelmapper`;
      return `Bridge update needed (pmnet-bridge ${state.bridgeVersion ?? '?'} speaks protocol ${state.protocol ?? '?'})`;
    default:
      return null;
  }
}

/**
 * Connector status: `connected` only when the bridge is connected and the
 * node answers (with a message when the bridge rejected the DMX route
 * table); errors the user must fix are `error` (card offers Retry).
 */
export function nodeConnectorStatus(
  state: BackendState,
  node: NodeState | null,
  bound: { nodeId: string | null; ip: string | null },
  dmxError: string | null = null,
): NodeConnectorStatus {
  if (state.kind === 'unsupported' || state.kind === 'incompatible') return { status: 'error', message: backendProblem(state) };
  if (state.kind === 'unreachable') return { status: 'connecting', message: backendProblem(state) };
  if (state.kind !== 'connected') return { status: 'connecting', message: null };
  // The bridge kept its old route table: routes added since get no DMX. The
  // status stays connected so the accepted routes keep their output.
  if (node) return { status: 'connected', message: dmxError ? `The bridge rejected the DMX routes: ${dmxError}` : null };
  if (bound.nodeId) return { status: 'connecting', message: 'Node offline — waiting for its ArtPollReply' };
  if (bound.ip) return { status: 'connecting', message: `Waiting for a reply from ${bound.ip}` };
  return { status: 'connecting', message: 'Choose a node below' };
}
