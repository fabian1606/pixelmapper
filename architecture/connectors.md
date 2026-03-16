# Connectors & Hardware

## Architecture

Connectors are the output layer — they receive pre-built binary packets from the engine-store and forward them to hardware or other targets. **No encoding logic lives in connectors.** All packet building happens in `binary-encoder.ts`.

```
engine-store (render loop)
    │
    ├── connectionsStore.sendFrame(dmxBuffer)
    │       └── connector.sendFrame()        // for DMX-output connectors
    │
    └── connectionsStore.notifyEngineState(state)
            └── connector.onEngineState()    // for parameter-based connectors
```

## BaseConnector (`base-connector.ts`)

Abstract base class all connectors extend:

```typescript
abstract class BaseConnector {
    readonly id: string
    status: ConnectorStatus           // 'disconnected' | 'connecting' | 'connected' | 'error'
    errorMessage: string | null
    logs: LogLine[]                   // reactive, capped at 500 entries

    abstract connect(): Promise<void>
    abstract disconnect(): Promise<void>
    abstract sendFrame(dmxBuffer: Uint8Array): void

    // Optional — for connectors that run their own renderer
    onEngineState?(state: EngineConnectorState): void
}
```

### EngineConnectorState

Passed to `onEngineState` every frame:

```typescript
interface EngineConnectorState {
    bpm:              number
    elapsedMs:        number
    layoutRevision:   number      // increments when layout changes
    channelsRevision: number      // increments when channels change
    effectsRevision:  number      // increments when effects change
    layoutPacket:     Uint8Array  // full framed packet (with 5-byte header)
    channelsPacket:   Uint8Array
    effectsPacket:    Uint8Array
}
```

## SerialConnector (`serial-connector.ts`)

Forwards pre-built binary packets to an ESP32 over USB Serial (Web Serial API).

**Baud rate**: 921,600 (default). Matches `Serial.begin(921600)` in `main.cpp`.

### Send Logic

Uses revision-based change detection to minimize serial traffic:

```typescript
override onEngineState(state: EngineConnectorState) {
    const first = this.frameCount === 0

    if (first || state.bpm !== this.cachedBpm)
        this.send(buildBpmPacket(state.bpm))

    if (first || state.layoutRevision !== this.cachedLayout)
        this.send(state.layoutPacket)           // full framed packet

    if (first || state.channelsRevision !== this.cachedChannels)
        this.send(state.channelsPacket)

    if (first || state.effectsRevision !== this.cachedEffects)
        this.send(state.effectsPacket)

    if (first || this.frameCount % 120 === 0)   // every ~2s at 60fps
        this.send(buildTimesyncPacket(state.elapsedMs))

    this.frameCount++
}
```

The framed packets (with `[0xAA][0x55]` header) are sent as-is — the ESP32 state machine strips the header before passing the payload to `engine_dispatch`.

### Read Loop

Incoming serial data (ESP32 log output like `[dmx] 0 0 0 255`) is decoded as UTF-8 text, split on newlines, and pushed to `connector.logs`. This is fire-and-forget — errors are silently dropped.

### Error Isolation

`send()` wraps `writer.write()` in a try-catch so a synchronous throw (e.g. port closed unexpectedly) triggers `disconnect()` instead of propagating into the render loop. The render loop additionally wraps `notifyEngineState` in a try-catch to ensure the RAF chain is never broken by a misbehaving connector.

## ESP32 (`pio/src/main.cpp`)

### Packet Reception

A byte-level state machine processes incoming serial bytes:

```
WAIT_MAGIC1 → WAIT_MAGIC2 → WAIT_TYPE → WAIT_LEN_LO → WAIT_LEN_HI → COLLECT
```

On complete packet: calls `dispatch()`:
- `TYPE_TIMESYNC` (0x13): handled locally — updates `timeOffset` via exponential smoothing
- All other types: forwarded to `engine_dispatch(engine, rxType, rxBuf, rxPos)`

RxBuf size: 8,192 bytes — sufficient for all standard packet sizes.

### Render Loop

```cpp
void loop() {
    while (Serial.available()) processByte(Serial.read());

    uint32_t now = millis();
    float engineTime = (float)now + timeOffset;   // aligned to browser clock
    engine_render(engine, engineTime, now - lastMs);
    lastMs = now;

    const uint8_t* dmx = engine_get_dmx_buffer(engine);
    ledcWrite(LED_PIN, dmx[0]);   // DMX ch1 → LED brightness

    // Log first 4 channels every 100ms
    if (now - lastDmxReport >= 100) { ... }
}
```

No `delay()` — the loop runs as fast as the CPU allows (~kHz). Packet reception and rendering are interleaved naturally.

### Clock Alignment

The ESP32 runs its own `millis()` clock. The browser sends `TYPE_TIMESYNC` with its elapsed time every ~2 seconds. The ESP32 blends this into a `timeOffset`:

```cpp
timeOffset = timeOffset * 0.85f + (browserElapsed - millis()) * 0.15f;
float engineTime = millis() + timeOffset;
```

This keeps the ESP32's effect phase synchronized with the browser simulation even without a shared clock source.
