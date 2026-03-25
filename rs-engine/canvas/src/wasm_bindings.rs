use wasm_bindgen::prelude::*;
use femtovg::{Canvas, renderer::OpenGl};
use crate::spatial::SpatialIndex;
use crate::types::FixtureCanvasData;

const FIXTURE_RADIUS: f32 = 18.0;

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

        self.fixtures = fixtures;
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
            crate::render::draw_frame(canvas, &self.render_state, &self.fixtures, dmx_buffer);
        }
    }

    /// Hit test in viewport space. Returns fixture id or undefined.
    #[wasm_bindgen]
    pub fn hit_test(&self, vx: f32, vy: f32) -> Option<String> {
        let scale = self.render_state.scale;
        let wx = (vx - self.render_state.cam_x) / scale;
        let wy = (vy - self.render_state.cam_y) / scale;
        self.spatial_index.hit_test(wx, wy)
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
