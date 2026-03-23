#include <Arduino.h>
#include <stdint.h>
#include <string.h>
#include <Update.h>
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
#define TYPE_OTA_BEGIN   0x15  // u32 LE (total size) — starts OTA process
#define TYPE_OTA_CHUNK   0x16  // payload is bytes to write
#define TYPE_OTA_END     0x17  // zero-length — finishes OTA and reboots

// ── Globals ───────────────────────────────────────────────────────────────────
static EffectEngine* engine       = nullptr;
static float         timeOffset   = 0.0f;
static uint32_t      lastMs        = 0;
static uint32_t      lastDmxReport = 0;

// OTA State
static bool          otaActive     = false;
static uint32_t      otaTotalSize  = 0;
static uint32_t      otaWritten    = 0;

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

static inline uint32_t readU32LE(const uint8_t* buf) {
    uint32_t v; memcpy(&v, buf, 4); return v;
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
    } else if (rxType == TYPE_OTA_BEGIN) {
        if (rxPos != 4) return;
        otaTotalSize = readU32LE(rxBuf);
        otaWritten   = 0;
        otaActive    = Update.begin(otaTotalSize, U_FLASH);
        if (otaActive) {
            Serial.printf("[ota] begin %u bytes\n", otaTotalSize);
        } else {
            Serial.printf("[ota] error begin: %s\n", Update.errorString());
        }
    } else if (rxType == TYPE_OTA_CHUNK) {
        if (!otaActive) return;
        size_t written = Update.write(rxBuf, rxPos);
        if (written == rxPos) {
            otaWritten += written;
            // Send exactly [ota] chunk <written> so the sender knows it's safe to send the next
            Serial.printf("[ota] chunk %u\n", otaWritten);
        } else {
            Serial.printf("[ota] write failed: %s\n", Update.errorString());
            otaActive = false;
        }
    } else if (rxType == TYPE_OTA_END) {
        if (!otaActive) return;
        if (Update.end(true)) {
            Serial.println("[ota] success! rebooting...");
            delay(100);
            ESP.restart();
        } else {
            Serial.printf("[ota] end failed: %s\n", Update.errorString());
            otaActive = false;
        }
    } else {
        if (otaActive) return; // Drop frame data if we are in the middle of an OTA update
        // All other packet types go directly to the Rust engine
        int32_t r = engine_dispatch(engine, rxType, rxBuf, rxPos);
        // Only log errors to avoid serial congestion
        if (r < 0) Serial.printf("[rx] type=0x%02X len=%u result=%d\n", rxType, rxPos, r);
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
    Serial.setRxBufferSize(16384);
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
