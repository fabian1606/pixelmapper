import { ref } from 'vue';
import { BaseConnector, type ConnectorMeta, type EngineConnectorState } from './base-connector';
import { buildBpmPacket, buildTimesyncPacket, buildVersionRequestPacket, buildStripConfigPacket } from './binary-encoder';
import { buildScopedPackets, scopedFingerprint } from './scoped-encoder';

// ── WebSocketConnector ────────────────────────────────────────────────────────
// One ESP32-S3 node per instance. Each connector binds to a single LED-strip
// fixture in the scene. On every engine frame we build packets scoped to that
// fixture (DMX-indices rebased to 0, effects filtered + bitmask rewritten) and
// stream them as WebSocket binary frames. ESP32-S3 runs the same Rust engine
// locally — it just sees a single-fixture world.

export class WebSocketConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    type: 'websocket',
    label: 'WebSocket LED-Strip',
    icon: 'Wifi',
  };

  url        = ref<string>('');
  fixtureId  = ref<string | number | null>(null);
  firmwareVersion = ref<string | null>(null);

  private ws: WebSocket | null = null;

  private cachedBpm      = -1;
  private cachedLayoutFp:   string = '';
  private cachedChannelsFp: string = '';
  private cachedEffectsFp:  string = '';
  private cachedStripFp:    string = '';
  private frameCount = 0;
  private readonly TIMESYNC_INTERVAL = 120;

  constructor(id: string, url = '', fixtureId: string | number | null = null) {
    super(id);
    this.url.value = url;
    this.fixtureId.value = fixtureId;
    // outputCount stays 0 — parameter-based, ESP32 renders locally
  }

  async connect() {
    if (!this.url.value) {
      this.status.value = 'error';
      this.errorMessage.value = 'WebSocket-URL fehlt';
      return;
    }
    if (this.fixtureId.value == null) {
      this.status.value = 'error';
      this.errorMessage.value = 'Keine Strip-Fixture ausgewählt';
      return;
    }

    this.status.value = 'connecting';
    this.errorMessage.value = null;
    this.frameCount = 0;
    this.cachedBpm = -1;
    this.cachedLayoutFp = '';
    this.cachedChannelsFp = '';
    this.cachedEffectsFp = '';
    this.cachedStripFp = '';
    this.firmwareVersion.value = null;

    try {
      const ws = new WebSocket(this.url.value);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      await new Promise<void>((resolve, reject) => {
        const onOpen = () => { ws.removeEventListener('error', onErr); resolve(); };
        const onErr  = () => { ws.removeEventListener('open', onOpen); reject(new Error('WebSocket connection failed')); };
        ws.addEventListener('open',  onOpen, { once: true });
        ws.addEventListener('error', onErr,  { once: true });
      });

      ws.addEventListener('message', (ev) => this.handleMessage(ev));
      ws.addEventListener('close',   ()    => this.handleClose());
      ws.addEventListener('error',   ()    => this.pushLog('[ws] error'));

      this.status.value = 'connected';
      this.pushLog('[ws] connected — requesting version');
      this.send(buildVersionRequestPacket());
    } catch (e: any) {
      this.status.value = 'error';
      this.errorMessage.value = e?.message ?? 'Connection failed';
      this.pushLog(`[ws] error: ${this.errorMessage.value}`);
    }
  }

  async disconnect() {
    try { this.ws?.close(); } catch (_) {}
    this.ws = null;
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  /** No-op — ESP32 renders its own DMX via the local Rust engine */
  sendFrame(_dmxBuffer: Uint8Array) {}

  override onEngineState(state: EngineConnectorState) {
    if (this.status.value !== 'connected' || !this.ws) return;
    if (this.fixtureId.value == null) return;

    const target = this.fixtureId.value;
    const fixture = state.fixtures.find(f => String(f.id) === String(target));
    if (!fixture) return;

    const first = this.frameCount === 0;

    if (first || state.bpm !== this.cachedBpm) {
      this.send(buildBpmPacket(state.bpm));
      this.cachedBpm = state.bpm;
    }

    // Strip-config: chip type + ledCount + groupSize + ledsPerMeter.
    // Sent on connect and whenever any of these change on the bound fixture.
    if (fixture.stripConfig) {
      const sc = fixture.stripConfig;
      const stripFp = `${sc.chipType}:${sc.ledCount}:${sc.groupSize}:${sc.ledsPerMeter}`;
      if (first || stripFp !== this.cachedStripFp) {
        this.send(buildStripConfigPacket({
          chipType:     sc.chipType,
          ledCount:     sc.ledCount,
          groupSize:    sc.groupSize,
          ledsPerMeter: sc.ledsPerMeter,
        }));
        this.cachedStripFp = stripFp;
        this.pushLog(`[sync] strip ${sc.chipType} count=${sc.ledCount} group=${sc.groupSize}`);
      }
    }

    const fp = scopedFingerprint(fixture, state.effects, state.blendMode);

    if (first || fp.layout !== this.cachedLayoutFp || fp.channels !== this.cachedChannelsFp || fp.effects !== this.cachedEffectsFp) {
      const scoped = buildScopedPackets(fixture, state.effects, state.blendMode);

      if (first || fp.layout !== this.cachedLayoutFp) {
        this.send(scoped.layoutPacket);
        this.cachedLayoutFp = fp.layout;
        this.pushLog(`[sync] layout ${scoped.layoutPacket.length}B`);
      }
      if (first || fp.channels !== this.cachedChannelsFp) {
        this.send(scoped.channelsPacket);
        this.cachedChannelsFp = fp.channels;
        this.pushLog(`[sync] channels ${scoped.channelsPacket.length}B`);
      }
      if (first || fp.effects !== this.cachedEffectsFp) {
        this.send(scoped.effectsPacket);
        this.cachedEffectsFp = fp.effects;
        this.pushLog(`[sync] effects ${scoped.effectsPacket.length}B`);
      }
    }

    if (first || this.frameCount % this.TIMESYNC_INTERVAL === 0) {
      this.send(buildTimesyncPacket(state.elapsedMs));
    }

    this.frameCount++;
  }

  setUrl(url: string) {
    this.url.value = url;
  }

  setFixtureId(id: string | number | null) {
    if (this.fixtureId.value === id) return;
    this.fixtureId.value = id;
    // Force a full resync on next frame
    this.cachedLayoutFp = '';
    this.cachedChannelsFp = '';
    this.cachedEffectsFp = '';
    this.cachedStripFp = '';
    this.frameCount = 0;
  }

  override getConfig() {
    return { url: this.url.value, fixtureId: this.fixtureId.value };
  }

  private send(packet: Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(packet);
    } catch (e) {
      this.pushLog(`[ws] send failed: ${(e as Error).message ?? e}`);
    }
  }

  private handleMessage(ev: MessageEvent) {
    if (typeof ev.data !== 'string') return; // only text log lines expected
    const lines = ev.data.split('\n');
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line) continue;
      const v = line.match(/^\[version\]\s+([\w.\-]+)$/);
      if (v) this.firmwareVersion.value = v[1]!.trim();
      this.pushLog(line);
    }
  }

  private handleClose() {
    this.ws = null;
    if (this.status.value === 'connected') {
      this.status.value = 'disconnected';
      this.pushLog('[ws] closed');
    }
  }
}
