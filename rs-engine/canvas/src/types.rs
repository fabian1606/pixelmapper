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
    /// ID of the SVG element that this beam is mapped to (custom SVG fixtures only)
    #[serde(rename = "svgElementId", default)]
    pub svg_element_id: Option<String>,
}

/// Visualization-only metadata for parametric NeoPixel LED strips.
///
/// Beams already encode logical pixels (one per addressable color group).
/// `ledCount` lets the renderer draw the individual physical LED dots —
/// when `groupSize > 1`, N consecutive LEDs share the color of one beam.
///
/// `points` is the polyline shape of the strip in WORLD-PIXEL coordinates
/// (not normalized, not fixture-local). The renderer ignores the fixture's
/// rotation/position when `strip` is present — the polyline already encodes
/// world placement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StripData {
    #[serde(rename = "ledCount")]
    pub led_count: usize,
    #[serde(rename = "groupSize")]
    pub group_size: usize,
    /// Target arc-length in world-pixels (= lengthMeters × 250). The renderer
    /// walks from `points[0]` (star anchor) along the Catmull-Rom curve for
    /// exactly this distance — trimming the tail if the polyline is longer,
    /// extending in the last tangent direction if it's shorter. So the strip
    /// is ALWAYS rendered at exactly this length regardless of vertex moves.
    #[serde(rename = "targetLength", default)]
    pub target_length: f32,
    /// Polyline vertices in world-pixel coordinates. Always ≥ 2.
    #[serde(default)]
    pub points: Vec<[f32; 2]>,
    /// Index of the currently focused vertex (set when the user clicks a
    /// handle). The renderer draws a highlight ring; the JS side uses it as
    /// the target for keyboard Delete/Backspace. `-1` = no focused vertex.
    #[serde(rename = "selectedVertexIdx", default = "neg_one")]
    pub selected_vertex_idx: i32,
}

fn neg_one() -> i32 { -1 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureCanvasData {
    pub id: String,
    pub name: String,

    #[serde(rename = "worldX")]
    pub world_x: f32,

    #[serde(rename = "worldY")]
    pub world_y: f32,

    pub width: f32,
    pub height: f32,

    pub rotation: f32, // in degrees

    #[serde(default)]
    pub selected: bool,

    /// Strip-only "edit mode" flag — when true, vertex/mid-handles are drawn
    /// and become hit-testable. Set via a 2nd click on an already-selected strip.
    #[serde(default)]
    pub editing: bool,

    /// Remote collaborator selection color [r, g, b] — None if not selected by a remote user
    #[serde(skip)]
    pub remote_selection_color: Option<[u8; 3]>,

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

    /// Present when this fixture is a parametric NeoPixel strip.
    /// Switches the renderer into Figma-style vector-line mode.
    #[serde(default)]
    pub strip: Option<StripData>,
}
