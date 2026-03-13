#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct EffectEngine EffectEngine;

EffectEngine*  engine_new();
void           engine_free(EffectEngine* engine);
void           engine_set_bpm(EffectEngine* engine, float bpm);
void           engine_render(EffectEngine* engine, float time_ms, float delta_ms);

/// Returns pointer to 512-byte DMX buffer. Valid until next engine call.
const uint8_t* engine_get_dmx_buffer(const EffectEngine* engine);

/// json: null-terminated UTF-8 string, format: Vec<RenderTarget>
void engine_sync_targets_json(EffectEngine* engine, const char* json);

/// json: null-terminated UTF-8 string, format: Vec<EffectConfig>
void engine_sync_effects_json(EffectEngine* engine, const char* json);

#ifdef __cplusplus
}
#endif
