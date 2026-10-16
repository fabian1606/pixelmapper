use serde::{Deserialize, Serialize};

/// One COLOR-role DMX channel: its absolute 0-based DMX index plus the RGB of
/// its defined `colorValue` (e.g. red, amber, white). The renderer scales this
/// RGB by the channel's DMX value and adds it into the mix.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorChannel {
    pub index: usize,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// One COLOR_WHEEL-role channel: the DMX value SELECTS a color via a 256-entry
/// RGB lookup table (768 bytes, [r,g,b] per DMX value). Never scales brightness.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LutChannel {
    pub index: usize,
    pub lut: Vec<u8>,
}

/// One SHUTTER-role channel: 256-entry frequency table indexed by DMX value.
/// -1 = closed, 0 = open, >0 = strobe frequency in Hz.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShutterChannel {
    pub index: usize,
    pub freq: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureBeam {
    pub id: String,
    #[serde(rename = "localX")]
    pub local_x: f32,
    #[serde(rename = "localY")]
    pub local_y: f32,
    /// COLOR-role channels for this beam (empty = no color channels present)
    #[serde(rename = "colorChannels", default)]
    pub color_channels: Vec<ColorChannel>,
    #[serde(rename = "dimmerIndex", default)]
    pub dimmer_index: Option<usize>,
    /// COLOR_WHEEL-role channels for this beam (dmx → slot color LUT)
    #[serde(rename = "colorLuts", default)]
    pub color_luts: Vec<LutChannel>,
    /// SHUTTER-role channels for this beam (dmx → open/closed/strobe-Hz LUT)
    #[serde(rename = "shutterChannels", default)]
    pub shutter_channels: Vec<ShutterChannel>,
    /// All DIMMER-role channel indices; factors multiply. Supersedes dimmerIndex
    /// when non-empty (dimmerIndex kept for payload back-compat).
    #[serde(rename = "dimmerIndices", default)]
    pub dimmer_indices: Vec<usize>,
    /// ID of the SVG element that this beam is mapped to (custom SVG fixtures only)
    #[serde(rename = "svgElementId", default)]
    pub svg_element_id: Option<String>,
    /// Fixture-kind beams: world-pixel positions of the physical emitters
    /// sharing this beam's color (e.g. the LEDs of one strip pixel group).
    /// When non-empty they are drawn instead of the `localX/localY` dot.
    #[serde(default)]
    pub emitters: Vec<[f32; 2]>,
    /// Emitter dot radius in world pixels (0 = default 4).
    #[serde(rename = "emitterRadius", default)]
    pub emitter_radius: f32,
}

// ── Fixture-kind primitives (ADR §5.6) ───────────────────────────────────────
//
// Fixture kinds compile into generic body primitives and handles. All
// coordinates arrive in WORLD pixels (the TS side applies the fixture's
// position and rotation); colors arrive resolved as RGBA bytes.

/// Stroke/fill of a body primitive (absent = not drawn).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BodyStyle {
    #[serde(default)]
    pub stroke: Option<[u8; 4]>,
    #[serde(default)]
    pub fill: Option<[u8; 4]>,
}

/// One drawable body primitive in world pixels.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum BodyPrimitive {
    Polyline {
        points: Vec<[f32; 2]>,
        #[serde(default)]
        closed: bool,
        width: f32,
        #[serde(default)]
        style: BodyStyle,
    },
    Polygon {
        points: Vec<[f32; 2]>,
        #[serde(default)]
        style: BodyStyle,
    },
    Circle {
        center: [f32; 2],
        radius: f32,
        #[serde(default)]
        style: BodyStyle,
    },
    Rect {
        /// [x, y, w, h]
        rect: [f32; 4],
        #[serde(default)]
        radius: f32,
        #[serde(default)]
        style: BodyStyle,
    },
}

/// An editable control point in world pixels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandleData {
    pub id: String,
    pub x: f32,
    pub y: f32,
    /// 'vertex' | 'midpoint' | 'anchor' | 'rotate'
    pub role: String,
}

impl HandleData {
    /// Anchor handles are active whenever the fixture is selected; the
    /// others only in edit mode.
    pub fn active(&self, selected: bool, edit_mode: bool) -> bool {
        edit_mode || (selected && self.role == "anchor")
    }
}

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

    /// Generic edit mode (second click on a selected kind fixture with
    /// non-anchor handles): all handles are drawn and hit-testable.
    #[serde(rename = "editMode", default)]
    pub edit_mode: bool,

    /// Remote collaborator selection color [r, g, b] — None if not selected by a remote user
    #[serde(skip)]
    pub remote_selection_color: Option<[u8; 3]>,

    pub svg: Option<String>,

    #[serde(default)]
    pub beams: Vec<FixtureBeam>,

    #[serde(rename = "channelStart")]
    pub channel_start: usize,

    /// COLOR-role channels for single-beam / beamless fixtures
    #[serde(rename = "colorChannels", default)]
    pub color_channels: Vec<ColorChannel>,
    #[serde(rename = "dimmerIndex", default)]
    pub dimmer_index: Option<usize>,
    #[serde(rename = "colorLuts", default)]
    pub color_luts: Vec<LutChannel>,
    #[serde(rename = "shutterChannels", default)]
    pub shutter_channels: Vec<ShutterChannel>,
    #[serde(rename = "dimmerIndices", default)]
    pub dimmer_indices: Vec<usize>,

    /// Fixture-kind body primitives (world pixels). Non-empty → the fixture
    /// is drawn generically from primitives + beam emitters.
    #[serde(default)]
    pub body: Vec<BodyPrimitive>,

    /// Fixture-kind handles (world pixels).
    #[serde(default)]
    pub handles: Vec<HandleData>,

    /// Id of the focused handle (highlight ring; Delete target).
    #[serde(rename = "focusedHandle", default)]
    pub focused_handle: Option<String>,
}

impl FixtureCanvasData {
    /// True for fixtures drawn from kind primitives.
    pub fn is_kind(&self) -> bool {
        !self.body.is_empty() || self.beams.iter().any(|b| !b.emitters.is_empty())
    }
}
