use std::collections::HashMap;
use femtovg::{Canvas, Color, Paint, Path, renderer::OpenGl};
use crate::types::{FixtureCanvasData, FixtureBeam, StripData};
use crate::svg_render::{SvgCachedFixture, draw_svg_fixture};

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
    pub font_id: Option<femtovg::FontId>,
}

impl Default for RenderState {
    fn default() -> Self {
        Self {
            cam_x: 0.0, cam_y: 0.0, scale: 1.0,
            viewport_w: 800.0, viewport_h: 600.0,
            world_w: 1000.0, world_h: 1000.0,
            is_marquee: false,
            marquee_sx: 0.0, marquee_sy: 0.0, marquee_ex: 0.0, marquee_ey: 0.0,
            font_id: None,
        }
    }
}

fn border_color(selected: bool, remote_color: Option<[u8; 3]>) -> Color {
    if selected {
        Color::rgba(251, 191, 36, 255) // --primary yellow (local selection)
    } else if let Some([r, g, b]) = remote_color {
        Color::rgba(r, g, b, 200) // remote collaborator color
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

/// Cubic Bézier control points (p0, c1, c2, p1).
pub struct CubicBezierSeg {
    pub p0: [f32; 2],
    pub c1: [f32; 2],
    pub c2: [f32; 2],
    pub p1: [f32; 2],
}

/// Converts the strip's control polyline into N-1 Catmull-Rom cubic Bézier segments.
/// Endpoint tangents are mirrored so the curve has no jarring discontinuity at the ends.
pub fn catmull_rom_beziers(points: &[[f32; 2]]) -> Vec<CubicBezierSeg> {
    let n = points.len();
    if n < 2 { return Vec::new(); }
    let mut out = Vec::with_capacity(n - 1);
    for i in 0..n - 1 {
        let p0 = points[i];
        let p1 = points[i + 1];
        let pm1 = if i == 0 {
            [2.0 * p0[0] - p1[0], 2.0 * p0[1] - p1[1]]
        } else {
            points[i - 1]
        };
        let p2 = if i + 2 >= n {
            [2.0 * p1[0] - p0[0], 2.0 * p1[1] - p0[1]]
        } else {
            points[i + 2]
        };
        out.push(CubicBezierSeg {
            p0,
            c1: [p0[0] + (p1[0] - pm1[0]) / 6.0, p0[1] + (p1[1] - pm1[1]) / 6.0],
            c2: [p1[0] - (p2[0] - p0[0]) / 6.0, p1[1] - (p2[1] - p0[1]) / 6.0],
            p1,
        });
    }
    out
}

/// Evaluates a cubic Bézier at parameter t ∈ [0, 1].
fn bezier_point(b: &CubicBezierSeg, t: f32) -> [f32; 2] {
    let u = 1.0 - t;
    let uu = u * u;
    let tt = t * t;
    let w0 = uu * u;
    let w1 = 3.0 * uu * t;
    let w2 = 3.0 * u * tt;
    let w3 = tt * t;
    [
        w0 * b.p0[0] + w1 * b.c1[0] + w2 * b.c2[0] + w3 * b.p1[0],
        w0 * b.p0[1] + w1 * b.c1[1] + w2 * b.c2[1] + w3 * b.p1[1],
    ]
}

pub const BEZIER_SAMPLES_PER_SEG: usize = 24;

/// Samples the Catmull-Rom curve into a dense polyline (used for both stroking
/// and arc-length-aware LED placement). Returns (points, cumulative_arc_length).
pub fn sample_strip_curve(points: &[[f32; 2]]) -> (Vec<[f32; 2]>, Vec<f32>) {
    let beziers = catmull_rom_beziers(points);
    if beziers.is_empty() {
        return (points.to_vec(), vec![0.0]);
    }
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(beziers.len() * BEZIER_SAMPLES_PER_SEG + 1);
    let mut cum: Vec<f32> = Vec::with_capacity(out.capacity());
    out.push(beziers[0].p0);
    cum.push(0.0);
    let mut total = 0.0;
    for b in &beziers {
        let mut prev = *out.last().unwrap();
        for i in 1..=BEZIER_SAMPLES_PER_SEG {
            let t = i as f32 / BEZIER_SAMPLES_PER_SEG as f32;
            let p = bezier_point(b, t);
            total += ((p[0] - prev[0]).powi(2) + (p[1] - prev[1]).powi(2)).sqrt();
            out.push(p);
            cum.push(total);
            prev = p;
        }
    }
    (out, cum)
}

/// Same as `sample_strip_curve` but ALWAYS yields a polyline of exactly
/// `target_length` arc-length, walked from `points[0]` (the star anchor):
///   • polyline geometrically longer  → trimmed to exact target length
///   • polyline geometrically shorter → extended along the last tangent
/// The returned cumulative array's final entry equals `target_length` exactly.
pub fn sample_strip_curve_capped(
    points: &[[f32; 2]],
    target_length: f32,
) -> (Vec<[f32; 2]>, Vec<f32>) {
    let (mut samples, mut cum) = sample_strip_curve(points);
    if target_length <= 0.0 || samples.is_empty() {
        return (samples, cum);
    }
    let total = *cum.last().unwrap_or(&0.0);

    if total > target_length {
        // Find the first sample past target, then interpolate to the exact point.
        let mut cutoff = samples.len();
        for (i, &c) in cum.iter().enumerate() {
            if c >= target_length { cutoff = i; break; }
        }
        if cutoff == 0 {
            // Should be unreachable (cum[0] = 0 < target), but guard anyway.
            return (vec![samples[0]], vec![0.0]);
        }
        if cutoff < samples.len() {
            let prev = samples[cutoff - 1];
            let next = samples[cutoff];
            let s0 = cum[cutoff - 1];
            let s1 = cum[cutoff];
            let t = (target_length - s0) / (s1 - s0).max(0.0001);
            let end = [prev[0] + (next[0] - prev[0]) * t, prev[1] + (next[1] - prev[1]) * t];
            samples.truncate(cutoff);
            cum.truncate(cutoff);
            samples.push(end);
            cum.push(target_length);
        }
    } else if total < target_length && samples.len() >= 2 {
        // Extend along the tangent of the last sampled segment.
        let n = samples.len();
        let p_last = samples[n - 1];
        let p_prev = samples[n - 2];
        let dx = p_last[0] - p_prev[0];
        let dy = p_last[1] - p_prev[1];
        let len = (dx * dx + dy * dy).sqrt().max(0.001);
        let ux = dx / len;
        let uy = dy / len;
        let extra = target_length - total;
        let ext = [p_last[0] + ux * extra, p_last[1] + uy * extra];
        samples.push(ext);
        cum.push(target_length);
    }
    (samples, cum)
}

/// Draws a diamond (rotated square) anchor handle centred at (cx, cy).
/// Visual style mirrors the Vue `SpatialHandle.vue` origin handle:
/// solid primary-yellow fill, dark inner border, faint outer glow.
fn draw_diamond(canvas: &mut Canvas<OpenGl>, cx: f32, cy: f32, half_size: f32, fill: Color, stroke: Color, stroke_w: f32) {
    // Glow — translucent yellow outer stroke at ~2× the handle size.
    let mut glow_path = Path::new();
    let glow = half_size + (stroke_w * 4.0);
    glow_path.move_to(cx, cy - glow);
    glow_path.line_to(cx + glow, cy);
    glow_path.line_to(cx, cy + glow);
    glow_path.line_to(cx - glow, cy);
    glow_path.close();
    let mut glow_paint = Paint::color(Color::rgba(251, 191, 36, 60));
    glow_paint.set_line_width(stroke_w * 3.0);
    canvas.stroke_path(&mut glow_path, &glow_paint);

    // Main diamond shape — vertices at top, right, bottom, left.
    let mut path = Path::new();
    path.move_to(cx, cy - half_size);
    path.line_to(cx + half_size, cy);
    path.line_to(cx, cy + half_size);
    path.line_to(cx - half_size, cy);
    path.close();
    canvas.fill_path(&mut path, &Paint::color(fill));
    let mut sp = Paint::color(stroke);
    sp.set_line_width(stroke_w);
    sp.set_line_join(femtovg::LineJoin::Miter);
    canvas.stroke_path(&mut path, &sp);
}

/// Returns the point on the sampled curve at arc-length `s`.
fn sample_at_arc_length(samples: &[[f32; 2]], cum: &[f32], s: f32) -> [f32; 2] {
    if samples.is_empty() { return [0.0, 0.0]; }
    let total = *cum.last().unwrap_or(&0.0);
    if s <= 0.0 { return samples[0]; }
    if s >= total { return *samples.last().unwrap(); }
    // Binary search for the right interval.
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

/// Renders a NeoPixel LED strip as a Catmull-Rom Bézier curve in
/// WORLD-PIXEL coordinates. Caller must NOT have applied translate/rotate
/// for strip fixtures — the polyline points already encode world placement.
///
///  • smooth substrate stroke (cubic Bézier per segment, no sharp corners)
///  • `ledCount` LED dots distributed by arc length along the whole curve
///  • when `selected` (but not editing): only the selection outline
///  • when `editing`: outline + filled handle at every vertex + a faint "+"
///    handle at every segment midpoint (click to insert a new vertex)
fn draw_strip_fixture(
    canvas: &mut Canvas<OpenGl>,
    fixture: &FixtureCanvasData,
    strip: &StripData,
    dmx_buffer: &[u8],
    scale: f32,
) {
    let points = &strip.points;
    if points.len() < 2 { return; }

    // Capped curve: always exactly `target_length`, trimmed from the non-star
    // end or extended along the last tangent. This is what the strip ACTUALLY
    // looks like (vs. the control polyline which may be longer or shorter).
    let (samples, cum) = sample_strip_curve_capped(points, strip.target_length);
    let total_len = *cum.last().unwrap_or(&0.0);
    if total_len <= 0.0 || samples.len() < 2 { return; }

    // 1. Substrate stroke — render the capped curve as a polyline (the dense
    //    samples are visually indistinguishable from a Bézier stroke at the
    //    sample density we use, and this lets us trim mid-segment cleanly).
    let substrate_w = (5.0 / scale).max(1.5);
    let mut substrate_path = Path::new();
    substrate_path.move_to(samples[0][0], samples[0][1]);
    for i in 1..samples.len() {
        substrate_path.line_to(samples[i][0], samples[i][1]);
    }
    let mut substrate_paint = Paint::color(Color::rgba(40, 40, 40, 220));
    substrate_paint.set_line_width(substrate_w);
    substrate_paint.set_line_cap(femtovg::LineCap::Round);
    substrate_paint.set_line_join(femtovg::LineJoin::Round);
    canvas.stroke_path(&mut substrate_path, &substrate_paint);

    // 2. LED dots distributed by arc length over [0, total_len].
    let led_count = strip.led_count.max(1);
    let group_size = strip.group_size.max(1);
    let beam_count = fixture.beams.len();
    let led_r = (substrate_w * 0.6).max(2.0);

    for led_idx in 0..led_count {
        let pixel_idx = (led_idx / group_size).min(beam_count.saturating_sub(1));
        let beam: Option<&FixtureBeam> = fixture.beams.get(pixel_idx);
        let color = match beam {
            Some(b) => read_color(b.r_index, b.g_index, b.b_index, b.dimmer_index, dmx_buffer),
            None    => read_color(fixture.r_index, fixture.g_index, fixture.b_index, fixture.dimmer_index, dmx_buffer),
        };
        let t = if led_count > 1 {
            0.025 + (led_idx as f32 / (led_count - 1) as f32) * 0.95
        } else {
            0.5
        };
        let pos = sample_at_arc_length(&samples, &cum, t * total_len);
        let mut dot = Path::new();
        dot.circle(pos[0], pos[1], led_r);
        canvas.fill_path(&mut dot, &Paint::color(color));
    }

    // 3. Selection outline (replays the capped curve as a colored stroke).
    if fixture.selected || fixture.remote_selection_color.is_some() {
        let outline_color = border_color(fixture.selected, fixture.remote_selection_color);
        let lw = (2.0 / scale).max(0.5);
        let mut outline = Path::new();
        outline.move_to(samples[0][0], samples[0][1]);
        for i in 1..samples.len() {
            outline.line_to(samples[i][0], samples[i][1]);
        }
        let mut stroke = Paint::color(outline_color);
        stroke.set_line_width(lw);
        stroke.set_line_cap(femtovg::LineCap::Round);
        stroke.set_line_join(femtovg::LineJoin::Round);
        canvas.stroke_path(&mut outline, &stroke);
    }

    // 4. Editing handles — only when explicitly in edit mode.
    if fixture.editing {
        let handle_r = 6.0 / scale;
        let handle_stroke_w = 1.5 / scale;
        let handle_fill = Color::rgba(20, 20, 20, 255);
        let handle_outline_color = Color::rgba(251, 191, 36, 255);
        let mut handle_outline = Paint::color(handle_outline_color);
        handle_outline.set_line_width(handle_stroke_w);

        // Vertex 0 = ANCHOR diamond (matches the modifier origin handle's look).
        // Other vertices = circle handles. The focused vertex gets a brighter
        // ring so the user knows which one Delete will remove.
        let focused = strip.selected_vertex_idx;
        for (idx, p) in points.iter().enumerate() {
            // Focus halo behind the handle.
            if (idx as i32) == focused {
                let halo_r = handle_r * 1.9;
                let mut halo = Path::new();
                halo.circle(p[0], p[1], halo_r);
                let mut halo_paint = Paint::color(Color::rgba(251, 191, 36, 90));
                halo_paint.set_line_width((2.5 / scale).max(1.0));
                canvas.stroke_path(&mut halo, &halo_paint);
            }

            if idx == 0 {
                let half = handle_r * 1.2;
                let dark_border = Color::rgba(0, 0, 0, 128);
                draw_diamond(canvas, p[0], p[1], half, handle_outline_color, dark_border, handle_stroke_w);
            } else {
                let mut h = Path::new();
                h.circle(p[0], p[1], handle_r);
                canvas.fill_path(&mut h, &Paint::color(handle_fill));
                canvas.stroke_path(&mut h, &handle_outline);
            }
        }

        // Mid-handles between CONTROL vertices (not on the capped curve).
        // Use the bezier-segment arc-length midpoints from the FULL curve so
        // the handles stay on the visible Catmull-Rom curve geometry.
        let (full_samples, full_cum) = sample_strip_curve(points);
        let mid_r = 4.5 / scale;
        let mid_fill = Paint::color(Color::rgba(251, 191, 36, 150));
        let plus_arm = mid_r * 0.5;
        let plus_w = 1.2 / scale;
        let mut plus_paint = Paint::color(handle_fill);
        plus_paint.set_line_width(plus_w);

        for i in 0..points.len() - 1 {
            let seg_start = full_cum[i * BEZIER_SAMPLES_PER_SEG];
            let seg_end = full_cum[(i + 1) * BEZIER_SAMPLES_PER_SEG];
            let mid_s = (seg_start + seg_end) * 0.5;
            let mid_pos = sample_at_arc_length(&full_samples, &full_cum, mid_s);

            let mut h = Path::new();
            h.circle(mid_pos[0], mid_pos[1], mid_r);
            canvas.fill_path(&mut h, &mid_fill);

            let mut plus_path = Path::new();
            plus_path.move_to(mid_pos[0] - plus_arm, mid_pos[1]);
            plus_path.line_to(mid_pos[0] + plus_arm, mid_pos[1]);
            plus_path.move_to(mid_pos[0], mid_pos[1] - plus_arm);
            plus_path.line_to(mid_pos[0], mid_pos[1] + plus_arm);
            canvas.stroke_path(&mut plus_path, &plus_paint);
        }
    }
}

pub fn draw_frame(canvas: &mut Canvas<OpenGl>, state: &RenderState, fixtures: &[FixtureCanvasData], svg_cache: &HashMap<String, SvgCachedFixture>, dmx_buffer: &[u8]) {
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

        if let Some(strip) = &fixture.strip {
            // Strip points are already in world-pixel space — don't transform.
            draw_strip_fixture(canvas, fixture, strip, dmx_buffer, state.scale);
            canvas.restore();
            continue;
        }

        canvas.translate(wx, wy);
        canvas.rotate(fixture.rotation.to_radians());

        if fixture.svg.is_some() {
            let base = 18.0;
            let half_w = base * fixture.width;
            let half_h = base * fixture.height;

            if let Some(cached) = svg_cache.get(&fixture.id) {
                draw_svg_fixture(canvas, cached, fixture, dmx_buffer, half_w, half_h, state.scale);
            }

            // Selection ring on top
            if fixture.selected {
                let lw = 2.0 / state.scale;
                let mut ring_path = Path::new();
                if fixture.beams.len() > 1 {
                    ring_path.rounded_rect(-half_w, -half_h, half_w * 2.0, half_h * 2.0, 4.0 / state.scale);
                } else {
                    ring_path.circle(0.0, 0.0, max_r + lw);
                }
                let mut stroke = Paint::color(border_color(true, None));
                stroke.set_line_width(lw);
                canvas.stroke_path(&mut ring_path, &stroke);
            }
        } else if fixture.beams.len() > 1 {
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
            let ring_color = border_color(fixture.selected, fixture.remote_selection_color);
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
            let ring_color = border_color(fixture.selected, fixture.remote_selection_color);
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

    // 2.b Text Label Overlay (crisp screen-space rendering)
    if state.scale >= 1.5 {
        if let Some(font_id) = state.font_id {
            let mut paint = Paint::color(Color::rgba(230, 230, 230, 220));
            paint.set_font(&[font_id]);
            paint.set_text_align(femtovg::Align::Center);
            paint.set_text_baseline(femtovg::Baseline::Middle);
            paint.set_font_size(13.0); // Exactly 13px on screen!

            for fixture in fixtures {
                let wx = fixture.world_x * state.world_w;
                let wy = fixture.world_y * state.world_h;
                let rx = fixture.width * 16.0;
                let ry = fixture.height * 16.0;
                let max_r = f32::max(rx, ry);

                // Calculate screen position
                let screen_x = wx * state.scale + state.cam_x;
                let screen_y = wy * state.scale + state.cam_y + (max_r * state.scale) + 18.0; // Pushed even further down

                // Frustum Culling
                if screen_x + 50.0 < 0.0 || screen_x - 50.0 > state.viewport_w ||
                   screen_y + 30.0 < 0.0 || screen_y - 30.0 > state.viewport_h {
                    continue;
                }

                if let Ok(metrics) = canvas.measure_text(screen_x, screen_y, &fixture.name, &paint) {
                    let half_w = metrics.width() / 2.0;
                    let pad_x = 5.0;
                    let pad_y = 3.5;
                    
                    let mut bg = Path::new();
                    bg.rounded_rect(
                        screen_x - half_w - pad_x,
                        screen_y - 6.5 - pad_y,
                        metrics.width() + pad_x * 2.0,
                        13.0 + pad_y * 2.0,
                        4.0,
                    );
                    canvas.fill_path(&mut bg, &Paint::color(Color::rgba(16, 16, 16, 210)));
                    
                    let mut border = Paint::color(Color::rgba(255, 255, 255, 35));
                    border.set_line_width(1.0);
                    canvas.stroke_path(&mut bg, &border);
                }
                let _ = canvas.fill_text(screen_x, screen_y, &fixture.name, &paint);
            }
        }
    }

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
