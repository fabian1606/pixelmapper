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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WaveformShape {
    #[serde(rename = "sine")]
    Sine,
    #[serde(rename = "square")]
    Square,
    #[serde(rename = "triangle")]
    Triangle,
    #[serde(rename = "sawtooth")]
    Sawtooth,
    #[serde(rename = "bounce")]
    Bounce,
    #[serde(rename = "ramp")]
    Ramp,
    #[serde(rename = "smooth")]
    Smooth,
}

impl Default for WaveformShape {
    fn default() -> Self { WaveformShape::Sine }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WaveformShapeParams {
    /// Normalized 0–1 shape parameter. Meaning depends on shape.
    pub param: f32,
    /// Where in the cycle the waveform starts (0–1).
    pub start: f32,
    /// Where in the cycle the waveform ends (0–1).
    pub end: f32,
    /// Hold value before the active zone [-1, 1]. >2.0 = use natural shape value at t=0.
    pub start_level: f32,
    /// Hold value after the active zone [-1, 1]. >2.0 = use natural shape value at t=1.
    pub end_level: f32,
}

impl Default for WaveformShapeParams {
    fn default() -> Self { WaveformShapeParams { param: 0.5, start: 0.0, end: 1.0, start_level: 999.0, end_level: 999.0 } }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum NoiseType {
    #[default]
    White,
    Perlin,
    Step,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ChannelMode {
    #[default]
    Linked,
    Independent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NoiseParams {
    #[serde(rename = "noiseType", default)]
    pub noise_type: NoiseType,
    #[serde(default = "noise_scale_default")]
    pub scale: f32,
    #[serde(rename = "channelMode", default)]
    pub channel_mode: ChannelMode,
    #[serde(rename = "colorVariation", default)]
    pub color_variation: f32,
    #[serde(default)]
    pub fade: f32,
    #[serde(default)]
    pub threshold: f32,
}

fn noise_scale_default() -> f32 { 1.0 }

impl Default for NoiseParams {
    fn default() -> Self { NoiseParams { noise_type: NoiseType::White, scale: 1.0, channel_mode: ChannelMode::Linked, color_variation: 0.0, fade: 0.0, threshold: 0.0 } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SequencerPatternType {
    #[default]
    Split,
    Checkerboard,
    Sections,
    Scatter,
    Flow,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SequencerParams {
    #[serde(rename = "patternType", default)]
    pub pattern_type: SequencerPatternType,
    #[serde(rename = "originX", default = "half")]
    pub origin_x: f32,
    #[serde(rename = "originY", default = "half")]
    pub origin_y: f32,
    #[serde(default)]
    pub angle: f32,
    #[serde(default = "default_seq_scale")]
    pub scale: f32,
    #[serde(default = "default_seq_count")]
    pub count: u8,
    #[serde(default = "half")]
    pub density: f32,
    #[serde(rename = "densityVariation", default)]
    pub density_variation: f32,
    #[serde(default)]
    pub invert: bool,
}

fn half() -> f32 { 0.5 }
fn default_seq_scale() -> f32 { 0.1 }
fn default_seq_count() -> u8 { 4 }

impl Default for SequencerParams {
    fn default() -> Self {
        SequencerParams {
            pattern_type: SequencerPatternType::Split,
            origin_x: 0.5,
            origin_y: 0.5,
            angle: 0.0,
            scale: 0.1,
            count: 4,
            density: 0.5,
            density_variation: 0.0,
            invert: false,
        }
    }
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
    #[serde(rename = "waveformShape", default)]
    pub waveform_shape: WaveformShape,
    #[serde(rename = "waveformParams", default)]
    pub waveform_params: WaveformShapeParams,
    #[serde(rename = "noiseParams", default)]
    pub noise_params: Option<NoiseParams>,
    #[serde(rename = "sequencerParams", default)]
    pub sequencer_params: Option<SequencerParams>,
    #[serde(rename = "effectType", default)]
    pub effect_type: String,
}
