use std::collections::HashMap;
use femtovg::{Canvas, Color, Paint, Path, renderer::OpenGl};
use crate::types::{BodyPrimitive, ColorChannel, LutChannel, ShutterChannel, FixtureCanvasData, FixtureBeam};
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

/// Borrowed view over the photometry-relevant channels of a beam or fixture.
/// Mirrors the canonical formula in app/utils/engine/core/photometry.ts:
///   rgb  = Σ colorAdd·(dmx/255) + Σ colorLut[dmx]     (no color source → white)
///   gate = Π shutterGate(freqLut[dmx], tSec)
///   out  = rgb × Π(dimmer/255) × gate
pub struct PhotoRefs<'a> {
    pub color_channels: &'a [ColorChannel],
    pub color_luts: &'a [LutChannel],
    pub shutter_channels: &'a [ShutterChannel],
    pub dimmer_indices: &'a [usize],
    pub legacy_dimmer: Option<usize>,
}

impl<'a> PhotoRefs<'a> {
    pub fn from_beam(b: &'a FixtureBeam) -> Self {
        Self {
            color_channels: &b.color_channels,
            color_luts: &b.color_luts,
            shutter_channels: &b.shutter_channels,
            dimmer_indices: &b.dimmer_indices,
            legacy_dimmer: b.dimmer_index,
        }
    }

    pub fn from_fixture(f: &'a FixtureCanvasData) -> Self {
        Self {
            color_channels: &f.color_channels,
            color_luts: &f.color_luts,
            shutter_channels: &f.shutter_channels,
            dimmer_indices: &f.dimmer_indices,
            legacy_dimmer: f.dimmer_index,
        }
    }
}

/// Gate factor of one shutter LUT entry: -1 = closed, 0 = open, >0 = strobe Hz.
fn shutter_gate(freq: f32, t_sec: f64) -> f32 {
    if freq < 0.0 { return 0.0; }
    if freq == 0.0 { return 1.0; }
    let phase = t_sec * freq as f64;
    if phase - phase.floor() < 0.5 { 1.0 } else { 0.0 }
}

pub fn resolve_color(p: &PhotoRefs, buf: &[u8], t_sec: f64) -> Color {
    let (mut r, mut g, mut b) = (0.0f32, 0.0f32, 0.0f32);

    for ch in p.color_channels {
        let factor = buf.get(ch.index).copied().unwrap_or(0) as f32 / 255.0;
        r += ch.r as f32 * factor;
        g += ch.g as f32 * factor;
        b += ch.b as f32 * factor;
    }
    for ch in p.color_luts {
        let v = buf.get(ch.index).copied().unwrap_or(0) as usize * 3;
        r += ch.lut.get(v).copied().unwrap_or(255) as f32;
        g += ch.lut.get(v + 1).copied().unwrap_or(255) as f32;
        b += ch.lut.get(v + 2).copied().unwrap_or(255) as f32;
    }

    // No color source at all (e.g. dimmer-only fixture): white so it stays visible.
    if p.color_channels.is_empty() && p.color_luts.is_empty() {
        r = 255.0; g = 255.0; b = 255.0;
    }

    let mut factor = 1.0f32;
    if p.dimmer_indices.is_empty() {
        factor *= p.legacy_dimmer.and_then(|idx| buf.get(idx)).copied().unwrap_or(255) as f32 / 255.0;
    } else {
        for &idx in p.dimmer_indices {
            factor *= buf.get(idx).copied().unwrap_or(0) as f32 / 255.0;
        }
    }
    for sh in p.shutter_channels {
        let dmx = buf.get(sh.index).copied().unwrap_or(0) as usize;
        factor *= shutter_gate(sh.freq.get(dmx).copied().unwrap_or(0.0), t_sec);
    }

    let clamp = |v: f32| (v * factor).round().clamp(0.0, 255.0) as u8;
    Color::rgba(clamp(r), clamp(g), clamp(b), 255)
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

// ── Fixture-kind drawing (ADR §5.6) ─────────────────────────────────────────

/// RGBA bytes → femtovg color.
fn rgba(c: [u8; 4]) -> Color {
    Color::rgba(c[0], c[1], c[2], c[3])
}

/// Builds the path of a body primitive.
fn primitive_path(p: &BodyPrimitive) -> Path {
    let mut path = Path::new();
    match p {
        BodyPrimitive::Polyline { points, closed, .. } => {
            if let Some(first) = points.first() {
                path.move_to(first[0], first[1]);
                for q in &points[1..] { path.line_to(q[0], q[1]); }
                if *closed { path.close(); }
            }
        }
        BodyPrimitive::Polygon { points, .. } => {
            if let Some(first) = points.first() {
                path.move_to(first[0], first[1]);
                for q in &points[1..] { path.line_to(q[0], q[1]); }
                path.close();
            }
        }
        BodyPrimitive::Circle { center, radius, .. } => path.circle(center[0], center[1], *radius),
        BodyPrimitive::Rect { rect, radius, .. } => {
            if *radius > 0.0 { path.rounded_rect(rect[0], rect[1], rect[2], rect[3], *radius); }
            else { path.rect(rect[0], rect[1], rect[2], rect[3]); }
        }
    }
    path
}

/// Draws a fixture-kind fixture in WORLD pixels (no fixture transform):
///  • body primitives with their styles (polyline default: dark substrate)
///  • beam emitters as dots in the beam's resolved color
///  • selection outline along the body (or the AABB without a body)
///  • active handles (anchors when selected, all in edit mode)
fn draw_kind_fixture(
    canvas: &mut Canvas<OpenGl>,
    fixture: &FixtureCanvasData,
    state: &RenderState,
    dmx_buffer: &[u8],
    t_sec: f64,
) {
    let scale = state.scale;

    // 1. Body.
    for p in &fixture.body {
        let mut path = primitive_path(p);
        match p {
            BodyPrimitive::Polyline { width, style, .. } => {
                let mut paint = Paint::color(style.stroke.map(rgba).unwrap_or(Color::rgba(40, 40, 40, 220)));
                paint.set_line_width(width.max(1.5 / scale));
                paint.set_line_cap(femtovg::LineCap::Round);
                paint.set_line_join(femtovg::LineJoin::Round);
                canvas.stroke_path(&mut path, &paint);
            }
            BodyPrimitive::Polygon { style, .. } | BodyPrimitive::Circle { style, .. } | BodyPrimitive::Rect { style, .. } => {
                if let Some(fill) = style.fill { canvas.fill_path(&mut path, &Paint::color(rgba(fill))); }
                if let Some(stroke) = style.stroke {
                    let mut paint = Paint::color(rgba(stroke));
                    paint.set_line_width(1.5 / scale);
                    canvas.stroke_path(&mut path, &paint);
                }
            }
        }
    }

    // 2. Emitters (beams without emitters are drawn at their local position).
    for beam in &fixture.beams {
        let color = resolve_color(&PhotoRefs::from_beam(beam), dmx_buffer, t_sec);
        let r = if beam.emitter_radius > 0.0 { beam.emitter_radius } else { 4.0 };
        let mut dots = Path::new();
        for e in &beam.emitters { dots.circle(e[0], e[1], r); }
        canvas.fill_path(&mut dots, &Paint::color(color));
    }

    // 3. Selection outline.
    if fixture.selected || fixture.remote_selection_color.is_some() {
        let mut stroke = Paint::color(border_color(fixture.selected, fixture.remote_selection_color));
        stroke.set_line_width((2.0 / scale).max(0.5));
        stroke.set_line_cap(femtovg::LineCap::Round);
        stroke.set_line_join(femtovg::LineJoin::Round);
        if fixture.body.is_empty() {
            let hw = fixture.width * 18.0;
            let hh = fixture.height * 18.0;
            let mut path = Path::new();
            path.rounded_rect(fixture.world_x * state.world_w - hw, fixture.world_y * state.world_h - hh, hw * 2.0, hh * 2.0, 4.0 / scale);
            canvas.stroke_path(&mut path, &stroke);
        } else {
            for p in &fixture.body {
                let mut path = primitive_path(p);
                canvas.stroke_path(&mut path, &stroke);
            }
        }
    }

    // 4. Handles.
    let handle_r = 6.0 / scale;
    let stroke_w = 1.5 / scale;
    let accent = Color::rgba(251, 191, 36, 255);
    let dark = Color::rgba(20, 20, 20, 255);
    let mut outline = Paint::color(accent);
    outline.set_line_width(stroke_w);
    for h in fixture.handles.iter().filter(|h| h.active(fixture.selected, fixture.edit_mode)) {
        if fixture.focused_handle.as_deref() == Some(h.id.as_str()) {
            let mut halo = Path::new();
            halo.circle(h.x, h.y, handle_r * 1.9);
            let mut halo_paint = Paint::color(Color::rgba(251, 191, 36, 90));
            halo_paint.set_line_width((2.5 / scale).max(1.0));
            canvas.stroke_path(&mut halo, &halo_paint);
        }
        match h.role.as_str() {
            "anchor" => draw_diamond(canvas, h.x, h.y, handle_r * 1.2, accent, Color::rgba(0, 0, 0, 128), stroke_w),
            "midpoint" => {
                let mid_r = 4.5 / scale;
                let mut dot = Path::new();
                dot.circle(h.x, h.y, mid_r);
                canvas.fill_path(&mut dot, &Paint::color(Color::rgba(251, 191, 36, 150)));
                let arm = mid_r * 0.5;
                let mut plus = Path::new();
                plus.move_to(h.x - arm, h.y);
                plus.line_to(h.x + arm, h.y);
                plus.move_to(h.x, h.y - arm);
                plus.line_to(h.x, h.y + arm);
                let mut plus_paint = Paint::color(dark);
                plus_paint.set_line_width(1.2 / scale);
                canvas.stroke_path(&mut plus, &plus_paint);
            }
            _ => {
                let mut c = Path::new();
                c.circle(h.x, h.y, handle_r);
                canvas.fill_path(&mut c, &Paint::color(dark));
                canvas.stroke_path(&mut c, &outline);
            }
        }
    }
}

// ── Label placement ─────────────────────────────────────────────────────────

/// Returns the label anchor in WORLD pixels: (center x, lower edge y) of the
/// shape actually drawn for the fixture, so the label sits right below it
/// regardless of shape, aspect ratio or rotation.
fn label_anchor_world(fixture: &FixtureCanvasData, state: &RenderState) -> (f32, f32) {
    let wx = fixture.world_x * state.world_w;
    let wy = fixture.world_y * state.world_h;

    if fixture.is_kind() {
        // Kind geometry is already in world pixels → use its bounding box.
        let (mut min_x, mut max_x, mut max_y) = (f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
        let mut add = |x: f32, y: f32| {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        };
        for p in &fixture.body {
            match p {
                BodyPrimitive::Polyline { points, width, .. } => {
                    for q in points { add(q[0], q[1] + width / 2.0); }
                }
                BodyPrimitive::Polygon { points, .. } => {
                    for q in points { add(q[0], q[1]); }
                }
                BodyPrimitive::Circle { center, radius, .. } => {
                    add(center[0] - radius, center[1] + radius);
                    add(center[0] + radius, center[1] + radius);
                }
                BodyPrimitive::Rect { rect, .. } => {
                    add(rect[0], rect[1] + rect[3]);
                    add(rect[0] + rect[2], rect[1] + rect[3]);
                }
            }
        }
        for beam in &fixture.beams {
            let r = if beam.emitter_radius > 0.0 { beam.emitter_radius } else { 4.0 };
            for e in &beam.emitters { add(e[0], e[1] + r); }
        }
        if max_y.is_finite() {
            return ((min_x + max_x) / 2.0, max_y);
        }
        // No geometry at all → AABB outline used for the selection ring.
        return (wx, wy + fixture.height * 18.0);
    }

    let (sin, cos) = fixture.rotation.to_radians().sin_cos();
    let half_extent_y = if fixture.svg.is_some() || fixture.beams.len() > 1 {
        // Rotated rectangle (half sizes 18·w / 18·h).
        let (hw, hh) = (18.0 * fixture.width, 18.0 * fixture.height);
        (hw * sin).abs() + (hh * cos).abs()
    } else {
        // Rotated ellipse (radii 16·w / 16·h).
        let (rx, ry) = (16.0 * fixture.width, 16.0 * fixture.height);
        ((rx * sin).powi(2) + (ry * cos).powi(2)).sqrt()
    };
    (wx, wy + half_extent_y)
}

pub fn draw_frame(canvas: &mut Canvas<OpenGl>, state: &RenderState, fixtures: &[FixtureCanvasData], svg_cache: &HashMap<String, SvgCachedFixture>, dmx_buffer: &[u8], t_sec: f64) {
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

        if fixture.is_kind() {
            // Kind geometry is already in world-pixel space — don't transform.
            draw_kind_fixture(canvas, fixture, state, dmx_buffer, t_sec);
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
                draw_svg_fixture(canvas, cached, fixture, dmx_buffer, half_w, half_h, state.scale, t_sec);
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
                let color = resolve_color(&PhotoRefs::from_beam(beam), dmx_buffer, t_sec);
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
                resolve_color(&PhotoRefs::from_beam(beam), dmx_buffer, t_sec)
            } else {
                resolve_color(&PhotoRefs::from_fixture(fixture), dmx_buffer, t_sec)
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
                // Anchor below the drawn shape; 14px = half label box (10) + 4px gap.
                let (ax, ay) = label_anchor_world(fixture, state);
                let screen_x = ax * state.scale + state.cam_x;
                let screen_y = ay * state.scale + state.cam_y + 14.0;

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
