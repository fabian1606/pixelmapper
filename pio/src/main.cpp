#include "Arduino.h"
#include "engine_ffi.h"

static EffectEngine* engine = nullptr;
static uint32_t last_ms = 0;

void setup() {
    Serial.begin(115200);
    engine = engine_new();
    engine_set_bpm(engine, 120.0f);
    last_ms = millis();
    Serial.println("rs-engine-core initialized");
}

void loop() {
    uint32_t now = millis();
    float delta = (float)(now - last_ms);
    last_ms = now;

    engine_render(engine, (float)now, delta);

    const uint8_t* dmx = engine_get_dmx_buffer(engine);
    // Print first 4 channels as smoke test
    Serial.printf("DMX[1-4]: %d %d %d %d\n", dmx[1], dmx[2], dmx[3], dmx[4]);

    delay(500);
}

