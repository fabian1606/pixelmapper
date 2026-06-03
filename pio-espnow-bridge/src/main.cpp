#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <stdint.h>
#include <string.h>

// ── Protocol ──────────────────────────────────────────────────────────────────
// Framing is identical to the strip firmware: 0xAA 0x55 <type> <len_lo> <len_hi> <payload>
#define MAGIC0           0xAA
#define MAGIC1           0x55
#define TYPE_VERSION_REQ 0x11   // no payload → [version] reply on Serial
#define TYPE_COLOR_CMD   0x20   // payload: r(1) g(1) b(1) brightness(1)

#define FIRMWARE_VERSION "1.0.0"

static const uint8_t BROADCAST_ADDR[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

// Wire format matches the existing audience-receiver sketch exactly: 4 raw
// bytes, broadcast as-is to FF:FF:FF:FF:FF:FF.
struct __attribute__((packed)) ColorCommand {
    uint8_t r, g, b, brightness;
};

// ── NVS config ────────────────────────────────────────────────────────────────
static Preferences prefs;
static uint8_t espNowChannel = 1;   // WiFi channel shared with all receivers

// ── Binary packet parser ──────────────────────────────────────────────────────
enum RxState { WAIT_MAGIC1, WAIT_MAGIC2, WAIT_TYPE, WAIT_LEN_LO, WAIT_LEN_HI, COLLECT };
static RxState  rxState    = WAIT_MAGIC1;
static uint8_t  rxType     = 0;
static uint16_t rxExpected = 0;
static uint16_t rxPos      = 0;
// 256 bytes is enough for all command types; enlargen if new types are added.
static uint8_t  rxBuf[256];

static uint32_t lastBinaryMs = 0;   // when we last received a binary frame

// ── Helpers ───────────────────────────────────────────────────────────────────
static void printBootInfo() {
    Serial.printf("[info] firmware=%s\n",   FIRMWARE_VERSION);
    Serial.printf("[info] mode=espnow-bridge\n");
    Serial.printf("[info] channel=%u\n",    (unsigned)espNowChannel);
    Serial.printf("[info] mac=%s\n",        WiFi.macAddress().c_str());
}

// ── Packet dispatch ───────────────────────────────────────────────────────────
static void dispatch() {
    lastBinaryMs = millis();

    if (rxType == TYPE_VERSION_REQ) {
        Serial.printf("[version] %s\n", FIRMWARE_VERSION);

    } else if (rxType == TYPE_COLOR_CMD) {
        if (rxPos < 4) return;
        ColorCommand pkt = { rxBuf[0], rxBuf[1], rxBuf[2], rxBuf[3] };
        esp_now_send(BROADCAST_ADDR, (const uint8_t*)&pkt, sizeof(pkt));
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
            if (rxExpected == 0)                 { dispatch(); rxState = WAIT_MAGIC1; }
            else if (rxExpected > sizeof(rxBuf)) { rxState = WAIT_MAGIC1; }  // drop oversized
            else                                 { rxPos = 0; rxState = COLLECT; }
            break;
        case COLLECT:
            rxBuf[rxPos++] = b;
            if (rxPos == rxExpected) { dispatch(); rxState = WAIT_MAGIC1; }
            break;
    }
}

// ── [config] text commands ────────────────────────────────────────────────────
// Only intended for initial setup / factory-reset. The only persisted setting is
// the WiFi channel — it must match the receivers' channel.
static void handleConfigLine(const String& line) {
    if (!line.startsWith("[config] ")) return;
    String kv = line.substring(9);
    int eq = kv.indexOf('=');
    if (kv == "factory-reset") {
        prefs.clear();
        Serial.println("[config] ok — factory reset, restarting");
        Serial.flush(); delay(150);
        ESP.restart();
    } else if (eq > 0) {
        String k = kv.substring(0, eq);
        String v = kv.substring(eq + 1);
        if (k == "channel") {
            espNowChannel = (uint8_t)v.toInt();
            prefs.putUChar("channel", espNowChannel);
            esp_wifi_set_channel(espNowChannel, WIFI_SECOND_CHAN_NONE);
        } else {
            Serial.printf("[config] err unknown key %s\n", k.c_str());
            return;
        }
        Serial.printf("[config] ok %s=%s\n", k.c_str(), v.c_str());
    }
}

// ── Arduino entry points ──────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    // Native USB-CDC needs time to enumerate after reset.
    delay(800);

    prefs.begin("espbridge", false);
    espNowChannel = prefs.getUChar("channel", 1);

    // Bring up WiFi in STA mode (no association) so ESP-NOW can use the radio.
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(50);
    esp_wifi_set_channel(espNowChannel, WIFI_SECOND_CHAN_NONE);

    if (esp_now_init() != ESP_OK) {
        Serial.println("[boot] ESP-NOW init failed — halting");
        while (true) delay(1000);
    }
    // Matches the reference sender — registered for tx-status logging only.
    esp_now_register_send_cb(
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
        [](const wifi_tx_info_t* /*info*/, esp_now_send_status_t status) {
#else
        [](const uint8_t* /*mac*/, esp_now_send_status_t status) {
#endif
            static uint32_t ok = 0, fail = 0, lastReport = 0;
            if (status == ESP_NOW_SEND_SUCCESS) ok++; else fail++;
            uint32_t now = millis();
            if (now - lastReport > 5000) {
                lastReport = now;
                Serial.printf("[espnow] tx ok=%lu fail=%lu\n",
                              (unsigned long)ok, (unsigned long)fail);
            }
        });

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, BROADCAST_ADDR, 6);
    peer.channel = 0;       // 0 = use current radio channel
    peer.ifidx   = WIFI_IF_STA;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) != ESP_OK) {
        Serial.println("[boot] ESP-NOW add_peer failed — halting");
        while (true) delay(1000);
    }

    // Print twice with a small gap so the host reliably catches at least one
    // copy while the USB-CDC port is being opened.
    printBootInfo();
    delay(300);
    printBootInfo();
    Serial.printf("[boot] ready — ch=%u mac=%s\n",
                  (unsigned)espNowChannel, WiFi.macAddress().c_str());
}

void loop() {
    static uint32_t lastInfoMs = 0;
    static String   serialLine;

    uint32_t now = millis();

    // Drain USB-CDC bytes: every byte feeds the binary parser.
    // Text [config] commands are also collected line-by-line on the side.
    // Non-binary bytes (like '[', 'c', ...) are just 0x5B etc. and won't match
    // the 0xAA magic byte, so they are silently skipped by processByte() when
    // the parser is in WAIT_MAGIC1 state (which it is between binary frames).
    while (Serial.available()) {
        uint8_t b = (uint8_t)Serial.read();
        processByte(b);
        char c = (char)b;
        if (c == '\r') continue;
        if (c == '\n') {
            serialLine.trim();
            if (serialLine.length()) handleConfigLine(serialLine);
            serialLine = "";
        } else if (serialLine.length() < 256) {
            serialLine += c;
        }
    }

    // Re-broadcast [info] every 2 s so the browser wizard can detect the bridge.
    // Suppress while the host is actively sending color frames to avoid
    // cluttering the serial log during live operation.
    bool active = lastBinaryMs > 0 && (now - lastBinaryMs < 3000);
    if (!active && now - lastInfoMs > 2000) {
        lastInfoMs = now;
        printBootInfo();
    }

    delay(1);
}
