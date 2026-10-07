// ── Legacy golden generator ────────────────────────────
//
// TEMPORARY (plan P3.3 → removed with the old effects in P3.8).
//
// Renders the pre-plugin effect implementations for a fixed grid of inputs
// and writes `plugins/<name>/goldens.json`. The AssemblyScript built-ins are
// tested against these files (plugins/goldens.test.ts) so they keep the look
// of the former Rust effects.
//
// Run: `cargo test -p rs-engine-core generate_goldens -- --ignored`

use crate::effects::{create_effect, evaluate_phase};
use crate::engine::{hsl_to_rgb, rgb_to_hsl};
use crate::types::*;
use serde_json::{json, Value};
use std::f32::consts::TAU;

// ── Helpers ─────────────────────────────────────────

/// A neutral effect config; callers fill the type-specific parts.
fn base_config() -> EffectConfig {
    EffectConfig {
        target_channels: vec![],
        target_group_indices: None,
        direction: EffectDirection::None,
        origin_x: 0.5,
        origin_y: 0.5,
        angle: 0.0,
        strength: 255.0,
        reverse: false,
        fanning: 0.0,
        speed: SpeedConfig { mode: SpeedMode::Time, time_ms: 500.0, beat_value: 1.0, beat_offset: 0.0 },
        waveform_shape: WaveformShape::Sine,
        waveform_params: WaveformShapeParams::default(),
        noise_params: None,
        sequencer_params: None,
        color_params: None,
        displacement_params: None,
        speed_curve_params: None,
        effect_type: String::new(),
    }
}

/// Shape enum ↔ plugin option names.
const SHAPES: [(WaveformShape, &str); 7] = [
    (WaveformShape::Sine, "sine"),
    (WaveformShape::Square, "square"),
    (WaveformShape::Triangle, "triangle"),
    (WaveformShape::Sawtooth, "sawtooth"),
    (WaveformShape::Bounce, "bounce"),
    (WaveformShape::Ramp, "ramp"),
    (WaveformShape::Smooth, "smooth"),
];

/// FNV-1a of a channel type name (the former per-channel seed).
fn channel_seed(name: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in name.as_bytes() {
        h = (h ^ (*b as u32)).wrapping_mul(0x01000193);
    }
    h
}

/// Frame context JSON.
fn ctx(time_ms: f32, phase_speed: f32, strength: f32) -> Value {
    json!({ "timeMs": time_ms, "beatTime": time_ms * 120.0 / 60000.0, "bpm": 120.0, "phaseSpeed": phase_speed, "strength": strength })
}

/// Writes a goldens file next to the plugin sources.
fn write(name: &str, cases: Vec<Value>) {
    let dir = format!("{}/../../plugins/{}", env!("CARGO_MANIFEST_DIR"), name);
    std::fs::create_dir_all(&dir).unwrap();
    let doc = json!({
        "plugin": name,
        "source": "rs-engine/core/src/legacy_goldens.rs (pre-plugin Rust effects)",
        "cases": cases,
    });
    std::fs::write(format!("{}/goldens.json", dir), serde_json::to_string(&doc).unwrap()).unwrap();
}

// ── Waveform ────────────────────────────────────────

fn waveform_cases() -> Vec<Value> {
    let mut cases = Vec::new();
    // Offset by 0.013 so no sample sits exactly on a window/duty boundary (the old
    // radian round-trip moved such points by one f32 ulp).
    let phases: Vec<f32> = (0..20).map(|i| i as f32 / 20.0 + 0.013).chain([1.37, -0.4, 2.999]).collect();
    for (shape, shape_name) in SHAPES {
        for param in [0.1f32, 0.5, 0.9] {
            for (start, end) in [(0.0f32, 1.0f32), (0.2, 0.7)] {
                for offset in [0.0f32, 0.3, -0.5] {
                    let mut cfg = base_config();
                    cfg.waveform_shape = shape;
                    cfg.waveform_params = WaveformShapeParams { param, start, end, offset, floor: -1.0 };
                    let samples: Vec<Value> = phases.iter().map(|p| json!({ "x": 0.3, "y": 0.6, "phase": p, "base": [0.8] })).collect();
                    let expected: Vec<Value> = phases.iter().map(|p| json!([evaluate_phase(&cfg, p * TAU)])).collect();
                    cases.push(json!({
                        "params": { "shape": shape_name, "param": param, "start": start, "end": end, "offset": offset, "useFloor": false, "floor": 0.0 },
                        "ctx": ctx(0.0, 2.0, 1.0),
                        "samples": samples,
                        "expected": expected,
                        "compare": "raw",
                    }));
                }
            }
        }
    }
    // Floor: inactive zones map to base × floor (engine-side in the old code).
    for floor in [0.0f32, 0.3] {
        for strength in [1.0f32, 0.6] {
            let base = 0.8f32;
            let inactive = [0.05f32, 0.1, 0.8, 0.95];
            let samples: Vec<Value> = inactive.iter().map(|p| json!({ "x": 0.5, "y": 0.5, "phase": p, "base": [base] })).collect();
            let expected: Vec<Value> = inactive.iter().map(|_| json!([base * floor])).collect();
            cases.push(json!({
                "params": { "shape": "sine", "param": 0.5, "start": 0.2, "end": 0.7, "offset": 0.0, "useFloor": true, "floor": floor },
                "ctx": ctx(0.0, 2.0, strength),
                "samples": samples,
                "expected": expected,
                "compare": "mapped",
            }));
        }
    }
    cases
}

// ── Noise ───────────────────────────────────────────

fn noise_cases() -> Vec<Value> {
    let mut cases = Vec::new();
    let positions = [(0.1f32, 0.2f32), (0.5, 0.5), (0.73, 0.31), (0.9, 0.95), (0.25, 0.8), (0.6, 0.05)];
    let channels = ["RED", "DIMMER"];
    for (noise_type, type_name) in [(NoiseType::White, "white"), (NoiseType::Perlin, "perlin"), (NoiseType::Step, "step")] {
        for fade in [0.0f32, 0.5] {
            for cv in [0.0f32, 0.7] {
                for threshold in [0.0f32, 0.4] {
                    for scale in [1.0f32, 2.5] {
                        for (dur, time_ms) in [(500.0f32, 0.0f32), (500.0, 333.0), (500.0, 1250.0), (500.0, 4999.0), (f32::INFINITY, 777.0)] {
                            let mut cfg = base_config();
                            cfg.speed = if dur.is_infinite() {
                                SpeedConfig { mode: SpeedMode::Infinite, time_ms: 0.0, beat_value: 1.0, beat_offset: 0.0 }
                            } else {
                                SpeedConfig { mode: SpeedMode::Time, time_ms: dur, beat_value: 1.0, beat_offset: 0.0 }
                            };
                            cfg.noise_params = Some(NoiseParams { noise_type, scale, channel_mode: ChannelMode::Linked, color_variation: cv, fade, threshold });
                            cfg.effect_type = "NoiseEffect".into();
                            let mut fx = create_effect(cfg);
                            fx.update(0.0, time_ms, 120.0);
                            let mut samples = Vec::new();
                            let mut expected = Vec::new();
                            for (x, y) in positions {
                                for ch in channels {
                                    let seed = channel_seed(ch);
                                    samples.push(json!({ "x": x, "y": y, "phase": 0.0, "base": [0.5], "channelSeed": seed }));
                                    expected.push(json!([fx.render(x, y, seed, 0, 1)]));
                                }
                            }
                            cases.push(json!({
                                "params": { "noiseType": type_name, "scale": scale, "colorVariation": cv, "fade": fade, "threshold": threshold },
                                "ctx": ctx(time_ms, if dur.is_infinite() { 0.0 } else { 1000.0 / dur }, 1.0),
                                "samples": samples,
                                "expected": expected,
                                "compare": "raw",
                            }));
                        }
                    }
                }
            }
        }
    }
    cases
}

// ── Sequencer ───────────────────────────────────────

fn sequencer_cases() -> Vec<Value> {
    let mut cases = Vec::new();
    let patterns = [
        (SequencerPatternType::Split, "split"),
        (SequencerPatternType::Checkerboard, "checkerboard"),
        (SequencerPatternType::Sections, "sections"),
        (SequencerPatternType::Scatter, "scatter"),
        (SequencerPatternType::Flow, "flow"),
    ];
    let base = 0.8f32;
    let strength = 0.75f32;
    for (pattern, name) in patterns {
        for invert in [false, true] {
            for density in [0.3f32, 0.7] {
                for variation in [0.0f32, 0.5] {
                    for angle in [0.0f32, 0.7] {
                        for (time_ms, phase) in [(0.0f32, 0.1f32), (1700.0, 0.6), (2600.0, 0.35)] {
                            let mut cfg = base_config();
                            cfg.strength = strength * 255.0;
                            cfg.sequencer_params = Some(SequencerParams {
                                pattern_type: pattern, origin_x: 0.4, origin_y: 0.6, angle, scale: 0.2, count: 4,
                                density, density_variation: variation, invert,
                            });
                            cfg.effect_type = "SequencerEffect".into();
                            let mut fx = create_effect(cfg);
                            fx.update(0.0, time_ms, 120.0);
                            fx.set_time_phase(phase * TAU);
                            let mut samples = Vec::new();
                            let mut expected = Vec::new();
                            for g in 0..8u32 {
                                let x = 0.1 + (g % 4) as f32 * 0.25;
                                let y = 0.2 + (g / 4) as f32 * 0.55;
                                let wave = fx.render(x, y, 0, g, 8);
                                let mapped = if wave >= 0.0 { base } else { base * (1.0 + wave * strength) };
                                samples.push(json!({ "x": x, "y": y, "phase": phase, "groupIndex": g, "groupCount": 8, "base": [base] }));
                                expected.push(json!([mapped]));
                            }
                            cases.push(json!({
                                "params": {
                                    "patternType": name, "origin": { "x": 0.4, "y": 0.6 }, "angle": angle, "scale": 0.2,
                                    "density": density, "densityVariation": variation, "invert": invert,
                                },
                                "ctx": ctx(time_ms, 2.0, strength),
                                "samples": samples,
                                "expected": expected,
                                "compare": "mapped",
                            }));
                        }
                    }
                }
            }
        }
    }
    cases
}

// ── Color adjust ────────────────────────────────────

fn color_cases() -> Vec<Value> {
    let mut cases = Vec::new();
    let bases = [(1.0f32, 0.0f32, 0.0f32), (0.2, 0.6, 0.9), (0.5, 0.5, 0.5), (0.0, 0.0, 0.0005), (0.9, 0.8, 0.1)];
    let phases = [0.0f32, 0.25, 0.6];
    for (shape, shape_name, param) in [(WaveformShape::Sine, "sine", 0.5f32), (WaveformShape::Triangle, "triangle", 0.3)] {
        for hue_shift in [0.0f32, 45.0, -120.0] {
            for saturation in [1.0f32, 0.4, 1.6] {
                for hue_range in [0.0f32, 60.0] {
                    for sat_range in [0.0f32, 0.3] {
                        let mut cfg = base_config();
                        cfg.waveform_shape = shape;
                        cfg.waveform_params = WaveformShapeParams { param, start: 0.0, end: 1.0, offset: 0.0, floor: -1.0 };
                        let cp = ColorParams { hue_shift, saturation, hue_range, sat_range };
                        let mut samples = Vec::new();
                        let mut expected = Vec::new();
                        for phase in phases {
                            let cycle = evaluate_phase(&cfg, phase * TAU);
                            for (r, g, b) in bases {
                                let eff_hue = cp.hue_shift + cycle * cp.hue_range;
                                let eff_sat = (cp.saturation + cycle * cp.sat_range).clamp(0.0, 2.0);
                                let (h, s, l) = rgb_to_hsl(r, g, b);
                                let new_h = if l < 1e-3 { h } else { (h + eff_hue / 360.0).rem_euclid(1.0) };
                                let new_s = (s * eff_sat).clamp(0.0, 1.0);
                                let (nr, ng, nb) = hsl_to_rgb(new_h, new_s, l);
                                samples.push(json!({ "x": 0.5, "y": 0.5, "phase": phase, "base": [r, g, b] }));
                                expected.push(json!([nr.clamp(0.0, 1.0), ng.clamp(0.0, 1.0), nb.clamp(0.0, 1.0)]));
                            }
                        }
                        cases.push(json!({
                            "params": {
                                "hueShift": hue_shift, "saturation": saturation, "hueRange": hue_range, "satRange": sat_range,
                                "shape": shape_name, "shapeParam": param,
                            },
                            "ctx": ctx(0.0, 1.0, 1.0),
                            "samples": samples,
                            "expected": expected,
                            "compare": "raw",
                        }));
                    }
                }
            }
        }
    }
    cases
}

#[test]
#[ignore]
fn generate_goldens() {
    write("waveform", waveform_cases());
    write("noise", noise_cases());
    write("sequencer", sequencer_cases());
    write("color-adjust", color_cases());
}
