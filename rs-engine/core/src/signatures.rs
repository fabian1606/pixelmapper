// ── Signature mapping ────────────────────────────
//
// Maps signature values (ADR D4, §6.4) onto concrete fixture channels and
// back. Pure functions on normalized values (0–1); the engine decides which
// channels form a target. Channel values here are normalized coarse values
// (byte / 255); output range limits are applied by `remap_range` at the end
// of the frame.

/// Signature of a modifier instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signature {
    Scalar,
    Rgb,
    PanTilt,
}

impl Signature {
    /// Wire id → signature.
    pub fn from_id(id: u8) -> Option<Self> {
        match id {
            0 => Some(Signature::Scalar),
            1 => Some(Signature::Rgb),
            2 => Some(Signature::PanTilt),
            _ => None,
        }
    }

    /// Components per value.
    pub fn arity(self) -> usize {
        match self {
            Signature::Scalar => 1,
            Signature::Rgb => 3,
            Signature::PanTilt => 2,
        }
    }
}

// ── Color systems ────────────────────────────────

/// How a head produces color. Channel order of the value arrays:
/// Rgb [r,g,b], Rgbw [r,g,b,w], Rgba [r,g,b,a], Cmy [c,m,y].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorSystem {
    Rgb,
    Rgbw,
    Rgba,
    Cmy,
}

impl ColorSystem {
    /// Number of channels of the system.
    pub fn channel_count(self) -> usize {
        match self {
            ColorSystem::Rgb | ColorSystem::Cmy => 3,
            ColorSystem::Rgbw | ColorSystem::Rgba => 4,
        }
    }
}

/// Converts an RGB value into channel values of a color system (write path).
///
/// - RGBW: `w = min(r, g, b)`, subtracted from RGB.
/// - RGBA: amber ≈ (1, 0.5, 0); `a = min(r, 2g)`, subtracted as (a, a/2, 0).
///   An approximation: real ambers vary per fixture.
/// - CMY: `1 − rgb`.
pub fn rgb_write(system: ColorSystem, rgb: [f32; 3]) -> [f32; 4] {
    let [r, g, b] = rgb.map(|v| v.clamp(0.0, 1.0));
    match system {
        ColorSystem::Rgb => [r, g, b, 0.0],
        ColorSystem::Rgbw => {
            let w = r.min(g).min(b);
            [r - w, g - w, b - w, w]
        }
        ColorSystem::Rgba => {
            let a = r.min(2.0 * g);
            [r - a, g - a * 0.5, b, a]
        }
        ColorSystem::Cmy => [1.0 - r, 1.0 - g, 1.0 - b, 0.0],
    }
}

/// Converts channel values of a color system back to RGB (read path, inverse
/// of `rgb_write`).
pub fn rgb_read(system: ColorSystem, values: &[f32]) -> [f32; 3] {
    let v = |i: usize| values.get(i).copied().unwrap_or(0.0);
    let rgb = match system {
        ColorSystem::Rgb => [v(0), v(1), v(2)],
        ColorSystem::Rgbw => [v(0) + v(3), v(1) + v(3), v(2) + v(3)],
        ColorSystem::Rgba => [v(0) + v(3), v(1) + v(3) * 0.5, v(2)],
        ColorSystem::Cmy => [1.0 - v(0), 1.0 - v(1), 1.0 - v(2)],
    };
    rgb.map(|c| c.clamp(0.0, 1.0))
}

/// Index of the color-wheel slot perceptually closest to `rgb` ("redmean"
/// weighted distance). Returns `None` for an empty slot list.
pub fn nearest_wheel_slot(rgb: [f32; 3], slots: &[[f32; 3]]) -> Option<usize> {
    let dist = |s: &[f32; 3]| {
        let rm = (rgb[0] + s[0]) * 0.5;
        let dr = rgb[0] - s[0];
        let dg = rgb[1] - s[1];
        let db = rgb[2] - s[2];
        (2.0 + rm) * dr * dr + 4.0 * dg * dg + (3.0 - rm) * db * db
    };
    slots
        .iter()
        .enumerate()
        .min_by(|a, b| dist(a.1).partial_cmp(&dist(b.1)).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(i, _)| i)
}

// ── Resolution / range ───────────────────────────

/// Splits a normalized value into 16-bit coarse/fine bytes.
pub fn to_dmx16(v: f32) -> (u8, u8) {
    let x = (v.clamp(0.0, 1.0) * 65535.0).round() as u32;
    ((x >> 8) as u8, (x & 0xff) as u8)
}

/// Combines 16-bit coarse/fine bytes into a normalized value.
pub fn from_dmx16(coarse: u8, fine: u8) -> f32 {
    ((coarse as u32) << 8 | fine as u32) as f32 / 65535.0
}

/// Remaps a rendered byte value (0–255 float) into a channel's output range
/// `[lo, hi]` (affine, not clipped), as the output stage does.
pub fn remap_range(v: f32, lo: u8, hi: u8) -> f32 {
    let v = v.clamp(0.0, 255.0);
    if lo == 0 && hi == 255 {
        return v;
    }
    (lo as f32 + (v / 255.0) * (hi as f32 - lo as f32)).clamp(0.0, 255.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: [f32; 3], b: [f32; 3]) -> bool {
        a.iter().zip(b.iter()).all(|(x, y)| (x - y).abs() < 1e-6)
    }

    #[test]
    fn rgb_is_identity() {
        assert_eq!(rgb_write(ColorSystem::Rgb, [0.2, 0.4, 0.6]), [0.2, 0.4, 0.6, 0.0]);
        assert!(close(rgb_read(ColorSystem::Rgb, &[0.2, 0.4, 0.6]), [0.2, 0.4, 0.6]));
        // Clamped.
        assert_eq!(rgb_write(ColorSystem::Rgb, [1.5, -0.2, 0.5]), [1.0, 0.0, 0.5, 0.0]);
    }

    #[test]
    fn rgbw_extracts_white() {
        let v = rgb_write(ColorSystem::Rgbw, [0.9, 0.5, 0.3]);
        assert!((v[3] - 0.3).abs() < 1e-6);
        assert!(close([v[0], v[1], v[2]], [0.6, 0.2, 0.0]));
        assert!(close(rgb_read(ColorSystem::Rgbw, &v), [0.9, 0.5, 0.3]));
        // Pure white uses only the white channel.
        assert_eq!(rgb_write(ColorSystem::Rgbw, [1.0, 1.0, 1.0]), [0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn rgba_round_trips() {
        let rgb = [1.0, 0.6, 0.1];
        let v = rgb_write(ColorSystem::Rgba, rgb);
        assert!(v[3] > 0.0);
        assert!(close(rgb_read(ColorSystem::Rgba, &v), rgb));
    }

    #[test]
    fn cmy_is_subtractive() {
        let v = rgb_write(ColorSystem::Cmy, [1.0, 0.0, 0.25]);
        assert!(close([v[0], v[1], v[2]], [0.0, 1.0, 0.75]));
        assert!(close(rgb_read(ColorSystem::Cmy, &[0.0, 1.0, 0.75]), [1.0, 0.0, 0.25]));
    }

    #[test]
    fn color_wheel_picks_nearest_slot() {
        let slots = [[1.0, 1.0, 1.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.8, 0.0]];
        assert_eq!(nearest_wheel_slot([0.9, 0.1, 0.1], &slots), Some(1));
        assert_eq!(nearest_wheel_slot([0.1, 0.2, 0.8], &slots), Some(2));
        assert_eq!(nearest_wheel_slot([1.0, 0.7, 0.1], &slots), Some(3));
        assert_eq!(nearest_wheel_slot([0.95, 0.95, 0.9], &slots), Some(0));
        assert_eq!(nearest_wheel_slot([0.5, 0.5, 0.5], &[]), None);
    }

    #[test]
    fn pan_tilt_16_bit() {
        assert_eq!(to_dmx16(0.0), (0, 0));
        assert_eq!(to_dmx16(1.0), (255, 255));
        assert_eq!(to_dmx16(0.5), (128, 0));
        let (c, f) = to_dmx16(0.123456);
        assert!((from_dmx16(c, f) - 0.123456).abs() < 1.0 / 65535.0);
        // Finer than 8 bit.
        assert_ne!(to_dmx16(0.5001), to_dmx16(0.5));
    }

    #[test]
    fn range_limits_remap() {
        assert_eq!(remap_range(127.0, 0, 255), 127.0);
        assert_eq!(remap_range(0.0, 64, 192), 64.0);
        assert_eq!(remap_range(255.0, 64, 192), 192.0);
        assert!((remap_range(127.5, 64, 192) - 128.0).abs() < 1e-4);
        assert_eq!(remap_range(400.0, 0, 100), 100.0);
    }

    #[test]
    fn signature_ids() {
        assert_eq!(Signature::from_id(1), Some(Signature::Rgb));
        assert_eq!(Signature::from_id(9), None);
        assert_eq!(Signature::PanTilt.arity(), 2);
    }
}
