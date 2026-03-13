#include "Arduino.h"

#define LED_PIN   45
#define SYNC_BYTE 0xFF

static uint8_t dmx[512];
static uint8_t rxBuf[512];
static int     rxPos    = 0;
static bool    synced   = false;

static uint32_t packetCount   = 0;
static uint32_t lastReportMs  = 0;
static uint32_t bytesReceived = 0;

void setup() {
    Serial.begin(921600);
    delay(200);

    // LEDC PWM setup — more reliable than analogWrite on ESP32-P4
    ledcAttach(LED_PIN, 5000, 8); // pin, 5kHz, 8-bit (0-255)

    // Selftest: fade up/down to confirm PWM works
    Serial.println("[selftest] fade up");
    for (int v = 0; v <= 255; v += 5) { ledcWrite(LED_PIN, v); delay(10); }
    Serial.println("[selftest] fade down");
    for (int v = 255; v >= 0; v -= 5) { ledcWrite(LED_PIN, v); delay(10); }

    Serial.println("[boot] ready — DMX ch1 (index 0) drives LED brightness");
}

void loop() {
    // DMX channel 1 (index 0) → LED brightness via PWM
    analogWrite(LED_PIN, dmx[0]);

    while (Serial.available()) {
        uint8_t b = Serial.read();
        bytesReceived++;

        if (!synced) {
            if (b == SYNC_BYTE) { synced = true; rxPos = 0; }
            continue;
        }
        rxBuf[rxPos++] = b;
        if (rxPos == 512) {
            memcpy(dmx, rxBuf, 512);
            packetCount++;
            synced = false;
            rxPos  = 0;
            Serial.printf("[pkt #%lu] ch1=%d ch2=%d ch3=%d ch4=%d\n",
                packetCount, dmx[0], dmx[1], dmx[2], dmx[3]);
        }
    }

    uint32_t now = millis();
    if (now - lastReportMs >= 2000) {
        if      (bytesReceived == 0) Serial.println("[rx] no bytes — check USB + baud");
        else if (packetCount   == 0) Serial.printf("[rx] %lu bytes, 0 packets — no 0xFF sync\n", bytesReceived);
        else                         Serial.printf("[stats] %lu pkts/2s  ch1=%d\n", packetCount, dmx[0]);
        packetCount = bytesReceived = 0;
        lastReportMs = now;
    }
}
