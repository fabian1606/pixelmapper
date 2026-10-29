// ── Room (ABI v1.3) ──────────────────────────────
//
// The "room" of a layout is the axis-aligned bounding box of every channel
// position (x/y in normalized world units, the same unit on both axes:
// fraction of the square stage). Plugins get it as `Frame.worldAspect` /
// `Frame.worldDepth` plus per-sample room coordinates `Sample.u` / `Sample.v`
// (0–1 across the box), so room-relative effects ("from the four corners")
// work no matter where the rig sits on the stage.

/// Extents below this count as degenerate (single row / single fixture).
const EPS: f32 = 1e-4;

/// Room bounds derived from the layout.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Room {
    pub min_x: f32,
    pub min_y: f32,
    /// Effective width (x extent) in world units, > 0.
    pub width: f32,
    /// Effective depth (y extent) in world units, > 0.
    pub depth: f32,
    /// Meters per normalized world unit (from the layout packet, v3).
    pub meters_per_unit: f32,
}

impl Default for Room {
    fn default() -> Self {
        Self { min_x: 0.0, min_y: 0.0, width: 1.0, depth: 1.0, meters_per_unit: 0.0 }
    }
}

impl Room {
    /// Bounding box of `points` (x, y). A degenerate axis borrows the other
    /// axis' extent (aspect 1 on that side); both degenerate → 1 world unit.
    pub fn from_points(points: impl Iterator<Item = (f32, f32)>, meters_per_unit: f32) -> Self {
        let (mut x0, mut y0, mut x1, mut y1) = (f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
        for (x, y) in points {
            if !x.is_finite() || !y.is_finite() { continue; }
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        if !x0.is_finite() {
            return Self { meters_per_unit, ..Self::default() };
        }
        let (w, d) = (x1 - x0, y1 - y0);
        let (width, depth) = match (w > EPS, d > EPS) {
            (true, true) => (w, d),
            (true, false) => (w, w),
            (false, true) => (d, d),
            (false, false) => (1.0, 1.0),
        };
        // Center a degenerate axis so its single coordinate maps to 0.5.
        let min_x = if w > EPS { x0 } else { x0 - width * 0.5 };
        let min_y = if d > EPS { y0 } else { y0 - depth * 0.5 };
        Self { min_x, min_y, width, depth, meters_per_unit }
    }

    /// Width / depth: multiply a `u` difference by this to compare it with a `v` difference.
    pub fn aspect(&self) -> f32 {
        self.width / self.depth
    }

    /// Room coordinates (u, v) of a world position, 0–1 inside the box.
    pub fn uv(&self, x: f32, y: f32) -> (f32, f32) {
        ((x - self.min_x) / self.width, (y - self.min_y) / self.depth)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_and_uv() {
        let r = Room::from_points([(0.2, 0.4), (0.6, 0.5)].into_iter(), 12.0);
        assert!((r.aspect() - 4.0).abs() < 1e-5);
        let (u, v) = r.uv(0.6, 0.4);
        assert!((u - 1.0).abs() < 1e-5 && v.abs() < 1e-5);
        assert_eq!(r.meters_per_unit, 12.0);
    }

    #[test]
    fn degenerate_axes() {
        // One row: depth borrows the width, v centered at 0.5.
        let r = Room::from_points([(0.0, 0.5), (0.5, 0.5)].into_iter(), 0.0);
        assert_eq!(r.aspect(), 1.0);
        assert!((r.uv(0.25, 0.5).1 - 0.5).abs() < 1e-6);
        // One fixture: unit box centered on it.
        let r = Room::from_points([(0.3, 0.3)].into_iter(), 0.0);
        assert_eq!((r.width, r.depth), (1.0, 1.0));
        assert!((r.uv(0.3, 0.3).0 - 0.5).abs() < 1e-6);
        // Empty layout: default.
        assert_eq!(Room::from_points(std::iter::empty(), 0.0), Room::default());
    }
}
