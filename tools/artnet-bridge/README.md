# Pixelmapper ArtNet Bridge

Kleines lokales Node-/Bun-Backend, das DMX-Frames vom Web-Frontend per
WebSocket empfängt und als ArtDMX-UDP-Pakete ins LAN sendet.

## Start

```bash
bun run artnet-bridge           # einzeln (aus dem Projekt-Root)
# oder
bun run tools/artnet-bridge/index.ts
```

Wird zusätzlich automatisch durch `bun dev` mit hochgezogen.

## Protokoll (Browser → Bridge)

- **Text-Frame**: `{ "type": "config", "targetIp": "2.255.255.255", "artnetPort": 6454 }`
- **Binär-Frame**: `[u16 LE universe][≤512 B DMX]`

Pro empfangenem Binär-Frame baut die Bridge ein ArtDMX-Paket (OpCode 0x5000)
und sendet es an `targetIp:artnetPort`. Sequenznummern werden pro Universe
serverseitig rotiert.

## Konfiguration

- `PORT` (env, default 7777) — WebSocket-Listenport.
- Ziel-IP/Port werden vom Client per WS gesetzt — die Bridge persistiert
  nichts.
