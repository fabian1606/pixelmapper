use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpeedMode {
    #[serde(rename = "time")]
    Time,
    #[serde(rename = "beat")]
    Beat,
    #[serde(rename = "infinite")]
    Infinite,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SpeedConfig {
    pub mode: SpeedMode,
    #[serde(rename = "timeMs")]
    pub time_ms: f32,
    #[serde(rename = "beatValue")]
    pub beat_value: f32,
    #[serde(rename = "beatOffset")]
    pub beat_offset: f32,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderTarget {
    #[serde(rename = "dmxIndex")]
    pub dmx_index: usize,
    #[serde(rename = "channelType")]
    pub channel_type: String, // Or Enum if we want strict matching
    #[serde(rename = "groupIndex")]
    pub group_index: usize, // e.g. Fixture ID for fanning
    #[serde(rename = "worldX")]
    pub world_x: f32,
    #[serde(rename = "worldY")]
    pub world_y: f32,
    #[serde(rename = "chaserConfig")]
    pub chaser_config: Option<ChaserConfig>,
    #[serde(default = "default_resolution")]
    pub resolution: u8,
    #[serde(rename = "fineOffsets", default)]
    pub fine_offsets: [usize; 2],
}

fn default_resolution() -> u8 { 1 }


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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectConfig {
    #[serde(rename = "targetChannels")]
    pub target_channels: Vec<String>,
    #[serde(rename = "targetGroupIndices")]
    pub target_group_indices: Option<Vec<usize>>, // None = all
    pub direction: EffectDirection,
    #[serde(rename = "originX")]
    pub origin_x: f32,
    #[serde(rename = "originY")]
    pub origin_y: f32,
    pub angle: f32,
    pub strength: f32,
    pub reverse: bool,
    pub fanning: f32,
    pub speed: SpeedConfig,
    #[serde(rename = "effectType")]
    pub effect_type: String, // e.g. "Sine" 
}
