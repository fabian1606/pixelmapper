# Pixelmapper ArtNet Bridge (legacy)

Kleines lokales Node-/Bun-Backend, das DMX-Frames vom Web-Frontend per
WebSocket empfängt und als ArtDMX-UDP-Pakete ins LAN sendet.

Wird nur noch vom Connector **„ArtNet (manual target)“** (`artnet`) im Browser
gebraucht (Default-URL `ws://localhost:7778`). Art-Net-4-Nodes (Connector
`artnet-node`) laufen über die Rust-Bridge `pmnet-bridge serve` auf Port 7777
(`bun run pmnet-bridge`, siehe `architecture/connectors.md`); sie spricht dieses
Protokoll nicht. In der Desktop-App sendet der Connector direkt per UDP und
braucht keine Bridge.

## Start

```bash
bun run artnet-bridge           # einzeln (aus dem Projekt-Root)
# oder
bun run tools/artnet-bridge/index.ts
```

Wird zusätzlich automatisch durch `bun run dev` mit hochgezogen (Prozess
`artnet-legacy`, neben `pmnet-bridge`).

## Protokoll (Browser → Bridge)

- **Text-Frame**: `{ "type": "config", "targetIp": "2.255.255.255", "artnetPort": 6454 }`
- **Binär-Frame**: `[u16 LE universe][≤512 B DMX]`

Pro empfangenem Binär-Frame baut die Bridge ein ArtDMX-Paket (OpCode 0x5000)
und sendet es an `targetIp:artnetPort`. Sequenznummern werden pro Universe
serverseitig rotiert.

## Konfiguration

- `PORT` (env, default 7778) — WebSocket-Listenport. Bis Plan-Schritt M3.4 war
  es 7777; gespeicherte Connector-Configs mit der alten Default-URL
  (`ws://localhost:7777` / `ws://127.0.0.1:7777`) werden beim Laden auf
  `ws://localhost:7778` umgestellt.
- Ziel-IP/Port werden vom Client per WS gesetzt — die Bridge persistiert
  nichts.
