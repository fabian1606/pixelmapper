import { ref } from 'vue';
import { BaseConnector, type ConnectorMeta, type ConnectorStatus, type EngineConnectorState } from './base-connector';
import { buildBpmPacket, buildTimesyncPacket, buildVersionRequestPacket } from './binary-encoder';
import {
  buildMultiScopedPackets, multiScopedFingerprint,
  type FixtureSlotInput,
} from './scoped-encoder';

// ── WebSocketConnector ────────────────────────────────────────────────────────
// One ESP32-S3 node per instance. Each connector can bind to one or more
// LED-strip fixtures (slots), all connected to this ESP on different GPIO pins.
// On every engine frame we build packets scoped to those fixtures (DMX-indices
// rebased to 0, effects filtered + bitmask rewritten) and stream them as
// WebSocket binary frames. The ESP32-S3 runs the same Rust engine locally.

export interface FixtureSlot {
  fixtureId: string | number;
  pin: number | null;
  /**
   * Start-LED-Index dieses logischen Strips auf der gemeinsamen Datenleitung
   * (dem Pin). Erlaubt, einen physischen Strip in mehrere Fixtures aufzuteilen,
   * die sich denselben Pin teilen (z.B. erste 500 LEDs = Fixture A, ab LED 500
   * = Fixture B). Fehlend/undefined = 0.
   */
  ledOffset?: number;
}

export class WebSocketConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    type: 'websocket',
    label: 'WebSocket LED-Strip',
    icon: 'Wifi',
  };

  url           = ref<string>('');
  fixtureSlots  = ref<FixtureSlot[]>([]);
  label         = ref<string>('');
  firmwareVersion = ref<string | null>(null);
  devicePin     = ref<number | null>(null);

  /** Backward-compat: first slot's fixtureId (or null). */
  get fixtureId(): string | number | null {
    return this.fixtureSlots.value[0]?.fixtureId ?? null;
  }

  private ws: WebSocket | null = null;

  // ── Reconnect machinery ──────────────────────────────────────────────────
  private static readonly CONNECT_TIMEOUT_MS = 5000;
  private static readonly RETRY_INTERVAL_MS  = 2000;
  private retryTimer:      ReturnType<typeof setTimeout> | null = null;
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;

  private cachedBpm      = -1;
  private cachedLayoutFp:   string = '';
  private cachedChannelsFp: string = '';
  private cachedEffectsFp:  string = '';
  private cachedStripFp:    string = '';
  private frameCount = 0;
  private cachedSlotsFp:    string = '';
  private readonly TIMESYNC_INTERVAL = 1;

  constructor(id: string, url = '', fixtureId: string | number | null = null) {
    super(id);
    this.url.value = url;
    if (fixtureId != null) {
      this.fixtureSlots.value = [{ fixtureId, pin: null }];
    }
    // outputCount stays 0 — parameter-based, ESP32 renders locally
  }

  /**
   * Open a WebSocket to the strip device. Idempotent: any prior socket / timer
   * is torn down first so the function is safe to call from a retry tick as
   * well as from a user click.
   *
   * `autoReconnect` is **not** set here — it arms only on a successful 'open'.
   * That cleanly separates "first attempt" (manual click or initial auto-try)
   * from "retry loop" (drop after a previously successful connection).
   */
  async connect() {
    this.clearTimers();
    this.teardownSocket();

    if (!this.url.value)                         return this.failTo('error', 'WebSocket-URL fehlt');
    if (!this.fixtureSlots.value.length)         return this.failTo('error', 'Keine Strip-Fixture ausgewählt');
    if (!this.fixtureSlots.value[0]?.fixtureId)  return this.failTo('error', 'Keine Strip-Fixture ausgewählt');

    this.status.value = 'connecting';
    this.errorMessage.value = null;
    this.resetCaches();

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url.value);
    } catch (e) {
      return this.handleConnectFailure(e as Error);
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    // Stuck-in-connecting watchdog: if no 'open' within CONNECT_TIMEOUT_MS,
    // treat as a failed attempt and decide retry vs. give up.
    this.connectWatchdog = setTimeout(() => {
      if (this.status.value === 'connecting') {
        this.pushLog('[ws] connect watchdog — tearing down stale socket');
        this.handleConnectFailure(new Error('Connect timeout'));
      }
    }, WebSocketConnector.CONNECT_TIMEOUT_MS);

    ws.addEventListener('open',    () => this.handleOpen());
    ws.addEventListener('message', (ev) => this.handleMessage(ev));
    ws.addEventListener('close',   () => this.handleClose());
    ws.addEventListener('error',   () => this.handleError());
  }

  async disconnect() {
    this.autoReconnect.value = false;
    this.clearTimers();
    this.teardownSocket();
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  private handleOpen() {
    this.clearConnectWatchdog();
    this.status.value = 'connected';
    this.autoReconnect.value = true;
    this.pushLog('[ws] connected — requesting version');
    this.send(buildVersionRequestPacket());
  }

  private handleError() {
    // Force a teardown + decide retry rather than just logging — half-broken
    // sockets that errored without closing kept the old code "connected" while
    // silently dropping frames.
    this.pushLog('[ws] error');
    this.errorMessage.value = 'WebSocket error';
    this.teardownSocket();
    this.scheduleNextStep();
  }

  private handleConnectFailure(e: Error) {
    this.pushLog(`[ws] connect failed: ${e.message}`);
    this.errorMessage.value = e.message;
    this.teardownSocket();
    this.scheduleNextStep();
  }

  /**
   * Either schedule a retry (if armed) or settle in the terminal-for-now state.
   * Called from every failure path so the decision lives in exactly one place.
   */
  private scheduleNextStep() {
    this.clearConnectWatchdog();
    if (this.autoReconnect.value) {
      // Stay visually "connecting" between attempts so the UI doesn't flicker.
      this.status.value = 'connecting';
      this.retryTimer = setTimeout(
        () => this.connect(),
        WebSocketConnector.RETRY_INTERVAL_MS,
      );
      this.pushLog(`[ws] retry in ${WebSocketConnector.RETRY_INTERVAL_MS}ms`);
    } else {
      this.status.value = this.errorMessage.value ? 'error' : 'disconnected';
    }
  }

  /**
   * Detach handlers BEFORE close() so the spec-allowed late `onclose` doesn't
   * re-enter scheduleNextStep() with a stale state.
   */
  private teardownSocket() {
    if (this.ws) {
      try {
        this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  private clearTimers() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.clearConnectWatchdog();
  }

  private clearConnectWatchdog() {
    if (this.connectWatchdog) { clearTimeout(this.connectWatchdog); this.connectWatchdog = null; }
  }

  private resetCaches() {
    this.frameCount = 0;
    this.cachedBpm = -1;
    this.cachedLayoutFp = this.cachedChannelsFp = this.cachedEffectsFp = this.cachedStripFp = this.cachedSlotsFp = '';
    this.firmwareVersion.value = null;
  }

  private failTo(status: ConnectorStatus, msg: string) {
    this.status.value = status;
    this.errorMessage.value = msg;
  }

  /** No-op — ESP32 renders its own DMX via the local Rust engine */
  sendFrame(_dmxBuffer: Uint8Array, _universe?: number) {}

  override onEngineState(state: EngineConnectorState) {
    if (this.status.value !== 'connected' || !this.ws) return;
    const slots = this.fixtureSlots.value;
    if (!slots.length || !slots[0]?.fixtureId) return;

    const first = this.frameCount === 0;

    if (first || state.bpm !== this.cachedBpm) {
      this.send(buildBpmPacket(state.bpm));
      this.cachedBpm = state.bpm;
    }

    // Unified path: always go through the multi-slot encoder, even with one
    // slot. This ensures the per-slot GPIO pin (configured in the UI) reaches
    // the firmware via TYPE_STRIP_SLOTS — TYPE_STRIP_CONFIG has no pin field
    // and would force the firmware to fall back to its NVS-persisted pin.
    //
    // Pin resolution: the device-reported `devicePin` is a sensible fallback
    // ONLY for a single-slot connector. With multiple slots, falling back to the
    // same default pin would silently collapse two strips onto one GPIO — the
    // firmware then registers a single controller and the second fixture's
    // pixels overwrite the first, so only one physical strip lights. So fall
    // back to devicePin only for the first slot; every further slot must carry
    // its own explicit pin, and two slots may never resolve to the same pin
    // (the firmware can't yet distinguish them — ledOffset isn't on the wire).
    const defaultPin = this.devicePin.value;
    const slotInputs: FixtureSlotInput[] = [];
    const seenPins = new Set<number>();
    slots.forEach((slot, index) => {
      const fixture = state.fixtures.find(f => String(f.id) === String(slot.fixtureId));
      if (!fixture) return;
      const resolvedPin = slot.pin ?? (index === 0 ? defaultPin : null);
      if (resolvedPin == null) {
        this.pushLog(`[sync] Streifen ${index + 1} übersprungen — kein GPIO-Pin gesetzt`);
        return;
      }
      if (seenPins.has(resolvedPin)) {
        this.pushLog(`[sync] Streifen ${index + 1} übersprungen — GPIO ${resolvedPin} schon von einem anderen Streifen belegt`);
        return;
      }
      seenPins.add(resolvedPin);
      slotInputs.push({ fixture, pin: resolvedPin, ledOffset: slot.ledOffset ?? 0 });
    });
    if (!slotInputs.length) return;

    const fp = multiScopedFingerprint(slotInputs, state.effects, state.blendMode);

    if (first || fp.strip !== this.cachedStripFp ||
        fp.layout !== this.cachedLayoutFp ||
        fp.channels !== this.cachedChannelsFp ||
        fp.effects !== this.cachedEffectsFp) {
      const scoped = buildMultiScopedPackets(slotInputs, state.effects, state.blendMode);

      if (scoped.stripSlotsPacket && (first || fp.strip !== this.cachedStripFp)) {
        this.send(scoped.stripSlotsPacket);
        this.cachedStripFp = fp.strip;
        this.pushLog(`[sync] strip-slots ${scoped.stripSlotsPacket.length}B (${slotInputs.length} slot${slotInputs.length === 1 ? '' : 's'})`);
      }
      if (first || fp.layout !== this.cachedLayoutFp)     { this.send(scoped.layoutPacket);   this.cachedLayoutFp   = fp.layout;   this.pushLog(`[sync] layout ${scoped.layoutPacket.length}B`);   }
      if (first || fp.channels !== this.cachedChannelsFp) { this.send(scoped.channelsPacket); this.cachedChannelsFp = fp.channels; this.pushLog(`[sync] channels ${scoped.channelsPacket.length}B`); }
      if (first || fp.effects !== this.cachedEffectsFp)   { this.send(scoped.effectsPacket);  this.cachedEffectsFp  = fp.effects;  this.pushLog(`[sync] effects ${scoped.effectsPacket.length}B`);  }
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
    const current = this.fixtureSlots.value[0]?.fixtureId ?? null;
    if (String(current) === String(id)) return;
    if (id == null) {
      this.fixtureSlots.value = [];
    } else {
      const existingPin = this.fixtureSlots.value[0]?.pin ?? null;
      this.fixtureSlots.value = [{ fixtureId: id, pin: existingPin }];
    }
    this.resetCaches();
  }

  setFixtureSlots(slots: FixtureSlot[]) {
    this.fixtureSlots.value = slots;
    this.resetCaches();
  }

  addFixtureSlot(fixtureId: string | number, pin: number | null = null) {
    this.fixtureSlots.value = [...this.fixtureSlots.value, { fixtureId, pin }];
    this.resetCaches();
  }

  removeFixtureSlot(index: number) {
    const slots = this.fixtureSlots.value.slice();
    slots.splice(index, 1);
    this.fixtureSlots.value = slots;
    this.resetCaches();
  }

  updateFixtureSlot(index: number, patch: Partial<FixtureSlot>) {
    const slots = this.fixtureSlots.value.slice();
    if (slots[index]) {
      slots[index] = { ...slots[index]!, ...patch };
      this.fixtureSlots.value = slots;
      this.resetCaches();
    }
  }

  override getConfig() {
    return {
      url:             this.url.value,
      fixtureSlots:    this.fixtureSlots.value.slice(),
      label:           this.label.value,
      devicePin:       this.devicePin.value,
      outputMapping:   this.outputMapping.value.slice(),
    };
  }

  static fromConfig(id: string, config: Record<string, unknown>): WebSocketConnector {
    const wc = new WebSocketConnector(id, String(config.url ?? ''));
    wc.label.value     = String(config.label ?? '');
    wc.devicePin.value = config.devicePin != null ? Number(config.devicePin) : null;

    if (Array.isArray(config.fixtureSlots) && config.fixtureSlots.length) {
      // New format
      wc.fixtureSlots.value = (config.fixtureSlots as FixtureSlot[]).map(s => ({
        fixtureId: s.fixtureId,
        pin:       s.pin ?? null,
        ledOffset: s.ledOffset ?? 0,
      }));
    } else if (config.fixtureId != null) {
      // Legacy format: single fixtureId stored directly
      wc.fixtureSlots.value = [{
        fixtureId: config.fixtureId as string | number,
        pin:       config.devicePin != null ? Number(config.devicePin) : null,
      }];
    }
    return wc;
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
      const p = line.match(/\bpin=(\d+)/);
      if (p) this.devicePin.value = Number(p[1]);
      this.pushLog(line);
    }
  }

  private handleClose() {
    this.teardownSocket();
    this.pushLog('[ws] closed');
    this.scheduleNextStep();
  }
}
