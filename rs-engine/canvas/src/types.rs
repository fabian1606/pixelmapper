use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureBeam {
    pub id: String,
    #[serde(rename = "localX")]
    pub local_x: f32,
    #[serde(rename = "localY")]
    pub local_y: f32,
    /// Absolute 0-based DMX index for red channel (None = channel not present)
    #[serde(rename = "rIndex", default)]
    pub r_index: Option<usize>,
    #[serde(rename = "gIndex", default)]
    pub g_index: Option<usize>,
    #[serde(rename = "bIndex", default)]
    pub b_index: Option<usize>,
    #[serde(rename = "dimmerIndex", default)]
    pub dimmer_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureCanvasData {
    pub id: String,

    #[serde(rename = "worldX")]
    pub world_x: f32,

    #[serde(rename = "worldY")]
    pub world_y: f32,

    pub width: f32,
    pub height: f32,

    pub rotation: f32, // in degrees

    #[serde(default)]
    pub selected: bool,

    pub svg: Option<String>,

    #[serde(default)]
    pub beams: Vec<FixtureBeam>,

    #[serde(rename = "channelStart")]
    pub channel_start: usize,

    /// Fallback color channels for single-beam / beamless fixtures
    #[serde(rename = "rIndex", default)]
    pub r_index: Option<usize>,
    #[serde(rename = "gIndex", default)]
    pub g_index: Option<usize>,
    #[serde(rename = "bIndex", default)]
    pub b_index: Option<usize>,
    #[serde(rename = "dimmerIndex", default)]
    pub dimmer_index: Option<usize>,
}
