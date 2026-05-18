#include <Arduino.h>
#include <stdint.h>
#include <string.h>
#include <Preferences.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <NeoPixelBus.h>
#include "engine_ffi.h"
#include "version.h"

#ifndef MDNS_HOSTNAME_PREFIX
#define MDNS_HOSTNAME_PREFIX "pixelmapper-strip"
#endif
#ifndef MAX_LEDS_HARD_CAP
#define MAX_LEDS_HARD_CAP 2048
#endif

// ── Protocol ─────────────────────────────────────────────────────────────────
#define MAGIC0            0xAA
#define MAGIC1            0x55
#define TYPE_VERSION_REQ  0x11
#define TYPE_TIMESYNC     0x13
#define TYPE_STRIP_CONFIG 0x19

// ── NVS-backed config ────────────────────────────────────────────────────────
static Preferences prefs;
static String      wifiSsid;
static String      wifiPass;
static uint8_t     dataPin     = 48;
static String      hostname;

// ── Runtime strip state (set via TYPE_STRIP_CONFIG) ──────────────────────────
static uint16_t    ledCount     = 0;
static uint8_t     groupSize    = 1;
using StripT = NeoPixelBus<NeoGrbFeature, NeoEsp32Rmt0Ws2812xMethod>;
static StripT*     strip        = nullptr;

// ── WebSocket + engine ───────────────────────────────────────────────────────
static AsyncWebServer       server(80);
static AsyncWebSocket       ws("/ws");
static AsyncWebSocketClient* activeClient = nullptr;
static EffectEngine*        engine        = nullptr;
static float                timeOffset    = 0.0f;
static uint32_t             lastMs        = 0;
static uint32_t             lastDmxReport = 0;

// ── Logging helpers (Serial + optional WS broadcast) ─────────────────────────
static void sendLog(const String& msg) {
    Serial.println(msg);
    if (activeClient && activeClient->status() == WS_CONNECTED) {
        activeClient->text(msg);
    }
}
static void sendLogf(const char* fmt, ...) {
    char buf[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    sendLog(String(buf));
}

// ── Boot info broadcast (parsed by the browser wizard) ───────────────────────
static void printBootInfo(const char* mode) {
    Serial.printf("[info] firmware=%s\n", FIRMWARE_VERSION);
    Serial.printf("[info] hostname=%s.local\n", hostname.c_str());
    Serial.printf("[info] ssid=%s\n",     wifiSsid.c_str());
    Serial.printf("[info] pin=%u\n",      (unsigned)dataPin);
    Serial.printf("[info] mode=%s\n",     mode);
}

// ── Packet receiver state machine (identical to pio/src/main.cpp) ────────────
enum RxState { WAIT_MAGIC1, WAIT_MAGIC2, WAIT_TYPE, WAIT_LEN_LO, WAIT_LEN_HI, COLLECT };

static RxState  rxState    = WAIT_MAGIC1;
static uint8_t  rxType     = 0;
static uint16_t rxExpected = 0;
static uint16_t rxPos      = 0;
static uint8_t  rxBuf[8192];

static inline float    readF32LE(const uint8_t* buf) { float v; memcpy(&v, buf, 4); return v; }
static inline uint16_t readU16LE(const uint8_t* buf) { return (uint16_t)buf[0] | ((uint16_t)buf[1] << 8); }

static void recreateStrip(uint16_t newCount) {
    if (strip && newCount == ledCount) return;
    if (strip) { delete strip; strip = nullptr; }
    if (newCount == 0) return;
    if (newCount > MAX_LEDS_HARD_CAP) newCount = MAX_LEDS_HARD_CAP;
    strip = new StripT(newCount, dataPin);
    strip->Begin();
    strip->ClearTo(RgbColor(0, 0, 0));
    strip->Show();
    ledCount = newCount;
    sendLogf("[strip] count=%u pin=%u", (unsigned)ledCount, (unsigned)dataPin);
}

static void handleStripConfig() {
    if (rxPos < 7) {
        sendLogf("[rx] strip_config too short: %u", rxPos);
        return;
    }
    uint8_t  chipType     = rxBuf[0];
    uint16_t newLedCount  = readU16LE(rxBuf + 1);
    uint16_t newGroupSize = readU16LE(rxBuf + 3);
    uint16_t ledsPerMeter = readU16LE(rxBuf + 5);
    (void)chipType;
    (void)ledsPerMeter;
    if (newGroupSize == 0) newGroupSize = 1;
    groupSize = (uint8_t)min<uint16_t>(newGroupSize, 255);
    recreateStrip(newLedCount);
}

static void dispatch() {
    if (rxType == TYPE_VERSION_REQ) {
        sendLogf("[version] %s", FIRMWARE_VERSION);
    } else if (rxType == TYPE_TIMESYNC) {
        if (rxPos != 4) return;
        float browserElapsed = readF32LE(rxBuf);
        float newOffset = browserElapsed - (float)millis();
        timeOffset = timeOffset * 0.85f + newOffset * 0.15f;
    } else if (rxType == TYPE_STRIP_CONFIG) {
        handleStripConfig();
    } else {
        int32_t r = engine_dispatch(engine, rxType, rxBuf, rxPos);
        if (r < 0) sendLogf("[rx] type=0x%02X len=%u result=%d", rxType, rxPos, r);
    }
}

static void processByte(uint8_t b) {
    switch (rxState) {
        case WAIT_MAGIC1: if (b == MAGIC0) rxState = WAIT_MAGIC2; break;
        case WAIT_MAGIC2: rxState = (b == MAGIC1) ? WAIT_TYPE : WAIT_MAGIC1; break;
        case WAIT_TYPE:   rxType = b; rxState = WAIT_LEN_LO; break;
        case WAIT_LEN_LO: rxExpected = b; rxState = WAIT_LEN_HI; break;
        case WAIT_LEN_HI:
            rxExpected |= ((uint16_t)b << 8);
            if (rxExpected == 0)               { dispatch(); rxState = WAIT_MAGIC1; }
            else if (rxExpected > sizeof(rxBuf)) {
                sendLogf("[rx] packet too large: %u — dropping", rxExpected);
                rxState = WAIT_MAGIC1;
            } else { rxPos = 0; rxState = COLLECT; }
            break;
        case COLLECT:
            rxBuf[rxPos++] = b;
            if (rxPos == rxExpected) { dispatch(); rxState = WAIT_MAGIC1; }
            break;
    }
}

// ── CONFIG_MODE: read [config] lines from Serial, persist to NVS ─────────────
// Stays here forever until a [config] commit arrives.
//
//   [config] ssid=Heim-WLAN
//   [config] pass=secret
//   [config] pin=48
//   [config] commit
//
// Replies one line per assignment ("[config] ok ssid"), and on commit either
// reboots into RUN_MODE (if ssid is now set) or stays here.
static void runConfigMode() {
    String line;
    while (true) {
        while (Serial.available()) {
            char c = (char)Serial.read();
            if (c == '\r') continue;
            if (c == '\n') {
                line.trim();
                if (line.startsWith("[config] ")) {
                    String kv = line.substring(9);
                    int eq = kv.indexOf('=');
                    if (kv == "commit") {
                        prefs.putString("wifi_ssid", wifiSsid);
                        prefs.putString("wifi_pass", wifiPass);
                        prefs.putUChar("data_pin",  dataPin);
                        Serial.println("[config] ok — restarting");
                        delay(150);
                        ESP.restart();
                    } else if (eq > 0) {
                        String k = kv.substring(0, eq);
                        String v = kv.substring(eq + 1);
                        if      (k == "ssid") wifiSsid = v;
                        else if (k == "pass") wifiPass = v;
                        else if (k == "pin")  dataPin  = (uint8_t)v.toInt();
                        else {
                            Serial.printf("[config] err unknown key %s\n", k.c_str());
                            line = ""; continue;
                        }
                        Serial.printf("[config] ok %s\n", k.c_str());
                    }
                }
                line = "";
            } else {
                line += c;
                if (line.length() > 256) line = "";
            }
        }
        delay(10);
    }
}

// ── RUN_MODE WebSocket events ────────────────────────────────────────────────
static void onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
                      AwsEventType type, void* arg, uint8_t* data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        activeClient = client;
        sendLogf("[ws] connected — version %s", FIRMWARE_VERSION);
    } else if (type == WS_EVT_DISCONNECT) {
        if (activeClient == client) activeClient = nullptr;
        rxState = WAIT_MAGIC1;
    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo* info = (AwsFrameInfo*) arg;
        if (info->opcode == WS_BINARY) {
            for (size_t i = 0; i < len; i++) processByte(data[i]);
        }
    }
}

static void runRunMode() {
    Serial.printf("[boot] connecting to %s\n", wifiSsid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
        delay(200);
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[boot] WiFi failed — falling back to CONFIG_MODE");
        runConfigMode();
    }
    Serial.printf("[boot] WiFi ok ip=%s\n", WiFi.localIP().toString().c_str());

    if (MDNS.begin(hostname.c_str())) {
        MDNS.addService("pixelmapper", "tcp", 80);
        MDNS.addServiceTxt("pixelmapper", "tcp", "version", FIRMWARE_VERSION);
        MDNS.addServiceTxt("pixelmapper", "tcp", "pin",     String(dataPin));
        Serial.printf("[mdns] %s.local\n", hostname.c_str());
    }

    engine = engine_new();

    ws.onEvent(onWsEvent);
    server.addHandler(&ws);
    server.begin();

    Serial.printf("[boot] ready — ws://%s.local/ws\n", hostname.c_str());

    lastMs = millis();
    while (true) {
        uint32_t now   = millis();
        float    delta = (float)(now - lastMs);
        lastMs         = now;
        float    engineTime = (float)now + timeOffset;

        engine_render(engine, engineTime, delta);

        if (strip && ledCount > 0) {
            const uint8_t* dmx = engine_get_dmx_buffer(engine);
            const uint16_t logicalPixels = (ledCount + groupSize - 1) / groupSize;
            for (uint16_t i = 0; i < logicalPixels; i++) {
                RgbColor c(dmx[i * 3 + 0], dmx[i * 3 + 1], dmx[i * 3 + 2]);
                for (uint16_t k = 0; k < groupSize; k++) {
                    uint16_t physIdx = (uint16_t)i * groupSize + k;
                    if (physIdx < ledCount) strip->SetPixelColor(physIdx, c);
                }
            }
            if (strip->CanShow()) strip->Show();
        }

        if (now - lastDmxReport >= 500) {
            lastDmxReport = now;
            const uint8_t* dmx = engine_get_dmx_buffer(engine);
            sendLogf("[dmx] %u %u %u %u", dmx[0], dmx[1], dmx[2], dmx[3]);
        }

        ws.cleanupClients();
        delay(0);
    }
}

// ── Arduino entry points ──────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(200);

    prefs.begin("pixmap", false);
    wifiSsid = prefs.getString("wifi_ssid", "");
    wifiPass = prefs.getString("wifi_pass", "");
    dataPin  = prefs.getUChar("data_pin", 48);
    hostname = String(MDNS_HOSTNAME_PREFIX) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);

    const char* mode = wifiSsid.isEmpty() ? "config" : "run";
    printBootInfo(mode);

    if (wifiSsid.isEmpty()) {
        Serial.println("[boot] CONFIG_MODE — awaiting [config] commands");
        runConfigMode();
    }
    runRunMode();
}

void loop() {
    // unused — runRunMode() / runConfigMode() never return
    delay(1000);
}
