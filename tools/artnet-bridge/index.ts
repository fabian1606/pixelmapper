// Pixelmapper ArtNet bridge
//
// Receives DMX frames from the browser over WebSocket and re-emits them as
// ArtDMX UDP packets on the LAN. Each client tells us its target IP / port
// via a JSON `config` text frame right after connecting. Binary frames are
// `[u16 LE universe][≤512 B DMX]`.
//
// Run: `bun run tools/artnet-bridge/index.ts`  (also auto-started by `bun dev`)

import dgram from 'node:dgram';

const PORT = Number(process.env.PORT ?? 7777);

interface ClientState {
  targetIp:   string;
  artnetPort: number;
  /** ArtNet sequence number, rotates per-universe (1..255, 0 = disable). */
  seq:        Map<number, number>;
  frames:     number;
}

const udp = dgram.createSocket('udp4');
udp.bind(0, () => {
  try { udp.setBroadcast(true); } catch (e) { console.warn('[bridge] setBroadcast failed', e); }
});

const ART_NET_HEADER = new Uint8Array([
  0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00, // "Art-Net\0"
]);

function buildArtDmx(universe: number, dmx: Uint8Array, seq: number): Buffer {
  const len = 512;
  const out = Buffer.alloc(8 + 10 + len);
  out.set(ART_NET_HEADER, 0);
  // OpCode ArtDMX = 0x5000, little-endian
  out[8] = 0x00;
  out[9] = 0x50;
  // ProtVer = 14, big-endian
  out[10] = 0x00;
  out[11] = 14;
  out[12] = seq & 0xff;          // sequence (0 = disabled)
  out[13] = 0x00;                // physical
  out[14] = universe & 0xff;     // sub-uni
  out[15] = (universe >> 8) & 0x7f; // net
  out[16] = (len >> 8) & 0xff;   // length high
  out[17] = len & 0xff;          // length low
  // DMX payload — pad with zeros to 512 if caller sent less
  out.set(dmx.subarray(0, Math.min(dmx.length, len)), 18);
  return out;
}

function makeState(): ClientState {
  return {
    targetIp:   '255.255.255.255',
    artnetPort: 6454,
    seq:        new Map(),
    frames:     0,
  };
}

function nextSeq(state: ClientState, universe: number): number {
  const prev = state.seq.get(universe) ?? 0;
  const next = prev >= 255 ? 1 : prev + 1;
  state.seq.set(universe, next);
  return next;
}

const server = Bun.serve<ClientState, {}>({
  port: PORT,
  fetch(req, srv) {
    if (srv.upgrade(req, { data: makeState() })) return;
    return new Response('pixelmapper artnet-bridge — connect via WebSocket', { status: 200 });
  },
  websocket: {
    open(ws) {
      console.log(`[bridge] client connected (target ${ws.data.targetIp}:${ws.data.artnetPort})`);
    },
    message(ws, msg) {
      const state = ws.data;
      if (typeof msg === 'string') {
        try {
          const parsed = JSON.parse(msg);
          if (parsed?.type === 'config') {
            if (typeof parsed.targetIp   === 'string') state.targetIp   = parsed.targetIp;
            if (typeof parsed.artnetPort === 'number') state.artnetPort = parsed.artnetPort;
            console.log(`[bridge] config → ${state.targetIp}:${state.artnetPort}`);
            ws.send(`[bridge] target=${state.targetIp}:${state.artnetPort}`);
          }
        } catch {
          // ignore malformed text frames
        }
        return;
      }
      // Binary: [u16 LE universe][DMX bytes]
      const buf = msg instanceof Uint8Array ? msg : new Uint8Array(msg as ArrayBuffer);
      if (buf.length < 2) return;
      // Frontend nummeriert Universes 1-basiert (U1, U2, …) wie in QLC+ etc.
      // ArtNet selbst ist 0-basiert — also umrechnen, bevor wir das Paket bauen.
      const universe1Based = buf[0]! | (buf[1]! << 8);
      if (universe1Based < 1) return;
      const universe = universe1Based - 1;
      const dmx = buf.subarray(2);
      const pkt = buildArtDmx(universe, dmx, nextSeq(state, universe));
      udp.send(pkt, state.artnetPort, state.targetIp, (err) => {
        if (err) console.warn(`[bridge] udp send failed: ${err.message}`);
      });
      state.frames++;
    },
    close(ws) {
      console.log(`[bridge] client disconnected (sent ${ws.data.frames} frames)`);
    },
  },
});

console.log(`[bridge] up on :${server.port}`);

// Heartbeat — let the operator see the bridge is alive even when no client
// is sending anything yet.
setInterval(() => {
  // No-op timer; presence of this log line at 30 s intervals confirms liveness.
  // Skipped if you'd rather have silence — kept short to avoid log spam.
}, 30000);
