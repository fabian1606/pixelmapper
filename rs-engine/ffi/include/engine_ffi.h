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

/// Unified binary dispatch: 0x10=BPM, 0x14=layout, 0x15=channels, 0x16=effects
/// Returns count of parsed items, or -1 on error.
int32_t engine_dispatch(EffectEngine* engine, uint8_t packet_type, const uint8_t* data, uint32_t len);

/// Legacy JSON functions (kept for reference)
int32_t engine_sync_targets_json(EffectEngine* engine, const char* json);
int32_t engine_sync_effects_json(EffectEngine* engine, const char* json);

#ifdef __cplusplus
}
#endif
