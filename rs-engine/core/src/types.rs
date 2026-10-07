// ── Engine types ─────────────────────────────────

use serde::{Deserialize, Serialize};

/// How a modifier output is combined with the current value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum BlendMode {
    #[default]
    Add,
    Override,
    Multiply,
    Max,
    Min,
}

impl BlendMode {
    /// Wire id → blend mode (unknown → add).
    pub fn from_id(id: u8) -> Self {
        match id {
            1 => BlendMode::Override,
            2 => BlendMode::Multiply,
            3 => BlendMode::Max,
            4 => BlendMode::Min,
            _ => BlendMode::Add,
        }
    }
}

/// How a plugin's output is interpreted (manifest `output`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum OutputMode {
    /// Modulation in [−1, 1] (±2 with offsets), mapped by strength.
    #[default]
    Bipolar,
    /// Target value in [0, 1], mixed by blend mode with strength as amount.
    Absolute,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpeedMode {
    #[serde(rename = "time")]
    Time,
    #[serde(rename = "beat")]
    Beat,
    #[serde(rename = "infinite")]
    Infinite,
}

/// Speed of a chaser step or modifier cycle.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SpeedConfig {
    pub mode: SpeedMode,
    #[serde(rename = "timeMs")]
    pub time_ms: f32,
    #[serde(rename = "beatValue")]
    pub beat_value: f32,
    #[serde(rename = "beatOffset")]
    pub beat_offset: f32,
}

/// Programmed steps of one channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChaserConfig {
    #[serde(rename = "stepValues")]
    pub step_values: Vec<f32>,
    #[serde(rename = "stepsCount")]
    pub steps_count: usize,
    #[serde(rename = "activeEditStep")]
    pub active_edit_step: usize,
    #[serde(rename = "isPlaying")]
    pub is_playing: bool,
    #[serde(rename = "stepDuration")]
    pub step_duration: SpeedConfig,
    #[serde(rename = "fadeDuration")]
    pub fade_duration: SpeedConfig,
}

/// One DMX channel slot known to the engine (from the layout packet).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderTarget {
    #[serde(rename = "dmxIndex")]
    pub dmx_index: usize,
    /// Binary channel type id (see `engine::channel_type_name`).
    #[serde(rename = "channelTypeId")]
    pub channel_type_id: u8,
    /// Fixture index in the layout.
    #[serde(rename = "groupIndex")]
    pub group_index: usize,
    /// Head (beam) index within the fixture.
    #[serde(rename = "headIndex")]
    pub head_index: usize,
    #[serde(rename = "worldX")]
    pub world_x: f32,
    #[serde(rename = "worldY")]
    pub world_y: f32,
    #[serde(rename = "chaserConfig")]
    pub chaser_config: Option<ChaserConfig>,
    /// 0 = fine byte of another channel, 1–3 = coarse channel resolution.
    pub resolution: u8,
    /// Absolute DMX indices of fine/ultra-fine bytes (0xFFFF = none).
    #[serde(rename = "fineOffsets")]
    pub fine_offsets: [usize; 2],
    #[serde(rename = "rangeMin")]
    pub range_min: u8,
    #[serde(rename = "rangeMax")]
    pub range_max: u8,
}

/// Spatial phase distribution (fanning direction) of a modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectDirection {
    #[serde(rename = "NONE")]
    None,
    #[serde(rename = "LINEAR")]
    Linear,
    #[serde(rename = "RADIAL")]
    Radial,
    #[serde(rename = "SYMMETRICAL")]
    Symmetrical,
    #[serde(rename = "ANGULAR")]
    Angular,
}

impl EffectDirection {
    /// Wire id → direction (unknown → none).
    pub fn from_id(id: u8) -> Self {
        match id {
            1 => EffectDirection::Linear,
            2 => EffectDirection::Radial,
            3 => EffectDirection::Symmetrical,
            4 => EffectDirection::Angular,
            _ => EffectDirection::None,
        }
    }
}
