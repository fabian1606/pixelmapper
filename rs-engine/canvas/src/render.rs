use femtovg::{Canvas, Color, Paint, Path, renderer::OpenGl};
use crate::types::FixtureCanvasData;

pub struct RenderState {
    pub cam_x: f32,
    pub cam_y: f32,
    pub scale: f32,
    pub viewport_w: f32,
    pub viewport_h: f32,
    pub world_w: f32,
    pub world_h: f32,
    pub is_marquee: bool,
    pub marquee_sx: f32,
    pub marquee_sy: f32,
    pub marquee_ex: f32,
    pub marquee_ey: f32,
}

impl Default for RenderState {
    fn default() -> Self {
        Self {
            cam_x: 0.0, cam_y: 0.0, scale: 1.0,
            viewport_w: 800.0, viewport_h: 600.0,
            world_w: 1000.0, world_h: 1000.0,
            is_marquee: false,
            marquee_sx: 0.0, marquee_sy: 0.0, marquee_ex: 0.0, marquee_ey: 0.0,
        }
    }
}

fn border_color(selected: bool) -> Color {
    if selected {
        Color::rgba(251, 191, 36, 255) // --primary yellow
    } else {
        Color::rgba(255, 255, 255, 56) // 0.22 alpha white
    }
}

fn read_color(
    r: Option<usize>, g: Option<usize>, b: Option<usize>,
    dimmer: Option<usize>, buf: &[u8],
) -> Color {
    let get = |i: Option<usize>| i.and_then(|idx| buf.get(idx)).copied().unwrap_or(0);
    let dim = dimmer.and_then(|idx| buf.get(idx)).copied().unwrap_or(255);
    Color::rgba(
        ((get(r) as u16 * dim as u16) / 255) as u8,
        ((get(g) as u16 * dim as u16) / 255) as u8,
        ((get(b) as u16 * dim as u16) / 255) as u8,
        255,
    )
}

pub fn draw_frame(canvas: &mut Canvas<OpenGl>, state: &RenderState, fixtures: &[FixtureCanvasData], dmx_buffer: &[u8]) {
    canvas.set_size(state.viewport_w as u32, state.viewport_h as u32, 1.0);
    canvas.clear_rect(0, 0, state.viewport_w as u32, state.viewport_h as u32, Color::rgba(0, 0, 0, 0));
    canvas.reset_transform();

    // 1. Procedural Infinite Grid (adaptive spacing: dots always ~15px apart on screen)
    if state.scale > 0.5 {
        let dot_spacing = (15.0_f32 / state.scale).max(25.0);
        let start_x = (((-state.cam_x / state.scale) / dot_spacing).floor() * dot_spacing) as f32;
        let start_y = (((-state.cam_y / state.scale) / dot_spacing).floor() * dot_spacing) as f32;
        let end_x = start_x + (state.viewport_w / state.scale) + dot_spacing * 2.0;
        let end_y = start_y + (state.viewport_h / state.scale) + dot_spacing * 2.0;

        let mut path = Path::new();
        let mut gx = start_x;
        while gx <= end_x {
            let mut gy = start_y;
            while gy <= end_y {
                let sx = gx * state.scale + state.cam_x;
                let sy = gy * state.scale + state.cam_y;
                path.circle(sx, sy, 1.2 * state.scale);
                gy += dot_spacing;
            }
            gx += dot_spacing;
        }
        let paint = Paint::color(Color::rgba(255, 255, 255, 35)); // ~0.14 alpha
        canvas.fill_path(&mut path, &paint);
    }

    // 2. Fixture Rendering
    canvas.translate(state.cam_x, state.cam_y);
    canvas.scale(state.scale, state.scale);

    for fixture in fixtures {
        // Compute position and basic dimension
        let wx = fixture.world_x * state.world_w;
        let wy = fixture.world_y * state.world_h;
        let rx = fixture.width * 16.0;
        let ry = fixture.height * 16.0;
        let max_r = f32::max(rx, ry);
        let margin = max_r * 3.0;

        // Frustum Culling
        let screen_x = wx * state.scale + state.cam_x;
        let screen_y = wy * state.scale + state.cam_y;
        let screen_r = margin * state.scale;

        if screen_x + screen_r < 0.0 || screen_x - screen_r > state.viewport_w ||
           screen_y + screen_r < 0.0 || screen_y - screen_r > state.viewport_h {
            continue;
        }

        canvas.save();
        canvas.translate(wx, wy);
        canvas.rotate(fixture.rotation.to_radians());

        if fixture.beams.len() > 1 {
            let base = 18.0;
            let half_w = base * fixture.width;
            let half_h = base * fixture.height;

            let mut xs: Vec<f32> = fixture.beams.iter().map(|b| b.local_x).collect();
            let mut ys: Vec<f32> = fixture.beams.iter().map(|b| b.local_y).collect();
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
            xs.dedup();
            ys.dedup();

            let min_dist_x = if xs.len() > 1 { xs[1] - xs[0] } else { 1.0 };
            let min_dist_y = if ys.len() > 1 { ys[1] - ys[0] } else { 1.0 };

            let slot_w = (half_w * 2.0) * min_dist_x;
            let slot_h = (half_h * 2.0) * min_dist_y;
            let pixel_r = (f32::min(slot_w, slot_h) / 2.0 * 0.8).max(1.5);

            for beam in &fixture.beams {
                let color = read_color(beam.r_index, beam.g_index, beam.b_index, beam.dimmer_index, dmx_buffer);
                let bx = beam.local_x * half_w * 2.0;
                let by = beam.local_y * half_h * 2.0;
                let mut path = Path::new();
                path.circle(bx, by, pixel_r);
                let paint = Paint::color(color);
                canvas.fill_path(&mut path, &paint);
            }

            // Border ring (rounded rect)
            let ring_color = border_color(fixture.selected);
            let lw = 2.0 / state.scale;
            let mut ring_path = Path::new();
            ring_path.rounded_rect(-half_w, -half_h, half_w * 2.0, half_h * 2.0, 4.0 / state.scale);
            let mut stroke = Paint::color(ring_color);
            stroke.set_line_width(lw);
            canvas.stroke_path(&mut ring_path, &stroke);


        } else {
            // Single head – use beam color if present, else fixture-level fallback
            canvas.save();
            canvas.scale(rx / max_r, ry / max_r);

            let color = if let Some(beam) = fixture.beams.first() {
                read_color(beam.r_index, beam.g_index, beam.b_index, beam.dimmer_index, dmx_buffer)
            } else {
                read_color(fixture.r_index, fixture.g_index, fixture.b_index, fixture.dimmer_index, dmx_buffer)
            };

            let mut path = Path::new();
            path.circle(0.0, 0.0, max_r);
            let paint = Paint::color(color);
            canvas.fill_path(&mut path, &paint);
            canvas.restore();

            // Border ring (circle, no inner scale)
            let ring_color = border_color(fixture.selected);
            let lw = 2.0 / state.scale;
            let mut ring_path = Path::new();
            ring_path.circle(0.0, 0.0, max_r + lw);
            let mut stroke = Paint::color(ring_color);
            stroke.set_line_width(lw);
            canvas.stroke_path(&mut ring_path, &stroke);
        }

        canvas.restore();
    }

    canvas.reset_transform();

    // 3. Marquee Selection (coordinates are world-pixels; convert to screen-pixels)
    if state.is_marquee {
        let to_screen_x = |wx: f32| wx * state.scale + state.cam_x;
        let to_screen_y = |wy: f32| wy * state.scale + state.cam_y;

        let sx = to_screen_x(state.marquee_sx);
        let sy = to_screen_y(state.marquee_sy);
        let ex = to_screen_x(state.marquee_ex);
        let ey = to_screen_y(state.marquee_ey);

        let x = f32::min(sx, ex);
        let y = f32::min(sy, ey);
        let w = (ex - sx).abs();
        let h = (ey - sy).abs();

        let mut path = Path::new();
        path.rect(x, y, w, h);

        canvas.fill_path(&mut path, &Paint::color(Color::rgba(251, 191, 36, 20)));

        let mut stroke_paint = Paint::color(Color::rgba(251, 191, 36, 191));
        stroke_paint.set_line_width(1.0);
        canvas.stroke_path(&mut path, &stroke_paint);
    }

    canvas.flush();
}
