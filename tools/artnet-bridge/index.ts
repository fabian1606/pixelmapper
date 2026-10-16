// Pixelmapper ArtNet bridge
//
// Receives DMX frames from the browser over WebSocket and re-emits them as
// ArtDMX UDP packets on the LAN. Each client tells us its target IP / port
// via a JSON `config` text frame right after connecting. Binary frames are
// `[u16 LE universe][≤512 B DMX]`.
//
// Run: `bun run tools/artnet-bridge/index.ts`  (also auto-started by `bun dev`)

import dgram from 'node:dgram';
import { ARTNET_PORT, ArtDmxSequencer, encodeArtDmx, toArtNetUniverse } from '../../extensions/connector-artnet/art-dmx';

const PORT = Number(process.env.PORT ?? 7777);

interface ClientState {
  targetIp:   string;
  artnetPort: number;
  /** ArtNet sequence numbers per universe. */
  seq:        ArtDmxSequencer;
  frames:     number;
}

const udp = dgram.createSocket('udp4');
udp.bind(0, () => {
  try { udp.setBroadcast(true); } catch (e) { console.warn('[bridge] setBroadcast failed', e); }
});

function makeState(): ClientState {
  return {
    targetIp:   '255.255.255.255',
    artnetPort: ARTNET_PORT,
    seq:        new ArtDmxSequencer(),
    frames:     0,
  };
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
      // The app numbers universes 1-based (U1, U2, …); ArtNet is 0-based.
      const universe = toArtNetUniverse(buf[0]! | (buf[1]! << 8));
      if (universe === null) return;
      const dmx = buf.subarray(2);
      const pkt = encodeArtDmx(universe, dmx, state.seq.next(universe));
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
