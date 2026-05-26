#include <Arduino.h>
#include <stdint.h>
#include <string.h>
#include <Preferences.h>
#ifdef USE_ETHERNET
  #include <SPI.h>
  #include <ETH.h>
#endif
// WiFi is also pulled in for Ethernet builds so we can host an unassociated
// STA + ESP-NOW alongside the wired transport.
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <ESPmDNS.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <FastLED.h>
#include "engine_ffi.h"
#include "version.h"

#ifndef MDNS_HOSTNAME_PREFIX
#define MDNS_HOSTNAME_PREFIX "pixelmapper-strip"
#endif
#ifndef MAX_LEDS_HARD_CAP
#define MAX_LEDS_HARD_CAP 1024
#endif

// Multi-strip support: split the global LED buffer into up to MAX_SLOTS
// equal-sized segments. Each slot drives its own GPIO pin via its own FastLED
// controller. Total = MAX_SLOTS * MAX_LEDS_PER_SLOT, must fit within
// MAX_LEDS_HARD_CAP. Pins are persisted in NVS — changes require a reboot
// (FastLED templates lock pins at compile time, no clean de-registration).
#define MAX_SLOTS          4
#define MAX_LEDS_PER_SLOT  (MAX_LEDS_HARD_CAP / MAX_SLOTS)

// ── Protocol ─────────────────────────────────────────────────────────────────
#define MAGIC0            0xAA
#define MAGIC1            0x55
#define TYPE_VERSION_REQ  0x11
#define TYPE_TIMESYNC     0x13
#define TYPE_STRIP_CONFIG 0x19
#define TYPE_STRIP_SLOTS  0x1A
#define TYPE_ESPNOW_SLOT   0x1B
#define TYPE_ESPNOW_ENABLE 0x1C

// ── NVS-backed config ────────────────────────────────────────────────────────
static Preferences prefs;
#ifndef USE_ETHERNET
static String      wifiSsid;
static String      wifiPass;
#endif
static uint8_t     dataPin     = 21;
static String      hostname;
static bool        espNowEnabled = false;  // NVS-persisted "espnow_en"
static bool        espNowReady   = false;  // set true after esp_now_init + peer add
struct EspNowSlot {
    bool     enabled;
    uint16_t dmxStart;
    uint8_t  rIdx, gIdx, bIdx, dimIdx;
};
static EspNowSlot  espNowSlot = { false, 0, 0, 1, 2, 3 };
static uint32_t    lastEspNowSendMs = 0;
static const uint32_t ESPNOW_SEND_PERIOD_MS = 33;  // ~30 Hz
static const uint8_t  ESPNOW_BROADCAST_ADDR[6] = { 0xFF,0xFF,0xFF,0xFF,0xFF,0xFF };
struct __attribute__((packed)) EspNowColorCommand {
    uint8_t r, g, b, brightness;
};
static void espNowStart();
static void espNowStop();

// ── LED buffer + runtime state ───────────────────────────────────────────────
// FastLED needs a compile-time pin. We pre-allocate a fixed buffer at the hard
// cap and slice it into per-slot segments. Each slot has an offset into this
// buffer and gets its own FastLED controller registered at boot.
static CRGB        leds[MAX_LEDS_HARD_CAP];

struct StripSlot {
    uint8_t  pin;          // GPIO pin driving this strip
    uint16_t ledCount;     // physical LED count
    uint8_t  groupSize;    // physical LEDs per logical pixel
    uint16_t bufferOffset; // offset into leds[]
};

static StripSlot slots[MAX_SLOTS];
static uint8_t   slotCount = 0;
static bool      stripReady = false;

// ── WebSocket + engine ───────────────────────────────────────────────────────
static AsyncWebServer       server(80);
static AsyncWebSocket       ws("/ws");
static AsyncWebSocketClient* activeClient = nullptr;
static EffectEngine*        engine        = nullptr;
static float                timeOffset    = 0.0f;
static uint32_t             lastMs        = 0;

// ── Logging helpers (Serial-only) ────────────────────────────────────────────
// Originally also mirrored to the WS client, but AsyncWebSocket isn't safe for
// concurrent text() from the main task while the AsyncTCP task is processing
// frames on the same client. Logs now go to Serial exclusively.
static void sendLog(const String& msg) {
    Serial.println(msg);
}
static void sendLogf(const char* fmt, ...) {
    char buf[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    sendLog(String(buf));
}

// ── FastLED pin selector ─────────────────────────────────────────────────────
// FastLED encodes the pin as a template parameter — to support runtime pin
// selection we expand a switch over every reasonable ESP32-S3 GPIO and let
// the optimizer drop the unused branches. `bufStart` and `len` slice the
// global `leds[]` buffer for this controller (multi-strip: each slot gets a
// dedicated segment).
//
// Skipped pins:
//   0     boot strap (sometimes used as input for boot mode)
//   22-34 PSRAM/flash on N16R8/N32R8 modules (board-dependent)
//   43,44 USB-Serial-JTAG (UART0)
//   45,46 boot strapping (must be low at boot)
#define LED_BRANCH(PIN) case PIN: FastLED.addLeds<WS2812B, PIN, GRB>(bufStart, len); return true
static bool registerStripPin(uint8_t pin, CRGB* bufStart, uint16_t len) {
    switch (pin) {
        LED_BRANCH( 1); LED_BRANCH( 2); LED_BRANCH( 3); LED_BRANCH( 4);
        LED_BRANCH( 5); LED_BRANCH( 6); LED_BRANCH( 7); LED_BRANCH( 8);
        LED_BRANCH( 9); LED_BRANCH(10); LED_BRANCH(11); LED_BRANCH(12);
        LED_BRANCH(13); LED_BRANCH(14); LED_BRANCH(15); LED_BRANCH(16);
        LED_BRANCH(17); LED_BRANCH(18); LED_BRANCH(19); LED_BRANCH(20);
        LED_BRANCH(21); LED_BRANCH(35); LED_BRANCH(36); LED_BRANCH(37);
        LED_BRANCH(38); LED_BRANCH(39); LED_BRANCH(40); LED_BRANCH(41);
        LED_BRANCH(42); LED_BRANCH(47); LED_BRANCH(48);
        default: return false;
    }
}
#undef LED_BRANCH

// ── NVS slot-pin persistence ────────────────────────────────────────────────
// Stored as a raw byte blob "slot_pins" — N bytes, one GPIO per slot.
// If unset (legacy / single-strip mode), falls back to "data_pin" + 1 slot.
static uint8_t loadSlotPinsFromNVS(uint8_t out[MAX_SLOTS]) {
    uint8_t buf[MAX_SLOTS] = {0};
    size_t n = prefs.getBytes("slot_pins", buf, MAX_SLOTS);
    if (n == 0) {
        // Legacy: single pin from "data_pin"
        out[0] = prefs.getUChar("data_pin", 48);
        return 1;
    }
    uint8_t count = 0;
    for (size_t i = 0; i < n && i < MAX_SLOTS; i++) {
        if (buf[i] == 0) break;
        out[count++] = buf[i];
    }
    if (count == 0) {
        out[0] = prefs.getUChar("data_pin", 48);
        return 1;
    }
    return count;
}

static void saveSlotPinsToNVS(const uint8_t* pins, uint8_t count) {
    uint8_t buf[MAX_SLOTS] = {0};
    for (uint8_t i = 0; i < count && i < MAX_SLOTS; i++) buf[i] = pins[i];
    prefs.putBytes("slot_pins", buf, MAX_SLOTS);
    // Keep "data_pin" in sync with slot 0 for the boot info / legacy code path
    if (count > 0) prefs.putUChar("data_pin", pins[0]);
}

// ── Boot info broadcast (parsed by the browser wizard) ───────────────────────
static void printBootInfo(const char* mode) {
    Serial.printf("[info] firmware=%s\n", FIRMWARE_VERSION);
    Serial.printf("[info] hostname=%s.local\n", hostname.c_str());
#ifdef USE_ETHERNET
    Serial.printf("[info] net=eth\n");
#else
    Serial.printf("[info] net=wifi\n");
    Serial.printf("[info] ssid=%s\n", wifiSsid.c_str());
#endif
    Serial.printf("[info] pin=%u\n",  (unsigned)dataPin);
    Serial.printf("[info] espnow=%u\n", espNowEnabled ? 1u : 0u);
    Serial.printf("[info] mode=%s\n", mode);
}

// ── Packet receiver state machine ────────────────────────────────────────────
enum RxState { WAIT_MAGIC1, WAIT_MAGIC2, WAIT_TYPE, WAIT_LEN_LO, WAIT_LEN_HI, COLLECT };

static RxState  rxState    = WAIT_MAGIC1;
static uint8_t  rxType     = 0;
static uint16_t rxExpected = 0;
static uint16_t rxPos      = 0;
// Sized for layout packets up to ~1024 logical pixels × ~16 bytes/channel ×
// up to 4 channels/pixel, plus a generous fudge factor. Bumped from 8192
// after audience-fixture + multi-slot setups overflowed.
static uint8_t  rxBuf[24576];

// ── WS → main-loop byte ring buffer ──────────────────────────────────────────
// WebSocket events fire on the AsyncTCP task, but the engine FFI is not
// thread-safe. We copy raw bytes into this ring from the event callback and
// drain it from the main loop so engine_dispatch / engine_render only ever
// run on one task.
static constexpr size_t  RX_RING_SIZE = 32768;
static uint8_t           rxRing[RX_RING_SIZE];
static volatile uint32_t rxRingHead = 0;
static volatile uint32_t rxRingTail = 0;
static volatile uint32_t rxRingDropped = 0;
static volatile bool     rxResetRequested = false;

static void rxRingPush(const uint8_t* data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        uint32_t next = (rxRingHead + 1) % RX_RING_SIZE;
        if (next == rxRingTail) { rxRingDropped++; return; }
        rxRing[rxRingHead] = data[i];
        rxRingHead = next;
    }
}

static inline float    readF32LE(const uint8_t* buf) { float v; memcpy(&v, buf, 4); return v; }
static inline uint16_t readU16LE(const uint8_t* buf) { return (uint16_t)buf[0] | ((uint16_t)buf[1] << 8); }

// Legacy single-strip config (TYPE_STRIP_CONFIG 0x19). New clients send
// TYPE_STRIP_SLOTS instead — this path is kept for older client versions.
static void handleStripConfig() {
    if (rxPos < 7) {
        sendLogf("[rx] strip_config too short: %u", rxPos);
        return;
    }
    uint16_t newLedCount  = readU16LE(rxBuf + 1);
    uint16_t newGroupSize = readU16LE(rxBuf + 3);
    if (newGroupSize == 0) newGroupSize = 1;
    if (newLedCount > MAX_LEDS_PER_SLOT) newLedCount = MAX_LEDS_PER_SLOT;
    if (slotCount >= 1) {
        uint16_t oldCount = slots[0].ledCount;
        for (uint16_t i = newLedCount; i < oldCount; i++) {
            uint16_t idx = slots[0].bufferOffset + i;
            if (idx < MAX_LEDS_HARD_CAP) leds[idx] = CRGB::Black;
        }
        slots[0].ledCount  = newLedCount;
        slots[0].groupSize = (uint8_t)min<uint16_t>(newGroupSize, 255);
        sendLogf("[strip] count=%u group=%u pin=%u",
                 (unsigned)slots[0].ledCount, (unsigned)slots[0].groupSize, (unsigned)slots[0].pin);
    }
}

// Multi-strip config (TYPE_STRIP_SLOTS 0x1A).
// Payload: [count: u8] then per slot: [pin: u8, chip: u8, ledCount: u16,
// groupSize: u16, ledsPerMeter: u16] = 8 bytes/slot.
//
// If the pin set differs from what's currently registered, persist to NVS and
// restart — FastLED can't cleanly switch pins at runtime. Otherwise just
// update ledCount/groupSize live.
static void handleStripSlots() {
    if (rxPos < 1) { sendLogf("[rx] strip_slots too short: %u", rxPos); return; }
    uint8_t count = rxBuf[0];
    if (count == 0 || count > MAX_SLOTS) {
        sendLogf("[rx] strip_slots invalid count=%u (max=%u)", count, MAX_SLOTS);
        return;
    }
    const size_t expected = 1 + (size_t)count * 8;
    if (rxPos < expected) {
        sendLogf("[rx] strip_slots truncated: got %u need %u", rxPos, (unsigned)expected);
        return;
    }

    uint8_t  newPins[MAX_SLOTS]      = {0};
    uint16_t newLedCount[MAX_SLOTS]  = {0};
    uint16_t newGroupSize[MAX_SLOTS] = {0};
    for (uint8_t i = 0; i < count; i++) {
        const uint8_t* p = rxBuf + 1 + i * 8;
        newPins[i]      = p[0];
        // p[1] = chipType (unused, always WS2812B in firmware v1)
        newLedCount[i]  = readU16LE(p + 2);
        newGroupSize[i] = readU16LE(p + 4);
        if (newGroupSize[i] == 0) newGroupSize[i] = 1;
        if (newLedCount[i] > MAX_LEDS_PER_SLOT) newLedCount[i] = MAX_LEDS_PER_SLOT;
    }

    // Compare pin set with the currently registered one. If different, persist
    // the new layout to NVS and reboot — FastLED templates are compile-time.
    bool pinSetChanged = (count != slotCount);
    if (!pinSetChanged) {
        for (uint8_t i = 0; i < count; i++) {
            if (newPins[i] != slots[i].pin) { pinSetChanged = true; break; }
        }
    }

    if (pinSetChanged) {
        sendLogf("[strip] pin set changed (count=%u) — persisting & restarting", count);
        saveSlotPinsToNVS(newPins, count);
        Serial.flush();
        delay(150);
        ESP.restart();
        return; // unreachable
    }

    // Same pins — live-update sizes / groupSize
    for (uint8_t i = 0; i < count; i++) {
        uint16_t oldCount = slots[i].ledCount;
        if (newLedCount[i] != oldCount) {
            for (uint16_t k = newLedCount[i]; k < oldCount; k++) {
                uint16_t idx = slots[i].bufferOffset + k;
                if (idx < MAX_LEDS_HARD_CAP) leds[idx] = CRGB::Black;
            }
            slots[i].ledCount = newLedCount[i];
        }
        slots[i].groupSize = (uint8_t)min<uint16_t>(newGroupSize[i], 255);
        sendLogf("[strip] slot=%u pin=%u count=%u group=%u",
                 i, slots[i].pin, slots[i].ledCount, slots[i].groupSize);
    }
}

static void dispatch() {
    if (rxType == TYPE_VERSION_REQ) {
        sendLogf("[version] %s", FIRMWARE_VERSION);
    } else if (rxType == TYPE_TIMESYNC) {
        if (rxPos != 4) return;
        float browserElapsed = readF32LE(rxBuf);
        float newOffset = browserElapsed - (float)millis();
        // Fast convergence when drift is large (>20ms), slow for fine-tuning.
        // TIMESYNC is now sent every frame so we can afford a small alpha steady-state.
        float err = fabsf(newOffset - timeOffset);
        float alpha = err > 20.0f ? 0.8f : 0.05f;
        timeOffset = timeOffset * (1.0f - alpha) + newOffset * alpha;
    } else if (rxType == TYPE_STRIP_CONFIG) {
        handleStripConfig();
    } else if (rxType == TYPE_STRIP_SLOTS) {
        handleStripSlots();
    } else if (rxType == TYPE_ESPNOW_ENABLE) {
        if (rxPos >= 1) {
            bool wanted = rxBuf[0] != 0;
            if (wanted != espNowEnabled) {
                espNowEnabled = wanted;
                prefs.putBool("espnow_en", espNowEnabled);
                sendLogf("[espnow] enable=%u (persisted)", wanted ? 1u : 0u);
            }
            if (wanted) espNowStart(); else espNowStop();
        } else {
            sendLogf("[rx] espnow_enable too short: %u", rxPos);
        }
    } else if (rxType == TYPE_ESPNOW_SLOT) {
        if (rxPos >= 7) {
            espNowSlot.enabled  = rxBuf[0] != 0;
            espNowSlot.dmxStart = readU16LE(rxBuf + 1);
            espNowSlot.rIdx     = rxBuf[3];
            espNowSlot.gIdx     = rxBuf[4];
            espNowSlot.bIdx     = rxBuf[5];
            espNowSlot.dimIdx   = rxBuf[6];
            sendLogf("[espnow] slot %s start=%u idx=%u/%u/%u dim=%u",
                     espNowSlot.enabled ? "on" : "off",
                     (unsigned)espNowSlot.dmxStart,
                     (unsigned)espNowSlot.rIdx, (unsigned)espNowSlot.gIdx,
                     (unsigned)espNowSlot.bIdx, (unsigned)espNowSlot.dimIdx);
        } else {
            sendLogf("[rx] espnow_slot too short: %u", rxPos);
        }
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
// Re-broadcasts the [info] boot block every 2 seconds so the browser-side
// wizard reliably catches it — by the time the host's SerialPort is open
// after the post-flash USB re-enumeration, the initial Serial bytes may have
// already been lost into the void.
// ── Shared serial [config] line handler ──────────────────────────────────────
// Returns true if the caller should restart immediately (factory-reset or commit).
static bool handleConfigLine(const String& line) {
    if (!line.startsWith("[config] ")) return false;
    String kv = line.substring(9);
    int eq = kv.indexOf('=');
    if (kv == "factory-reset") {
        prefs.clear();
        Serial.println("[config] ok — factory reset, restarting");
        Serial.flush();
        delay(150);
        ESP.restart();
        return true; // unreachable
    } else if (kv == "commit") {
#ifndef USE_ETHERNET
        prefs.putString("wifi_ssid", wifiSsid);
        prefs.putString("wifi_pass", wifiPass);
#endif
        // espnow_en is persisted live via TYPE_ESPNOW_ENABLE from the browser,
        // so the serial `commit` only touches wifi/pin.
        prefs.putUChar("data_pin",  dataPin);
        Serial.println("[config] ok — restarting");
        Serial.flush();
        delay(150);
        ESP.restart();
        return true; // unreachable
    } else if (eq > 0) {
        String k = kv.substring(0, eq);
        String v = kv.substring(eq + 1);
#ifndef USE_ETHERNET
        if      (k == "ssid") wifiSsid = v;
        else if (k == "pass") wifiPass = v;
        else
#endif
        if      (k == "pin")  dataPin  = (uint8_t)v.toInt();
        else {
            Serial.printf("[config] err unknown key %s\n", k.c_str());
            return false;
        }
        Serial.printf("[config] ok %s\n", k.c_str());
    }
    return false;
}

static void runConfigMode() {
    String   line;
    uint32_t lastBroadcast = 0;
    while (true) {
        uint32_t now = millis();
        if (now - lastBroadcast > 2000) {
            lastBroadcast = now;
            printBootInfo("config");
        }
        while (Serial.available()) {
            char c = (char)Serial.read();
            if (c == '\r') continue;
            if (c == '\n') {
                line.trim();
                handleConfigLine(line);
                line = "";
            } else {
                line += c;
                if (line.length() > 256) line = "";
            }
        }
        delay(10);
    }
}

// ── ESP-NOW lifecycle ────────────────────────────────────────────────────────
// Two transports, two channel strategies:
//   • Ethernet build → WiFi is otherwise unused. STA stays disconnected; the
//     radio sits on ch1 by default — same as the bare-bones receiver sketch.
//   • WiFi build     → Radio is locked to the router's channel. Receivers on
//     ch1 will NOT hear our broadcasts unless the router is also on ch1.
static void espNowStart() {
    if (espNowReady) return;
#ifdef USE_ETHERNET
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(50);
    esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
#endif
    if (esp_now_init() != ESP_OK) {
        Serial.println("[espnow] init failed");
        return;
    }
    uint8_t primary; wifi_second_chan_t second;
    esp_wifi_get_channel(&primary, &second);

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, ESPNOW_BROADCAST_ADDR, 6);
    peer.channel = 0;
    peer.ifidx   = WIFI_IF_STA;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) != ESP_OK) {
        Serial.println("[espnow] add_peer failed");
        esp_now_deinit();
        return;
    }
    espNowReady = true;
    Serial.printf("[espnow] ready ch=%u  mac=%s\n",
                  (unsigned)primary, WiFi.macAddress().c_str());
    esp_now_register_send_cb([](const wifi_tx_info_t* /*info*/, esp_now_send_status_t status) {
        static uint32_t okCount = 0, failCount = 0;
        static uint32_t lastReport = 0;
        if (status == ESP_NOW_SEND_SUCCESS) okCount++; else failCount++;
        uint32_t now = millis();
        if (now - lastReport > 5000) {
            lastReport = now;
            Serial.printf("[espnow] tx ok=%lu fail=%lu (last status=%d)\n",
                          (unsigned long)okCount, (unsigned long)failCount, (int)status);
        }
    });
}

static void espNowStop() {
    if (!espNowReady) return;
    esp_now_unregister_send_cb();
    esp_now_del_peer(ESPNOW_BROADCAST_ADDR);
    esp_now_deinit();
    espNowReady = false;
    Serial.println("[espnow] stopped");
}

// ── RUN_MODE WebSocket events ────────────────────────────────────────────────
static void onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
                      AwsEventType type, void* arg, uint8_t* data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        activeClient = client;
        client->client()->setNoDelay(true);  // disable Nagle on this TCP connection
        sendLogf("[ws] connected — version %s", FIRMWARE_VERSION);
    } else if (type == WS_EVT_DISCONNECT) {
        if (activeClient == client) activeClient = nullptr;
        // Signal the main loop to flush the ring + reset the parser. Doing it
        // here would race with concurrent drain/processByte on the main task.
        rxResetRequested = true;
    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo* info = (AwsFrameInfo*) arg;
        if (info->opcode == WS_BINARY) {
            // Push into the ring buffer — actual processing happens in the
            // main loop to avoid concurrent access to the engine.
            rxRingPush(data, len);
        }
    }
}

static void runRunMode() {
    // Register FastLED controllers for every NVS-persisted slot pin. Each slot
    // gets a contiguous MAX_LEDS_PER_SLOT segment of the global leds[] buffer.
    // Pins can only change via a reboot (FastLED templates lock pins at
    // compile time); TYPE_STRIP_SLOTS triggers a save + restart when the pin
    // set differs.
    uint8_t pins[MAX_SLOTS] = {0};
    uint8_t count = loadSlotPinsFromNVS(pins);
    slotCount = 0;
    for (uint8_t i = 0; i < count; i++) {
        uint16_t offset = (uint16_t)i * MAX_LEDS_PER_SLOT;
        if (registerStripPin(pins[i], leds + offset, MAX_LEDS_PER_SLOT)) {
            slots[slotCount].pin          = pins[i];
            slots[slotCount].ledCount     = 0;
            slots[slotCount].groupSize    = 1;
            slots[slotCount].bufferOffset = offset;
            slotCount++;
            Serial.printf("[strip] slot=%u FastLED ready on pin %u (offset=%u)\n",
                          i, pins[i], offset);
        } else {
            Serial.printf("[strip] WARNING: pin %u not in supported set — slot %u disabled\n",
                          pins[i], i);
        }
    }
    stripReady = (slotCount > 0);
    if (stripReady) {
        FastLED.clear();
        FastLED.show();
    }

#ifdef USE_ETHERNET
    Serial.println("[boot] starting Ethernet (W5500 SPI)...");
    ETH.begin(ETH_PHY_W5500, 1,
              ETH_CS, ETH_INT, ETH_RST,
              SPI3_HOST,
              ETH_SCK, ETH_MISO, ETH_MOSI);
    // Some W5500 boards report linkUp() late (post-autoneg). Wait up to 30s
    // for link, then up to 20s for DHCP — log progress so the user sees why
    // we're hanging if either phase fails.
    {
        uint32_t start = millis();
        while (!ETH.linkUp() && millis() - start < 30000) {
            if ((millis() - start) % 2000 < 200) {
                Serial.println("[boot] ETH waiting for link...");
            }
            delay(200);
        }
    }
    if (!ETH.linkUp()) {
        Serial.println("[boot] ETH no link after 30s — continuing anyway (will retry DHCP)");
    } else {
        Serial.println("[boot] ETH link up");
    }
    {
        uint32_t start = millis();
        while (ETH.localIP() == IPAddress(0, 0, 0, 0) && millis() - start < 20000) {
            if ((millis() - start) % 2000 < 200) {
                Serial.println("[boot] ETH waiting for DHCP...");
            }
            delay(200);
        }
    }
    if (ETH.localIP() == IPAddress(0, 0, 0, 0)) {
        Serial.println("[boot] ETH no IP — check cable / DHCP server");
        while (true) delay(1000);
    }
    Serial.printf("[boot] ETH ok ip=%s\n", ETH.localIP().toString().c_str());
#else
    Serial.printf("[boot] connecting to %s\n", wifiSsid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    {
        uint32_t start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) delay(200);
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[boot] WiFi failed — falling back to CONFIG_MODE");
        runConfigMode();
    }
    Serial.printf("[boot] WiFi ok ip=%s\n", WiFi.localIP().toString().c_str());
    WiFi.setSleep(false);  // disable modem sleep — eliminates ~200ms wake-up latency
#endif

    // ESP-NOW is brought up live (also reachable via TYPE_ESPNOW_ENABLE at
    // runtime). On boot we call it once if the persisted flag is set.
    if (espNowEnabled) espNowStart();

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
    uint32_t lastInfoBroadcast = 0;
    uint32_t lastDropReport    = 0;
    uint32_t lastFrame         = 0;
    constexpr uint32_t FRAME_PERIOD_MS = 16;  // ~60 FPS for engine_render + show
    String   serialLine;
    while (true) {
        uint32_t now   = millis();

        // Drain WS bytes queued by the AsyncTCP task before we touch the engine.
        // All engine state mutations happen here on the main task — never
        // concurrently with engine_render / engine_get_dmx_buffer.
        if (rxResetRequested) {
            rxResetRequested = false;
            rxRingTail = rxRingHead;
            rxState = WAIT_MAGIC1;
            rxPos = 0;
        }
        while (rxRingTail != rxRingHead) {
            uint8_t b = rxRing[rxRingTail];
            rxRingTail = (rxRingTail + 1) % RX_RING_SIZE;
            processByte(b);
        }
        if (rxRingDropped && now - lastDropReport > 1000) {
            lastDropReport = now;
            sendLogf("[rx] ring overflow — dropped %u bytes", (unsigned)rxRingDropped);
            rxRingDropped = 0;
        }

        // One render + show per frame at ~60 FPS. Rendering at full loop
        // speed (1000+ FPS) churns the engine's internal buffers, fragments
        // the heap, and starves AsyncTCP/network → WS link dies after seconds.
        if (now - lastFrame >= FRAME_PERIOD_MS) {
            float delta     = (float)(now - lastMs);
            lastMs          = now;
            lastFrame       = now;
            float engineTime = (float)now + timeOffset;

            engine_render(engine, engineTime, delta);

            if (stripReady) {
                const uint8_t* dmx = engine_get_dmx_buffer(engine);
                // The DMX buffer contains all slots concatenated in slot order
                // (the client rebases each fixture's startAddress sequentially).
                // dmxOffset walks the buffer in 3-byte RGB chunks per logical
                // pixel; ledCount/groupSize are per-slot.
                uint32_t dmxOffset = 0;
                bool anyActive = false;
                for (uint8_t s = 0; s < slotCount; s++) {
                    const StripSlot& sl = slots[s];
                    if (sl.ledCount == 0) continue;
                    anyActive = true;
                    const uint8_t gs = sl.groupSize ? sl.groupSize : 1;
                    const uint16_t logicalPixels = (sl.ledCount + gs - 1) / gs;
                    for (uint16_t i = 0; i < logicalPixels; i++) {
                        CRGB c(dmx[dmxOffset + i * 3 + 0],
                               dmx[dmxOffset + i * 3 + 1],
                               dmx[dmxOffset + i * 3 + 2]);
                        for (uint16_t k = 0; k < gs; k++) {
                            uint16_t physIdx = (uint16_t)i * gs + k;
                            if (physIdx >= sl.ledCount) break;
                            uint16_t bufIdx = sl.bufferOffset + physIdx;
                            if (bufIdx < MAX_LEDS_HARD_CAP) leds[bufIdx] = c;
                        }
                    }
                    dmxOffset += (uint32_t)logicalPixels * 3;
                }
                if (anyActive) FastLED.show();
            }

            // ESP-NOW broadcast: read 4 DMX bytes from the configured slot and
            // send them as a ColorCommand to FF:FF:FF:FF:FF:FF. Throttled to
            // ~30 Hz so the WiFi stack stays responsive.
            if (espNowReady && espNowSlot.enabled && now - lastEspNowSendMs >= ESPNOW_SEND_PERIOD_MS) {
                lastEspNowSendMs = now;
                const uint8_t* dmx = engine_get_dmx_buffer(engine);
                EspNowColorCommand cmd = {
                    dmx[espNowSlot.dmxStart + espNowSlot.rIdx],
                    dmx[espNowSlot.dmxStart + espNowSlot.gIdx],
                    dmx[espNowSlot.dmxStart + espNowSlot.bIdx],
                    dmx[espNowSlot.dmxStart + espNowSlot.dimIdx],
                };
                esp_err_t r = esp_now_send(ESPNOW_BROADCAST_ADDR, (const uint8_t*)&cmd, sizeof(cmd));
                static uint32_t lastColorLog = 0;
                if (now - lastColorLog > 2000) {
                    lastColorLog = now;
                    Serial.printf("[espnow] tx rgb=(%u,%u,%u) b=%u  send_rc=%d\n",
                                  cmd.r, cmd.g, cmd.b, cmd.brightness, (int)r);
                }
            }
        }

        // Re-broadcast [info] every 2 s so the browser wizard can detect this
        // device even after it's already configured. Suppress while a WS
        // client is connected: (a) browser doesn't need it then, and (b)
        // sending unrelated Serial output during a live session can fight
        // with the host serial monitor for the USB-CDC bus.
        if (!activeClient && now - lastInfoBroadcast > 2000) {
            lastInfoBroadcast = now;
            printBootInfo("run");
        }

        // Handle [config] factory-reset from Serial even in RUN_MODE.
        while (Serial.available()) {
            char c = (char)Serial.read();
            if (c == '\r') continue;
            if (c == '\n') {
                serialLine.trim();
                handleConfigLine(serialLine);
                serialLine = "";
            } else {
                serialLine += c;
                if (serialLine.length() > 256) serialLine = "";
            }
        }

        ws.cleanupClients();
        // Actually yield to AsyncTCP/network stack — delay(0) on ESP32 does not
        // deschedule the current task at the FreeRTOS level.
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

// ── Arduino entry points ──────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    // Native USB-CDC needs time to enumerate after reset. Give the host long
    // enough to (re)open the port and start listening before we print [info].
    delay(800);

    prefs.begin("pixmap", false);
#ifndef USE_ETHERNET
    wifiSsid = prefs.getString("wifi_ssid", "");
    wifiPass = prefs.getString("wifi_pass", "");
#endif
    dataPin  = prefs.getUChar("data_pin", 48);
    espNowEnabled = prefs.getBool("espnow_en", false);
    hostname = String(MDNS_HOSTNAME_PREFIX) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);

#ifdef USE_ETHERNET
    const char* mode = "run";
#else
    const char* mode = wifiSsid.isEmpty() ? "config" : "run";
#endif

    // Print boot info twice with a small gap so we cover both possibilities:
    // host already listening, or host opens the port between the two prints.
    printBootInfo(mode);
    delay(300);
    printBootInfo(mode);

#ifndef USE_ETHERNET
    if (wifiSsid.isEmpty()) {
        Serial.println("[boot] CONFIG_MODE — awaiting [config] commands");
        runConfigMode();
    }
#endif
    runRunMode();
}

void loop() {
    // unused — runRunMode() / runConfigMode() never return
    delay(1000);
}
