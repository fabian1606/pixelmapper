use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use femtovg::{Canvas, renderer::OpenGl};
use crate::spatial::SpatialIndex;
use crate::types::FixtureCanvasData;
use crate::svg_render::{SvgCachedFixture, parse_svg};

const FIXTURE_RADIUS: f32 = 18.0;

/// Squared distance from a point to the closest segment of a polyline.
/// Returns true if any segment is within sqrt(threshold_sq).
fn point_near_polyline_sq(px: f32, py: f32, points: &[[f32; 2]], threshold_sq: f32) -> bool {
    if points.len() < 2 { return false; }
    for i in 0..points.len() - 1 {
        let ax = points[i][0];
        let ay = points[i][1];
        let bx = points[i + 1][0];
        let by = points[i + 1][1];
        let dx = bx - ax;
        let dy = by - ay;
        let seg_len_sq = dx * dx + dy * dy;
        if seg_len_sq < 0.0001 {
            let qx = px - ax;
            let qy = py - ay;
            if qx * qx + qy * qy <= threshold_sq { return true; }
            continue;
        }
        let t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq;
        let t = t.clamp(0.0, 1.0);
        let cx = ax + dx * t;
        let cy = ay + dy * t;
        let qx = px - cx;
        let qy = py - cy;
        if qx * qx + qy * qy <= threshold_sq { return true; }
    }
    false
}

/// Strip-curve hit test: samples the CAPPED curve (same one the renderer
/// draws) and checks distance to each chord. Clicking outside the rendered
/// portion of the strip (e.g. a control-polyline tail that got trimmed) does
/// NOT count as a hit, which matches the visual.
fn point_near_strip_curve_sq(px: f32, py: f32, control_points: &[[f32; 2]], target_length: f32, threshold_sq: f32) -> bool {
    let (samples, _cum) = crate::render::sample_strip_curve_capped(control_points, target_length);
    point_near_polyline_sq(px, py, &samples, threshold_sq)
}

/// Local copy of render::sample_at_arc_length (private there). Used by
/// hit_test_strip_endpoint to place mid-handles at curve arc-length midpoints.
fn sample_at_arc_length_local(samples: &[[f32; 2]], cum: &[f32], s: f32) -> [f32; 2] {
    if samples.is_empty() { return [0.0, 0.0]; }
    let total = *cum.last().unwrap_or(&0.0);
    if s <= 0.0 { return samples[0]; }
    if s >= total { return *samples.last().unwrap(); }
    let mut lo = 0usize;
    let mut hi = cum.len() - 1;
    while lo + 1 < hi {
        let mid = (lo + hi) >> 1;
        if cum[mid] <= s { lo = mid; } else { hi = mid; }
    }
    let s0 = cum[lo];
    let s1 = cum[hi];
    let t = (s - s0) / (s1 - s0).max(0.0001);
    let a = samples[lo];
    let b = samples[hi];
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

#[wasm_bindgen]
pub struct WasmCanvas {
    #[wasm_bindgen(skip)]
    pub canvas: Option<Canvas<OpenGl>>,
    #[wasm_bindgen(skip)]
    pub spatial_index: SpatialIndex,
    #[wasm_bindgen(skip)]
    pub fixtures: Vec<FixtureCanvasData>,
    #[wasm_bindgen(skip)]
    pub render_state: crate::render::RenderState,
    #[wasm_bindgen(skip)]
    pub svg_cache: HashMap<String, SvgCachedFixture>,
    #[wasm_bindgen(skip)]
    pub remote_selection_colors: HashMap<String, [u8; 3]>,
}

#[wasm_bindgen]
impl WasmCanvas {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        Self {
            canvas: None,
            spatial_index: SpatialIndex::new(),
            fixtures: Vec::new(),
            render_state: crate::render::RenderState::default(),
            svg_cache: HashMap::new(),
            remote_selection_colors: HashMap::new(),
        }
    }

    #[wasm_bindgen]
    pub fn init_gl(&mut self, html_canvas: web_sys::HtmlCanvasElement) -> Result<(), JsValue> {
        let renderer = OpenGl::new_from_html_canvas(&html_canvas)
            .map_err(|e| JsValue::from_str(&format!("Failed to create OpenGl renderer: {:?}", e)))?;

        let mut femto_canvas = Canvas::new(renderer)
            .map_err(|e| JsValue::from_str(&format!("Failed to create Femtovg Canvas: {:?}", e)))?;

        if let Ok(font_id) = femto_canvas.add_font_mem(include_bytes!("fonts/Roboto-Regular.ttf")) {
            self.render_state.font_id = Some(font_id);
        } else {
            eprintln!("[canvas] Failed to load font into canvas");
        }

        self.canvas = Some(femto_canvas);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn sync_fixtures(&mut self, serialized_fixtures: &str) -> Result<(), JsValue> {
        let fixtures: Vec<FixtureCanvasData> = serde_json::from_str(serialized_fixtures)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse fixtures: {}", e)))?;

        // Rebuild SVG cache: parse new/changed SVGs, drop removed ones
        let mut new_cache: HashMap<String, SvgCachedFixture> = HashMap::new();
        for f in &fixtures {
            if let Some(svg_data) = &f.svg {
                // Reuse existing cached entry if the fixture id is already present
                // (SVG string doesn't change unless the fixture definition changed)
                if let Some(cached) = self.svg_cache.remove(&f.id) {
                    new_cache.insert(f.id.clone(), cached);
                } else if let Some(parsed) = parse_svg(svg_data, &f.beams) {
                    new_cache.insert(f.id.clone(), parsed);
                }
            }
        }
        self.svg_cache = new_cache;

        self.fixtures = fixtures;
        // Reapply remote selection colors (lost during deserialization since field is #[serde(skip)])
        for f in &mut self.fixtures {
            f.remote_selection_color = self.remote_selection_colors.get(&f.id).copied();
        }
        self.spatial_index.rebuild(
            &self.fixtures,
            self.render_state.world_w,
            self.render_state.world_h,
        );
        Ok(())
    }

    /// Update selection state without a full R-Tree rebuild.
    #[wasm_bindgen]
    pub fn set_selected(&mut self, ids: js_sys::Array) {
        let id_set: std::collections::HashSet<String> =
            ids.iter().filter_map(|v| v.as_string()).collect();
        for f in &mut self.fixtures {
            f.selected = id_set.contains(&f.id);
        }
    }

    /// Update remote collaborator selections. Accepts JSON: [{id, r, g, b}]
    #[wasm_bindgen]
    pub fn set_remote_selections(&mut self, json: &str) {
        #[derive(serde::Deserialize)]
        struct Entry { id: String, r: u8, g: u8, b: u8 }
        let entries: Vec<Entry> = serde_json::from_str(json).unwrap_or_default();
        self.remote_selection_colors = entries.into_iter().map(|e| (e.id, [e.r, e.g, e.b])).collect();
        for f in &mut self.fixtures {
            f.remote_selection_color = self.remote_selection_colors.get(&f.id).copied();
        }
    }

    #[wasm_bindgen]
    pub fn set_camera(&mut self, x: f32, y: f32, scale: f32) {
        self.render_state.cam_x = x;
        self.render_state.cam_y = y;
        self.render_state.scale = scale;
    }

    #[wasm_bindgen]
    pub fn set_viewport(&mut self, w: f32, h: f32) {
        self.render_state.viewport_w = w;
        self.render_state.viewport_h = h;
    }

    #[wasm_bindgen]
    pub fn set_world(&mut self, w: f32, h: f32) {
        self.render_state.world_w = w;
        self.render_state.world_h = h;
    }

    #[wasm_bindgen]
    pub fn set_marquee(&mut self, is_active: bool, sx: f32, sy: f32, ex: f32, ey: f32) {
        self.render_state.is_marquee = is_active;
        self.render_state.marquee_sx = sx;
        self.render_state.marquee_sy = sy;
        self.render_state.marquee_ex = ex;
        self.render_state.marquee_ey = ey;
    }

    #[wasm_bindgen]
    pub fn draw(&mut self, dmx_buffer: &[u8]) {
        if let Some(canvas) = &mut self.canvas {
            crate::render::draw_frame(canvas, &self.render_state, &self.fixtures, &self.svg_cache, dmx_buffer);
        }
    }

    /// Hit test in viewport space. Returns fixture id or undefined.
    ///
    /// For strip fixtures, performs a precise polyline distance check so the
    /// AABB doesn't produce false positives in the empty space between bends.
    /// Non-strip fixtures use the AABB result directly.
    #[wasm_bindgen]
    pub fn hit_test(&self, vx: f32, vy: f32) -> Option<String> {
        let scale = self.render_state.scale;
        let wx = (vx - self.render_state.cam_x) / scale;
        let wy = (vy - self.render_state.cam_y) / scale;

        let hit_dist = (8.0 / scale).max(2.0);
        let hit_dist_sq = hit_dist * hit_dist;

        let candidate_ids = self.spatial_index.hit_test_all(wx, wy);
        for cid in &candidate_ids {
            // Look up the actual fixture data to decide precise vs AABB.
            let f = match self.fixtures.iter().find(|f| f.id == *cid) {
                Some(f) => f,
                None => continue,
            };
            if let Some(strip) = &f.strip {
                if point_near_strip_curve_sq(wx, wy, &strip.points, strip.target_length, hit_dist_sq) {
                    return Some(f.id.clone());
                }
                // Strip AABB hit but cursor isn't actually on the curve.
                continue;
            }
            return Some(f.id.clone());
        }
        None
    }

    /// Returns fixture id if viewport point is over a rotation corner handle.
    /// Only multi-beam fixtures have rotation handles.
    #[wasm_bindgen]
    pub fn hit_test_rotation_zone(&self, vx: f32, vy: f32) -> Option<String> {
        let scale = self.render_state.scale;
        let world_w = self.render_state.world_w;
        let world_h = self.render_state.world_h;

        let wx = (vx - self.render_state.cam_x) / scale;
        let wy = (vy - self.render_state.cam_y) / scale;

        let hit_r = 8.0 / scale;
        let margin = 6.0 / scale;

        for fixture in &self.fixtures {
            if fixture.beams.len() <= 1 { continue; }
            // Strips use Figma-style endpoint handles instead of rotation corners.
            if fixture.strip.is_some() { continue; }

            let fx = fixture.world_x * world_w;
            let fy = fixture.world_y * world_h;
            let hw = FIXTURE_RADIUS * fixture.width;
            let hh = FIXTURE_RADIUS * fixture.height;

            let rot = fixture.rotation.to_radians();
            let cos_r = rot.cos();
            let sin_r = rot.sin();
            let dx = wx - fx;
            let dy = wy - fy;
            let lx =  dx * cos_r + dy * sin_r;
            let ly = -dx * sin_r + dy * cos_r;

            let corners = [
                (-hw - margin, -hh - margin),
                ( hw + margin, -hh - margin),
                (-hw - margin,  hh + margin),
                ( hw + margin,  hh + margin),
            ];
            for (cx, cy) in corners {
                if (lx - cx).abs() <= hit_r && (ly - cy).abs() <= hit_r {
                    return Some(fixture.id.clone());
                }
            }
        }
        None
    }

    /// Hit-test for NeoPixel strip handles. Only fires for strips currently
    /// in EDIT mode (i.e. `editing == true`). Returns one of:
    ///   - "<fixtureId>:vertex:<idx>"  → vertex handle hit (drag to move)
    ///   - "<fixtureId>:mid:<idx>"     → mid-segment handle hit (click to insert)
    /// Vertex handles take priority over mid-handles.
    #[wasm_bindgen]
    pub fn hit_test_strip_endpoint(&self, vx: f32, vy: f32) -> Option<String> {
        let scale = self.render_state.scale;
        let wx = (vx - self.render_state.cam_x) / scale;
        let wy = (vy - self.render_state.cam_y) / scale;

        let vert_r = 10.0 / scale;
        let vert_r_sq = vert_r * vert_r;
        let mid_r = 8.0 / scale;
        let mid_r_sq = mid_r * mid_r;

        // First pass: vertex handles (priority).
        for fixture in &self.fixtures {
            if !fixture.editing { continue; }
            let strip = match &fixture.strip { Some(s) => s, None => continue };
            for (i, p) in strip.points.iter().enumerate() {
                let d = (wx - p[0]).powi(2) + (wy - p[1]).powi(2);
                if d <= vert_r_sq {
                    return Some(format!("{}:vertex:{}", fixture.id, i));
                }
            }
        }
        // Second pass: mid-segment handles, placed at the ARC-LENGTH midpoint
        // of each Bézier segment so they always sit on the visible curve.
        for fixture in &self.fixtures {
            if !fixture.editing { continue; }
            let strip = match &fixture.strip { Some(s) => s, None => continue };
            if strip.points.len() < 2 { continue; }
            let (samples, cum) = crate::render::sample_strip_curve(&strip.points);
            for i in 0..strip.points.len() - 1 {
                // Each Bézier segment's samples span (i*BEZIER_SAMPLES_PER_SEG ..
                // (i+1)*BEZIER_SAMPLES_PER_SEG) — see render::sample_strip_curve.
                let seg_start = cum[i * crate::render::BEZIER_SAMPLES_PER_SEG];
                let seg_end = cum[(i + 1) * crate::render::BEZIER_SAMPLES_PER_SEG];
                let mid_s = (seg_start + seg_end) * 0.5;
                let mid = sample_at_arc_length_local(&samples, &cum, mid_s);
                let d = (wx - mid[0]).powi(2) + (wy - mid[1]).powi(2);
                if d <= mid_r_sq {
                    return Some(format!("{}:mid:{}", fixture.id, i));
                }
            }
        }
        None
    }

    #[wasm_bindgen]
    pub fn marquee_select(&self, start_x: f32, start_y: f32, end_x: f32, end_y: f32) -> js_sys::Array {
        let ids = self.spatial_index.marquee_select(start_x, start_y, end_x, end_y);
        let arr = js_sys::Array::new();
        for id in ids {
            arr.push(&JsValue::from_str(&id));
        }
        arr
    }
}
