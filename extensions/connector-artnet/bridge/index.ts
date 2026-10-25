/**
 * Public surface of the Art-Net bridge client inside `connector-artnet`.
 * Later features (RDM device list, RDM pages, firmware UI) import from here.
 */
export * from './protocol-model';
export * from './protocol-messages';
export * from './backend';
export { NODE_PID_RANGE, PM_DEVICE, RDM_NACK_REASON, RDM_PID, isManufacturerPid } from './rdm-constants';
export {
  MAX_MESSAGE_BYTES,
  NODE_NAME_MAX_BYTES,
  dmxTargetProblem,
  isBroadcastIp,
  isBroadcastUid,
  nodeNameError,
  utf8ByteLength,
} from './command-limits';
export { NodeDirectory } from './node-directory';
export { WsBridgeBackend } from './ws-bridge-backend';
export {
  DEFAULT_BRIDGE_URL,
  PMNET_DOWNLOAD_URL,
  PMNET_SERVE_COMMAND,
  bridgeUnsupportedReason,
  getArtNetBackend,
  getBridgeUrl,
  getNodeDirectory,
  installArtNetBackend,
  setBridgeUrl,
  startArtNetDiscovery,
} from './shared';
