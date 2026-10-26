/**
 * End-to-end test of the Art-Net plugin against the real bridge
 * (`pmnet-bridge serve`) and the simulated node of `pixelmapper-net`
 * (`pmnet sim`: 2 tubes on port 1, 1 third-party fixture on port 2).
 *
 * Opt-in: `bun run test:e2e:artnet` (vitest.e2e.config.ts); excluded from
 * `bun run test`. Needs the hardware repo — `PIXELMAPPER_HARDWARE_DIR`, or
 * the default worktree when it exists — and cargo (or prebuilt binaries);
 * without it the suite is skipped.
 *
 * Drives the REAL plugin code — `WsBridgeBackend` (Node's WebSocket with an
 * allowed `Origin`), `NodeDirectory`, the device store, the matching
 * cascade and the firmware update manager — through the contract flows:
 * handshake, discovery, TODs (also TodNak), describe, matching, RDM SET +
 * read-back, per-port failsafe, the node-change signal of the node
 * configuration, DMX, ipProg and a tube firmware flash. The steps run in
 * order and share the processes and the connection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { BridgeCommandError } from '../bridge/backend';
import { NodeDirectory } from '../bridge/node-directory';
import { checkProtocol, type FlashProgressEvent, type LogEvent } from '../bridge/protocol-messages';
import { formatNodeId, parseNodeId, portAddressOf, type NodeState, type PortRef, type RdmDeviceDescription, type Tod } from '../bridge/protocol-model';
import { RDM_PID } from '../bridge/rdm-constants';
import { WsBridgeBackend, type WebSocketFactory } from '../bridge/ws-bridge-backend';
import { DeviceStore } from '../devices/device-store';
import { createDeviceMatcher, type DeviceMatch } from '../devices/fixture-matching';
import { checkFirmwareEligibility } from '../firmware/firmware-eligibility';
import { linkFirmwareToDevices } from '../firmware/firmware-runtime';
import { FirmwareUpdateManager } from '../firmware/firmware-update-manager';
import { listNodeTubes, readTubeFirmware } from '../firmware/tube-devices';
import { useNodeChangeSignal } from '../node-config/use-node-change-signal';
import { buildBinaries, freeTcpPort, freeUdpPort, resolveHardwareDir, startProcess, upgradeStatus, type RunningProcess } from './processes.test-support';
import { crc16Ccitt, MODEL_TUBE, tubeImageHex } from './tube-image.test-support';

// ── Setup ──────────────────────────────────────

/** Hardware repo with the bridge sources; null = suite skipped. */
const HARDWARE_DIR = resolveHardwareDir();
if (!HARDWARE_DIR) {
  console.warn('[e2e] skipped: set PIXELMAPPER_HARDWARE_DIR to a pixelmapper-hardware checkout with crates/pmnet-bridge');
}

/** Origin the bridge allows (`http://localhost:*`), like the Nuxt dev server. */
const ALLOWED_ORIGIN = 'http://localhost:3000';
/** Origin the bridge must refuse. */
const FOREIGN_ORIGIN = 'http://evil.example';
/** UID (= node id) of the simulated node. */
const SIM_NODE = '7FF0:80123456';
/** Firmware of the simulated tubes (valid test app 0.1.0). */
const SIM_TUBE_VERSION = 0x000100;
/** Firmware written by the flash step. */
const NEW_TUBE_VERSION = 0x000200;

/** Port `{ bind, index: 0 }`. */
const port = (bind: number): PortRef => ({ bind, index: 0 });

/** Node's WebSocket sending `origin` in the upgrade (browsers send the page origin). */
function websocketWithOrigin(origin: string): WebSocketFactory {
  return class extends WebSocket {
    constructor(url: string) {
      // Node's WebSocket (undici) takes `{ headers }` as a non-standard init.
      super(url, { headers: { Origin: origin } } as unknown as string[]);
    }
  };
}

/** Polls `probe` every 50 ms until it returns something truthy. */
async function waitFor<T>(what: string, probe: () => T | null | undefined | false, timeoutMs = 15_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** Runs `fn` and returns its BridgeCommandError (fails when it resolves). */
async function commandError(fn: () => Promise<unknown>): Promise<BridgeCommandError> {
  try {
    await fn();
  }
  catch (err) {
    if (err instanceof BridgeCommandError) return err;
    throw err;
  }
  throw new Error('expected the command to fail');
}

/** What the bridge/simulator reported where the contract leaves room; printed after the run. */
const findings: Record<string, unknown> = {};

describe.skipIf(!HARDWARE_DIR)('Art-Net plugin ↔ pmnet-bridge ↔ pmnet sim', () => {
  let sim: RunningProcess | null = null;
  let bridge: RunningProcess | null = null;
  let bridgePort = 0;
  let backend: WsBridgeBackend;
  let directory: NodeDirectory;
  let store: DeviceStore | null = null;
  let manager: FirmwareUpdateManager | null = null;
  let unlinkFirmware: (() => void) | null = null;
  /** Bridge `log` events (diagnostics of failures). */
  const logs: LogEvent[] = [];
  /** Every `flashProgress` event. */
  const progress: FlashProgressEvent[] = [];
  /** Describe result of the first tube (shared by later steps). */
  let tubeDescription: RdmDeviceDescription | null = null;
  /** The two tubes on port 1 and the fixture on port 2. */
  let tubes: string[] = [];
  let fixture = '';

  /** The simulated node as the directory knows it. */
  const simNode = (): NodeState | undefined => directory.getNode(SIM_NODE);

  beforeAll(async () => {
    const started = Date.now();
    const bin = buildBinaries(HARDWARE_DIR!);
    const simPort = await freeUdpPort();
    bridgePort = await freeTcpPort();
    sim = await startProcess('pmnet sim', bin.pmnet, ['sim', '--listen', `127.0.0.1:${simPort}`, '--tubes', '2', '--fixtures', '1'], /listening on/);
    bridge = await startProcess('pmnet-bridge', bin.bridge, [
      'serve', '--port', String(bridgePort), '--bind', '127.0.0.1', '--udp-port', '0', '--broadcast', `127.0.0.1:${simPort}`,
    ], /listening on ws:\/\/127\.0\.0\.1/);
    findings.setupMs = Date.now() - started;

    backend = new WsBridgeBackend({
      url: () => `ws://127.0.0.1:${bridgePort}/`,
      clientVersion: '0.0.0-e2e',
      WebSocketImpl: websocketWithOrigin(ALLOWED_ORIGIN),
    });
    backend.on('log', (e) => { logs.push(e); });
    backend.on('flashProgress', (e) => { progress.push(e); });
    directory = new NodeDirectory(backend);
  });

  afterAll(async () => {
    unlinkFirmware?.();
    manager?.dispose();
    store?.stop();
    directory?.dispose();
    backend?.stop();
    await bridge?.kill();
    await sim?.kill();
    console.info('[e2e] findings:', JSON.stringify(findings, null, 2));
    const warnings = logs.filter(l => l.level === 'warn' || l.level === 'error').map(l => `${l.level}: ${l.text}`);
    if (warnings.length) console.info('[e2e] bridge/client warnings:\n' + warnings.join('\n'));
  });

  // ── Connection ───────────────────────────────

  it('refuses a foreign Origin and accepts localhost', async () => {
    expect(await upgradeStatus(bridgePort, FOREIGN_ORIGIN)).toBe(403);
    expect(await upgradeStatus(bridgePort, ALLOWED_ORIGIN)).toBe(101);
    // The plugin's backend with a foreign Origin never gets connected.
    const foreign = new WsBridgeBackend({ url: () => `ws://127.0.0.1:${bridgePort}/`, clientVersion: '0.0.0-e2e', WebSocketImpl: websocketWithOrigin(FOREIGN_ORIGIN) });
    foreign.start();
    await waitFor('the refused backend to report unreachable', () => foreign.state.value.kind === 'unreachable', 5000);
    foreign.stop();
  });

  it('connects with the hello handshake', async () => {
    backend.start();
    const state = await waitFor('the connected state', () => (backend.state.value.kind === 'connected' ? backend.state.value : null));
    expect(checkProtocol(state.info.protocol)).toBe('ok');
    expect(state.info.protocol.split('.')[0]).toBe('1');
    expect(state.info.udp.bound).toBe(true);
    expect(typeof state.info.bridgeVersion).toBe('string');
    findings.hello = { bridge: state.info.bridgeVersion, protocol: state.info.protocol, udp: state.info.udp, interfaces: state.info.interfaces.length };
  });

  // ── Discovery ────────────────────────────────

  it('discovers the simulated node with four ports', async () => {
    const node = await waitFor('the node with 4 ports', () => (simNode()?.ports.length === 4 ? simNode() : null));
    expect(node.nodeId).toBe(SIM_NODE);
    expect(node.uid).toBe(SIM_NODE);
    expect(parseNodeId(node.nodeId)).toEqual({ kind: 'uid', uid: SIM_NODE });
    expect(formatNodeId(node.nodeId)).toBe(`UID ${SIM_NODE}`);
    expect(node.ip).toBe('127.0.0.1');
    expect(node.ports.map(p => p.port)).toEqual([1, 2, 3, 4].map(port));
    for (const p of node.ports) expect(p).toHaveProperty('failsafe');
    // pmnet-bridge 0.1 knows the failsafe mode of the lowest BindIndex only (contract §11).
    expect(node.ports[0]!.failsafe).not.toBeNull();
    findings.node = {
      shortName: node.shortName,
      longName: node.longName,
      nodeReport: node.nodeReport,
      firmware: node.firmware,
      status: { failsafeProgrammable: node.status.failsafeProgrammable, rdmSwitchable: node.status.rdmSwitchable, portDirectionSwitchable: node.status.portDirectionSwitchable },
      ports: node.ports.map(p => ({ bind: p.port.bind, direction: p.direction, out: p.outputPortAddress, in: p.inputPortAddress, portAddress: portAddressOf(p), failsafe: p.failsafe, rdm: p.output.rdm })),
    };
    // The snapshot agrees with the events.
    const snapshot = await backend.request('nodes', {});
    expect(snapshot.nodes.find(n => n.nodeId === SIM_NODE)?.ports).toHaveLength(4);
  });

  it('reads the TODs: two tubes on port 1, one fixture on port 2', async () => {
    const tod1 = await waitFor('the TOD of port 1', () => (directory.todOf(SIM_NODE, port(1))?.uids.length === 2 ? directory.todOf(SIM_NODE, port(1)) : null));
    const tod2 = await waitFor('the TOD of port 2', () => (directory.todOf(SIM_NODE, port(2))?.uids.length === 1 ? directory.todOf(SIM_NODE, port(2)) : null));
    expect(tod1.available).toBe(true);
    expect(tod2.available).toBe(true);
    expect(tod1.portAddress).toBe(portAddressOf(simNode()!.ports[0]!));
    tubes = [...tod1.uids];
    fixture = tod2.uids[0]!;
    expect(tubes.every(uid => uid.startsWith('7FF0:'))).toBe(true);
    // Ports 3/4 have no responders: ask for their TODs and record what comes.
    for (const bind of [3, 4]) await backend.request('todRequest', { nodeId: SIM_NODE, port: port(bind) });
    const others = await waitFor('TODs of ports 3 and 4', () => {
      const t3 = directory.todOf(SIM_NODE, port(3));
      const t4 = directory.todOf(SIM_NODE, port(4));
      return t3 && t4 ? [t3, t4] : null;
    }, 8000).catch(() => [directory.todOf(SIM_NODE, port(3)), directory.todOf(SIM_NODE, port(4))]);
    findings.tods = { port1: tod1.uids, port2: tod2.uids, port3: others[0] ?? 'none', port4: others[1] ?? 'none' };
  });

  it('reports a port without RDM as TodNak (available: false)', async () => {
    // Switch RDM off on port 4, ask for its TOD, switch it on again.
    const off = await backend.request('artAddress', { nodeId: SIM_NODE, ports: [{ port: port(4), rdm: false }] });
    expect(off.node.ports[3]!.output.rdm).toBe(false);
    const before = directory.todOf(SIM_NODE, port(4));
    await backend.request('todRequest', { nodeId: SIM_NODE, port: port(4) });
    const nak = await waitFor<Tod>('a TodNak of port 4', () => {
      const tod = directory.todOf(SIM_NODE, port(4));
      return tod && tod !== before && !tod.available ? tod : null;
    }, 8000).catch(() => null);
    findings.todNakPort4 = nak ?? directory.todOf(SIM_NODE, port(4)) ?? 'no tod event';
    const on = await backend.request('artAddress', { nodeId: SIM_NODE, ports: [{ port: port(4), rdm: true }] });
    expect(on.node.ports[3]!.output.rdm).toBe(true);
    expect(nak).not.toBeNull();
    expect(nak!.uids).toEqual([]);
    // Contract rev 2: the bridge requests the TOD of a port whose RDM is switched on (recorded, not asserted).
    findings.todAfterRdmOn = await waitFor('an available TOD of port 4 without asking', () => directory.todOf(SIM_NODE, port(4))?.available, 8000)
      .then(() => 'sent by the bridge')
      .catch(async () => {
        await backend.request('todRequest', { nodeId: SIM_NODE, port: port(4) });
        return 'not sent within 8 s (requested by the test)';
      });
  });

  // ── RDM devices ──────────────────────────────

  it('describes a tube (personalities, slots)', async () => {
    const d = await backend.request('rdmDescribe', { nodeId: SIM_NODE, port: port(1), uid: tubes[0]! });
    tubeDescription = d;
    expect(d.uid).toBe(tubes[0]);
    expect(d.deviceInfo.deviceModelId).toBe(MODEL_TUBE);
    expect(d.deviceInfo.softwareVersionId).toBe(SIM_TUBE_VERSION);
    expect(d.personalities).toHaveLength(d.deviceInfo.personalityCount);
    expect(d.personalities.find(p => p.index === d.deviceInfo.currentPersonality)?.footprint).toBe(d.deviceInfo.dmxFootprint);
    expect(d.supportedParameters.length).toBeGreaterThan(0);
    findings.tubeDescription = {
      labels: [d.manufacturerLabel, d.deviceModelDescription, d.deviceLabel, d.softwareVersionLabel, d.bootSoftwareVersionLabel],
      info: d.deviceInfo,
      personalities: d.personalities,
      slots: d.slots.length,
      supportedParameters: d.supportedParameters.map(p => `0x${p.toString(16)}`),
      parameterDescriptions: d.parameterDescriptions.map(p => `0x${p.pid.toString(16)} ${p.description}`),
      errors: d.errors,
    };
  });

  it('tracks the devices in the device store', async () => {
    store = new DeviceStore({ backend, directory, nodeIds: () => [SIM_NODE] });
    store.start();
    await waitFor('3 described devices', () => [...tubes, fixture].every(uid => store!.get(uid)?.description), 20_000);
    expect(store.devicesOf(SIM_NODE).map(d => d.uid)).toEqual(expect.arrayContaining([...tubes, fixture]));
    expect(store.get(fixture)!.port).toEqual(port(2));
    expect(store.get(tubes[0]!)!.present).toBe(true);
  });

  it('drops the devices of a port without RDM and names the port (TodNak, contract rev 2)', async () => {
    await backend.request('artAddress', { nodeId: SIM_NODE, ports: [{ port: port(2), rdm: false }] });
    await backend.request('todRequest', { nodeId: SIM_NODE, port: port(2) });
    await waitFor('the fixture to be dropped', () => !store!.get(fixture), 8000);
    expect(store!.portsWithoutRdm(SIM_NODE)).toContainEqual(port(2));
    await backend.request('artAddress', { nodeId: SIM_NODE, ports: [{ port: port(2), rdm: true }] });
    await backend.request('todRequest', { nodeId: SIM_NODE, port: port(2) });
    await waitFor('the fixture to be listed and described again', () => store!.get(fixture)?.description, 15_000);
    expect(store!.portsWithoutRdm(SIM_NODE)).not.toContainEqual(port(2));
  });

  it('matches the tube and the fixture through the cascade (no custom fixture installed)', async () => {
    const saved: unknown[] = [];
    const matcher = createDeviceMatcher({
      findByRdm: async () => null,
      saveDefinition: (definition) => {
        saved.push(definition);
        return `custom:e2e-${saved.length}`;
      },
    });
    const tube: DeviceMatch = await matcher.match(tubeDescription!);
    expect(tube.via).toBe(tubeDescription!.slots.length ? 'generated' : 'generic');
    expect(tube.channelCount).toBe(tubeDescription!.deviceInfo.dmxFootprint);
    expect(tube.modeByPersonality[tubeDescription!.deviceInfo.currentPersonality]).toBe(tube.modeIndex);
    const fixtureDescription = store!.get(fixture)!.description!;
    const par = await matcher.match(fixtureDescription);
    expect(par.channelCount).toBe(fixtureDescription.deviceInfo.dmxFootprint);
    expect(saved).toHaveLength(2);
    findings.matching = {
      tube: { via: tube.via, name: tube.name, channels: tube.channelCount, modes: Object.keys(tube.personalityByMode).length, warnings: tube.warnings },
      fixture: { via: par.via, name: par.name, channels: par.channelCount, slots: fixtureDescription.slots.length, warnings: par.warnings },
    };
  });

  it('sets DMX_START_ADDRESS and reads it back', async () => {
    const tube = tubes[0]!;
    const address = { nodeId: SIM_NODE, port: port(1), uid: tube };
    await backend.request('rdmSet', { ...address, pid: RDM_PID.DMX_START_ADDRESS, value: 7 });
    const read = await backend.request('rdmGet', { ...address, pid: RDM_PID.DMX_START_ADDRESS });
    expect(read.value).toBe(7);
    // The device store's write path: SET, then DEVICE_INFO is the state (D5).
    const info = await store!.setStartAddress(tube, 13);
    expect(info?.dmxStartAddress).toBe(13);
    expect(store!.get(tube)!.info!.dmxStartAddress).toBe(13);
    const deviceInfo = await backend.request('rdmGet', { ...address, pid: RDM_PID.DEVICE_INFO });
    expect((deviceInfo.value as { dmxStartAddress: number }).dmxStartAddress).toBe(13);
    // Out of range (contract: SET value 1–512): refused — pmnet-bridge answers badRequest on `value`
    // itself; a device would NACK DATA_OUT_OF_RANGE. Either way the address stays.
    const refused = await commandError(() => backend.request('rdmSet', { ...address, pid: RDM_PID.DMX_START_ADDRESS, value: 600 }));
    expect(['badRequest', 'nack']).toContain(refused.code);
    findings.startAddress600 = { code: refused.code, details: refused.details };
    expect((await backend.request('rdmGet', { ...address, pid: RDM_PID.DMX_START_ADDRESS })).value).toBe(13);
    await store!.setStartAddress(tube, 1);
    expect(store!.get(tube)!.info!.dmxStartAddress).toBe(1);
  });

  // ── Node configuration ───────────────────────

  it('sets the failsafe mode per port with artAddress', async () => {
    /** Durations of the artAddress calls (ms), recorded in the findings. */
    const ms: Record<string, number> = {};
    /** Sends one artAddress and records how long the bridge took to answer. */
    const timed = async <T>(key: string, fn: () => Promise<T>) => {
      const t = Date.now();
      try {
        return await fn();
      }
      finally {
        ms[key] = Date.now() - t;
      }
    };
    const zero = await timed('port1Zero', () => backend.request('artAddress', { nodeId: SIM_NODE, ports: [{ port: port(1), failsafe: 'zero' }] }));
    expect(zero.node.ports[0]!.failsafe).toBe('zero');
    await waitFor('the directory to show failsafe zero', () => simNode()?.ports[0]!.failsafe === 'zero', 5000);
    // Port 2: pmnet-bridge 0.1 does not know the mode of BindIndex 2–4 (contract §11) → null, or the mode once it does.
    const full = await timed('port2Full', () => backend.request('artAddress', { nodeId: SIM_NODE, ports: [{ port: port(2), failsafe: 'full' }] }));
    expect([null, 'full']).toContain(full.node.ports[1]!.failsafe);
    expect(full.node.ports[0]!.failsafe).toBe('zero');
    await timed('port1Record', () => backend.request('artAddress', { nodeId: SIM_NODE, ports: [{ port: port(1), recordFailsafeScene: true }] }));
    const hold = await timed('ports12Hold', () => backend.request('artAddress', { nodeId: SIM_NODE, ports: [{ port: port(1), failsafe: 'hold' }, { port: port(2), failsafe: 'hold' }] }));
    expect(hold.node.ports[0]!.failsafe).toBe('hold');
    findings.failsafe = { port1AfterZero: zero.node.ports[0]!.failsafe, port2AfterFull: full.node.ports[1]!.failsafe, afterHold: hold.node.ports.map(p => p.failsafe), ms };
  });

  it('signals node changes for the settings re-read, not the poll counter (contract rev 2)', async () => {
    const scope = effectScope();
    const tick = scope.run(() => useNodeChangeSignal(() => simNode() ?? null, 200))!;
    /** `node` events while idle (pmnet-bridge 0.1 still sends one per NodeReport counter change). */
    let idleEvents = 0;
    const off = backend.on('node', (e) => { if (e.node.nodeId === SIM_NODE) idleEvents++; });
    await new Promise(resolve => setTimeout(resolve, 4000)); // more than one poll cycle (2.5–3 s)
    off();
    findings.nodeEventsWhileIdle4s = idleEvents;
    expect(tick.value).toBe(0);
    await backend.request('artAddress', { nodeId: SIM_NODE, shortName: 'E2E Node' });
    await waitFor('the change signal', () => tick.value > 0, 5000);
    await backend.request('artAddress', { nodeId: SIM_NODE, shortName: findings.node && typeof findings.node === 'object' ? String((findings.node as { shortName: string }).shortName) : 'PM Sim' });
    scope.stop();
  });

  it('sends a DMX frame set to port 1', async () => {
    const p1 = simNode()!.ports[0]!;
    expect(p1.output.data).toBe(false);
    const data = new Uint8Array(512);
    data.set([255, 128, 64, 32, 16, 8, 4, 2, 1, 0, 255, 255], 0);
    const dmxWarnings = () => logs.filter(l => l.level !== 'debug' && l.level !== 'info' && /dmx|route|binary/i.test(l.text));
    backend.sendDmx({ nodeId: SIM_NODE, portAddress: portAddressOf(p1) }, data);
    // The node reports GoodOutputA "data" once it outputs ArtDmx (the bridge refreshes the last data every 1 s).
    const flowing = await waitFor('port 1 to report DMX output', () => simNode()?.ports[0]!.output.data, 10_000).catch(() => false);
    findings.dmxOutputFlag = flowing;
    expect(backend.dmxError.value).toBeNull();
    expect(dmxWarnings()).toEqual([]);
    expect(flowing).toBe(true);
    // Port 2 got nothing.
    expect(simNode()!.ports[1]!.output.data).toBe(false);
  });

  it('reads the network settings with ipProg and refuses contradicting DHCP arguments', async () => {
    const net = await backend.request('ipProg', { nodeId: SIM_NODE });
    expect(typeof net.ip).toBe('string');
    expect(typeof net.mask).toBe('string');
    expect(typeof net.gateway).toBe('string');
    expect(typeof net.dhcp).toBe('boolean');
    findings.ipProgRead = net;
    // Rejected by the client's checks or by the bridge — both answer badRequest on `dhcp` (contract §6).
    const withIp = await commandError(() => backend.request('ipProg', { nodeId: SIM_NODE, dhcp: true, ip: '10.0.0.20' }));
    expect(withIp.code).toBe('badRequest');
    expect(withIp.details.field).toBe('dhcp');
    const withoutIp = await commandError(() => backend.request('ipProg', { nodeId: SIM_NODE, dhcp: false }));
    expect(withoutIp.code).toBe('badRequest');
    expect(withoutIp.details.field).toBe('dhcp');
  });

  // ── Firmware ─────────────────────────────────

  it('refuses a wrong model and a downgrade before writing', async () => {
    // Sanity check of the CRC (CRC-16/CCITT-FALSE check value).
    expect(crc16Ccitt(new TextEncoder().encode('123456789'), 0xffff)).toBe(0x29b1);
    const address = { nodeId: SIM_NODE, port: port(1), uid: tubes[1]! };
    const wrongModel = await commandError(() => backend.request('flash', { ...address, hex: tubeImageHex(0x000300, 0x77), allowDowngrade: false }));
    expect(wrongModel.code).toBe('deviceMismatch');
    const older = await commandError(() => backend.request('flash', { ...address, hex: tubeImageHex(0x000050), allowDowngrade: false }));
    expect(older.code).toBe('downgrade');
    expect(older.details).toMatchObject({ current: SIM_TUBE_VERSION, image: 0x000050 });
    const invalid = await commandError(() => backend.request('imageInfo', { hex: 'not intel hex' }));
    expect(invalid.code).toBe('invalidImage');
  });

  it('flashes a tube through the firmware update manager', async () => {
    const started = Date.now();
    /** Timestamped progress lines (the flash is the slow step; they show where time goes). */
    const trace = (text: string) => console.info(`[e2e flash +${Date.now() - started} ms] ${text}`);
    const offTrace = backend.on('flashProgress', ({ job }) => trace(`${job.uid} ${job.phase} ${job.pagesDone}/${job.pagesTotal} rewrites ${job.rewrites}${job.error ? ` ${job.error.code}: ${job.error.message}` : ''}`));
    const hex = tubeImageHex(NEW_TUBE_VERSION);
    const image = await backend.request('imageInfo', { hex });
    trace(`imageInfo ${image.version}`);
    expect(image).toMatchObject({ format: 1, manufacturerId: 0x7ff0, modelId: MODEL_TUBE, versionId: NEW_TUBE_VERSION, version: '0.2.0' });

    // What the firmware dialog offers: both tubes as updates, the third-party fixture not at all.
    const offered = listNodeTubes(directory, SIM_NODE);
    expect(offered.map(t => t.uid)).toEqual(expect.arrayContaining([...tubes, fixture]));
    const tube = offered.find(t => t.uid === tubes[0])!;
    const reading = await readTubeFirmware(backend, tube);
    expect(reading).toMatchObject({ state: 'ok', deviceModelId: MODEL_TUBE, softwareVersionId: SIM_TUBE_VERSION });
    expect(checkFirmwareEligibility(image, tube.uid, reading).kind).toBe('update');
    const foreign = offered.find(t => t.uid === fixture)!;
    expect(checkFirmwareEligibility(image, foreign.uid, await readTubeFirmware(backend, foreign)).kind).toBe('mismatch');

    // The app's plumbing: the manager runs the job, reads of the tube are held meanwhile.
    manager = new FirmwareUpdateManager(backend);
    unlinkFirmware = linkFirmwareToDevices(manager, () => store);
    await waitFor('the manager to read flashJobs', () => manager!.synced.value, 5000);
    trace('manager synced; enqueue');
    manager.enqueue([{ nodeId: SIM_NODE, port: tube.port, uid: tube.uid, allowDowngrade: false, image }], hex);
    await waitFor('the tube\'s reads to be held', () => store!.isHeld(tube.uid), 5000);
    trace('reads held');
    const item = await waitFor('the update to end', () => {
      const latest = manager!.latest(tube.uid);
      return latest && ['done', 'failed', 'cancelled'].includes(latest.status) ? latest : null;
    }, 170_000).finally(() => {
      offTrace();
      const latest = manager!.latest(tube.uid);
      trace(`manager item: ${latest?.status} ${latest?.error ?? ''} ${latest?.errorDetail ?? ''}`);
    });
    const flashMs = Date.now() - started;
    const phases = progress.filter(e => e.job.uid === tube.uid).map(e => e.job.phase);
    findings.flash = { ms: flashMs, status: item.status, error: item.error, errorDetail: item.errorDetail, phases: [...new Set(phases)], pagesTotal: item.job?.pagesTotal, rewrites: item.job?.rewrites, result: item.job?.result };
    expect(item.status).toBe('done');
    expect(item.job?.result?.softwareVersionId).toBe(NEW_TUBE_VERSION);
    expect(phases).toContain('writing');
    expect(phases.at(-1)).toBe('done');
    expect(item.job!.pagesDone).toBe(item.job!.pagesTotal);
    expect(store!.isHeld(tube.uid)).toBe(false);

    // The finished update refreshes the tube's description in the device store.
    await waitFor('the store to show the new firmware', () => store!.get(tube.uid)?.description?.deviceInfo.softwareVersionId === NEW_TUBE_VERSION, 20_000);
    const after = await readTubeFirmware(backend, tube);
    expect(after).toMatchObject({ state: 'ok', softwareVersionId: NEW_TUBE_VERSION });
    findings.flash = { ...(findings.flash as object), totalMsWithRefresh: Date.now() - started, labelAfter: after.state === 'ok' ? after.softwareVersionLabel : null };
  }, 200_000);
});
