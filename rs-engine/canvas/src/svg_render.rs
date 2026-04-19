use std::collections::HashMap;
use femtovg::{Canvas, Color, Paint, Path, renderer::OpenGl};
use usvg::{Node, Tree};

use crate::types::{FixtureBeam, FixtureCanvasData};

pub struct SvgCachedFixture {
    pub tree: Tree,
    /// element id → index into FixtureCanvasData.beams
    pub element_to_beam: HashMap<String, usize>,
}

pub fn parse_svg(svg_data: &str, beams: &[FixtureBeam]) -> Option<SvgCachedFixture> {
    let opt = usvg::Options::default();
    let tree = Tree::from_str(svg_data, &opt).ok()?;

    let mut element_to_beam = HashMap::new();
    for (beam_idx, beam) in beams.iter().enumerate() {
        if let Some(eid) = &beam.svg_element_id {
            if !eid.is_empty() {
                element_to_beam.insert(eid.clone(), beam_idx);
            }
        }
    }

    Some(SvgCachedFixture { tree, element_to_beam })
}

fn beam_color(beam: &FixtureBeam, dmx: &[u8]) -> Color {
    let get = |i: Option<usize>| i.and_then(|idx| dmx.get(idx)).copied().unwrap_or(0);
    let dim = beam.dimmer_index.and_then(|i| dmx.get(i)).copied().unwrap_or(255);
    Color::rgba(
        ((get(beam.r_index) as u16 * dim as u16) / 255) as u8,
        ((get(beam.g_index) as u16 * dim as u16) / 255) as u8,
        ((get(beam.b_index) as u16 * dim as u16) / 255) as u8,
        255,
    )
}

fn usvg_color_to_femto(paint: &usvg::Paint, opacity: f32) -> Option<Color> {
    if let usvg::Paint::Color(c) = paint {
        let alpha = (opacity * 255.0) as u8;
        Some(Color::rgba(c.red, c.green, c.blue, alpha))
    } else {
        None
    }
}

fn build_femto_path(data: &usvg::tiny_skia_path::Path) -> Path {
    let mut path = Path::new();
    for segment in data.segments() {
        match segment {
            usvg::tiny_skia_path::PathSegment::MoveTo(p) => {
                path.move_to(p.x, p.y);
            }
            usvg::tiny_skia_path::PathSegment::LineTo(p) => {
                path.line_to(p.x, p.y);
            }
            usvg::tiny_skia_path::PathSegment::CubicTo(c1, c2, p) => {
                path.bezier_to(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
            }
            usvg::tiny_skia_path::PathSegment::QuadTo(c, p) => {
                // Approximate quadratic bezier as cubic
                path.quad_to(c.x, c.y, p.x, p.y);
            }
            usvg::tiny_skia_path::PathSegment::Close => {
                path.close();
            }
        }
    }
    path
}

fn draw_node(
    canvas: &mut Canvas<OpenGl>,
    node: &Node,
    cached: &SvgCachedFixture,
    fixture: &FixtureCanvasData,
    dmx: &[u8],
    scale: f32,
    parent_transform: usvg::Transform,
) {
    match node {
        Node::Group(g) => {
            let combined = parent_transform.pre_concat(g.transform());
            for child in g.children() {
                draw_node(canvas, child, cached, fixture, dmx, scale, combined);
            }
        }
        Node::Path(p) => {
            let combined = parent_transform.pre_concat(p.abs_transform());
            let data = match p.data().clone().transform(combined) {
                Some(d) => d,
                None => return,
            };
            let mut fem_path = build_femto_path(&data);

            // Resolve element ID from usvg node id
            let element_id = p.id();
            let mapped_beam = if !element_id.is_empty() {
                cached.element_to_beam.get(element_id)
                    .and_then(|&idx| fixture.beams.get(idx))
            } else {
                None
            };

            // Fill
            if let Some(fill) = p.fill() {
                let color = if let Some(beam) = mapped_beam {
                    beam_color(beam, dmx)
                } else if let Some(c) = usvg_color_to_femto(fill.paint(), fill.opacity().get()) {
                    c
                } else {
                    Color::rgba(80, 80, 80, 255)
                };
                canvas.fill_path(&mut fem_path, &Paint::color(color));
            } else if mapped_beam.is_some() {
                // No fill defined but beam is mapped — render DMX color anyway
                let beam = mapped_beam.unwrap();
                let color = beam_color(beam, dmx);
                canvas.fill_path(&mut fem_path, &Paint::color(color));
            }

            // Stroke — thin white so shapes are visible against dark canvas
            let stroke_color = Color::rgba(255, 255, 255, 56); // ~0.22 alpha
            let mut stroke_paint = Paint::color(stroke_color);
            // non-scaling-stroke: keep stroke 1px independent of zoom
            stroke_paint.set_line_width(1.0 / scale);
            canvas.stroke_path(&mut fem_path, &stroke_paint);
        }
        _ => {}
    }
}

pub fn draw_svg_fixture(
    canvas: &mut Canvas<OpenGl>,
    cached: &SvgCachedFixture,
    fixture: &FixtureCanvasData,
    dmx: &[u8],
    half_w: f32,
    half_h: f32,
    scale: f32,
) {
    let vb = cached.tree.view_box();
    let vb_w = vb.rect.width();
    let vb_h = vb.rect.height();

    if vb_w <= 0.0 || vb_h <= 0.0 {
        return;
    }

    // Scale so the SVG viewBox fills [−half_w … +half_w] × [−half_h … +half_h]
    let sx = (half_w * 2.0) / vb_w;
    let sy = (half_h * 2.0) / vb_h;

    canvas.save();
    // Translate so that (vb.x, vb.y) maps to (−half_w, −half_h)
    canvas.translate(-half_w - vb.rect.x() * sx, -half_h - vb.rect.y() * sy);
    canvas.scale(sx, sy);

    let identity = usvg::Transform::identity();
    for child in cached.tree.root().children() {
        draw_node(canvas, child, cached, fixture, dmx, scale, identity);
    }

    canvas.restore();
}
