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

/// Visual shape of an LED strip. Drives how `points` is interpreted by the
/// renderer (see `sample_strip_capped`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StripShapeType {
    Bezier,
    Line,
    Circle,
}

fn default_bezier() -> StripShapeType { StripShapeType::Bezier }

/// Visualization-only metadata for parametric NeoPixel LED strips.
///
/// Beams already encode logical pixels (one per addressable color group).
/// `ledCount` lets the renderer draw the individual physical LED dots —
/// when `groupSize > 1`, N consecutive LEDs share the color of one beam.
///
/// `points` is interpreted per `shape_type`:
///   bezier → ≥2 vertices, Catmull-Rom spline
///   line   → exactly 2 vertices (start/end of the straight segment)
///   circle → exactly 1 vertex (center); radius = target_length / (2π)
/// Coordinates are in WORLD-PIXEL space (not normalized, not fixture-local).
/// The renderer ignores the fixture's rotation/position when `strip` is
/// present — `points` already encodes world placement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StripData {
    #[serde(rename = "shapeType", default = "default_bezier")]
    pub shape_type: StripShapeType,
    #[serde(rename = "ledCount")]
    pub led_count: usize,
    #[serde(rename = "groupSize")]
    pub group_size: usize,
    /// Target arc-length in world-pixels (= lengthMeters × 250). The renderer
    /// walks from `points[0]` (star anchor) along the shape for exactly this
    /// distance. For circle, the radius is derived from this value.
    #[serde(rename = "targetLength", default)]
    pub target_length: f32,
    /// Shape vertices in world-pixel coordinates. bezier: ≥2 | line: =2 | circle: =1 (center).
    #[serde(default)]
    pub points: Vec<[f32; 2]>,
    /// Index of the currently focused vertex (set when the user clicks a
    /// handle). The renderer draws a highlight ring; the JS side uses it as
    /// the target for keyboard Delete/Backspace. `-1` = no focused vertex.
    /// Only used in bezier edit-mode.
    #[serde(rename = "selectedVertexIdx", default = "neg_one")]
    pub selected_vertex_idx: i32,
    /// Circle only: true = clockwise, false = counter-clockwise. Default true.
    #[serde(default = "default_true")]
    pub clockwise: bool,
}

fn neg_one() -> i32 { -1 }
fn default_true() -> bool { true }

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
