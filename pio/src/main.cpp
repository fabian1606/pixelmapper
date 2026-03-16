#include <Arduino.h>
#include <stdint.h>
#include <string.h>
#include "engine_ffi.h"
#include "version.h"

// ── Config ────────────────────────────────────────────────────────────────────
#define LED_PIN     45

// ── Protocol ─────────────────────────────────────────────────────────────────
// Packet: [0xAA][0x55][type][len_lo][len_hi][payload × len]
#define MAGIC0           0xAA
#define MAGIC1           0x55
#define TYPE_VERSION_REQ 0x11  // zero-length — reply: "[version] X.Y.Z\n"
#define TYPE_TIMESYNC    0x13  // f32 LE — ESP32-only clock alignment

// ── Globals ───────────────────────────────────────────────────────────────────
static EffectEngine* engine       = nullptr;
static float         timeOffset   = 0.0f;
static uint32_t      lastMs       = 0;
static uint32_t      lastDmxReport = 0;

// ── Packet receiver state machine ────────────────────────────────────────────
enum RxState { WAIT_MAGIC1, WAIT_MAGIC2, WAIT_TYPE, WAIT_LEN_LO, WAIT_LEN_HI, COLLECT };

static RxState  rxState    = WAIT_MAGIC1;
static uint8_t  rxType     = 0;
static uint16_t rxExpected = 0;
static uint16_t rxPos      = 0;
static uint8_t  rxBuf[8192]; // 8KB — binary packets are <4KB

static inline float readF32LE(const uint8_t* buf) {
    float v; memcpy(&v, buf, 4); return v;
}

static void dispatch() {
    if (rxType == TYPE_VERSION_REQ) {
        Serial.printf("[version] %s\n", FIRMWARE_VERSION);
    } else if (rxType == TYPE_TIMESYNC) {
        // Clock alignment is device-specific — handled here, not by the engine
        float browserElapsed = readF32LE(rxBuf);
        float newOffset = browserElapsed - (float)millis();
        timeOffset = timeOffset * 0.85f + newOffset * 0.15f;
        Serial.printf("[rx] timesync offset=%.1f\n", timeOffset);
    } else {
        // All other packet types go directly to the Rust engine
        int32_t r = engine_dispatch(engine, rxType, rxBuf, rxPos);
        Serial.printf("[rx] type=0x%02X len=%u result=%d\n", rxType, rxPos, r);
    }
}

static void processByte(uint8_t b) {
    switch (rxState) {
        case WAIT_MAGIC1:
            if (b == MAGIC0) rxState = WAIT_MAGIC2;
            break;
        case WAIT_MAGIC2:
            rxState = (b == MAGIC1) ? WAIT_TYPE : WAIT_MAGIC1;
            break;
        case WAIT_TYPE:
            rxType  = b;
            rxState = WAIT_LEN_LO;
            break;
        case WAIT_LEN_LO:
            rxExpected = b;
            rxState    = WAIT_LEN_HI;
            break;
        case WAIT_LEN_HI:
            rxExpected |= ((uint16_t)b << 8);
            if (rxExpected == 0) { dispatch(); rxState = WAIT_MAGIC1; }
            else if (rxExpected > sizeof(rxBuf)) {
                Serial.printf("[rx] packet too large: %u bytes — dropping\n", rxExpected);
                rxState = WAIT_MAGIC1;
            } else {
                rxPos   = 0;
                rxState = COLLECT;
            }
            break;
        case COLLECT:
            rxBuf[rxPos++] = b;
            if (rxPos == rxExpected) { dispatch(); rxState = WAIT_MAGIC1; }
            break;
    }
}

// ── Arduino ───────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(921600);
    delay(200);

    engine = engine_new();
    lastMs  = millis();

    ledcAttach(LED_PIN, 5000, 8); // 5kHz, 8-bit PWM

    Serial.printf("[version] %s\n", FIRMWARE_VERSION);
    Serial.println("[boot] ready — waiting for sync");
}

void loop() {
    // Receive packets
    while (Serial.available()) {
        processByte((uint8_t)Serial.read());
    }

    // Render
    uint32_t now   = millis();
    float    delta = (float)(now - lastMs);
    lastMs         = now;
    float    engineTime = (float)now + timeOffset;

    engine_render(engine, engineTime, delta);

    const uint8_t* dmx = engine_get_dmx_buffer(engine);
    ledcWrite(LED_PIN, dmx[0]); // DMX channel 1 (index 0) → LED brightness

    // Send DMX feedback every ~100ms
    if (now - lastDmxReport >= 100) {
        lastDmxReport = now;
        Serial.printf("[dmx] %d %d %d %d\n", dmx[0], dmx[1], dmx[2], dmx[3]);
    }
}
