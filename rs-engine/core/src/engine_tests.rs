// ── Engine tests ─────────────────────────────────
//
// Exercise the render pipeline with a mock runtime: packets → targets/heads →
// samples → plugin output → blending → DMX.

use super::*;
use crate::runtime::{sample, FrameCtx, ModifierRuntime, RuntimeError, Sample};
use std::cell::RefCell;
use std::rc::Rc;

/// What the mock saw / returns.
#[derive(Default)]
struct MockState {
    /// Output per component for every sample.
    out: Vec<f32>,
    /// Fail renders when set.
    fail: bool,
    prepared: Vec<(u32, u32, Vec<f32>)>,
    last_samples: Vec<Sample>,
    last_ctx: FrameCtx,
}

struct Mock(Rc<RefCell<MockState>>);

impl ModifierRuntime for Mock {
    fn prepare(&mut self, instance: u32, plugin: u32, params: &[f32]) -> Result<(), RuntimeError> {
        self.0.borrow_mut().prepared.push((instance, plugin, params.to_vec()));
        Ok(())
    }
    fn render(&mut self, _: u32, ctx: &FrameCtx, samples: &[Sample], arity: usize, out: &mut [f32]) -> Result<(), RuntimeError> {
        let mut s = self.0.borrow_mut();
        if s.fail {
            return Err(RuntimeError::Trap("boom".into()));
        }
        s.last_ctx = *ctx;
        s.last_samples = samples.to_vec();
        for (i, v) in out.iter_mut().enumerate() {
            *v = s.out[i % arity];
        }
        Ok(())
    }
}

// ── Packet builders ──────────────────────────────

/// Little-endian writer.
#[derive(Default)]
struct W(Vec<u8>);
impl W {
    fn u8(&mut self, v: u8) -> &mut Self { self.0.push(v); self }
    fn u16(&mut self, v: u16) -> &mut Self { self.0.extend_from_slice(&v.to_le_bytes()); self }
    fn u32(&mut self, v: u32) -> &mut Self { self.0.extend_from_slice(&v.to_le_bytes()); self }
    fn f32(&mut self, v: f32) -> &mut Self { self.0.extend_from_slice(&v.to_le_bytes()); self }
}

/// (dmx, type, head, resolution, fine0) per channel; fixtures in order.
fn layout(fixtures: &[Vec<(u16, u8, u16, u8, u16)>]) -> Vec<u8> {
    let mut w = W::default();
    w.f32(12.0).u16(fixtures.len() as u16); // v3: meters per world unit
    for (g, chs) in fixtures.iter().enumerate() {
        w.u16(g as u16).u32(1000 + g as u32).u16(chs.len() as u16);
        for &(dmx, ty, head, res, fine0) in chs {
            w.u16(dmx).u8(ty).f32(g as f32 * 0.25).f32(0.5).f32(g as f32 * 0.1).u8(res).u16(fine0).u16(0xFFFF).u8(0).u8(255).u16(head);
        }
    }
    w.0
}

/// Every channel at a static value.
fn channels(values: &[(u16, f32)]) -> Vec<u8> {
    let mut w = W::default();
    w.u16(values.len() as u16);
    for &(dmx, v) in values {
        w.u16(1).u16(dmx).u8(1).u8(0).u8(0);
        for _ in 0..2 { w.u8(2).f32(0.0).f32(1.0).f32(0.0); }
        w.f32(v);
    }
    w.0
}

/// One instance description.
struct Inst {
    key: u32,
    signature: u8,
    output: u8,
    blend: u8,
    strength: f32,
    types: Vec<u8>,
    mask: Vec<u8>,
    params: Vec<f32>,
}

fn inst(signature: u8, output: u8, blend: u8, strength: f32) -> Inst {
    Inst { key: 7, signature, output, blend, strength, types: vec![], mask: vec![], params: vec![0.5] }
}

fn modifiers(list: &[Inst]) -> Vec<u8> {
    let mut w = W::default();
    w.u8(1).u16(list.len() as u16);
    for i in list {
        w.u32(i.key).u16(0).u8(i.signature).u8(i.output).u8(i.blend).f32(i.strength);
        w.u8(0).f32(500.0).f32(1.0).f32(0.0); // speed: time 500 ms
        w.u8(1).f32(0.0).f32(0.0).f32(0.0).f32(1.0).u8(0); // linear, fanning 1
        w.u8(i.types.len() as u8);
        for &t in &i.types { w.u8(t); }
        w.u16(i.mask.len() as u16);
        for &m in &i.mask { w.u8(m); }
        w.u16(i.params.len() as u16);
        for &p in &i.params { w.f32(p); }
    }
    w.0
}

/// v2 packet with one scalar instance and an order distribution: `ranks` =
/// (fixture index, rank); grouping everyN `n` when `n > 0`.
fn modifiers_v2(ranks: &[(u16, u16)], n: u8, reverse: bool) -> Vec<u8> {
    let mut w = W::default();
    w.u8(2).u16(1);
    w.u32(7).u16(0).u8(0).u8(2).u8(0).f32(1.0); // scalar, scale, add
    w.u8(1).f32(0.0).f32(2.0).f32(0.0); // speed: beat 2 → time phase = beatTime / 2
    w.u8(0).u8(4).f32(0.0).f32(0.0).f32(1.0).f32(0.0).u8(reverse as u8); // across, order
    w.u8(if n > 0 { 1 } else { 0 }).u8(n.max(1)).u32(1).u8(0);
    w.u16(ranks.len() as u16);
    for &(f, r) in ranks { w.u16(f).u16(r); }
    w.u8(0).u16(0).u16(1).f32(0.5);
    w.0
}

fn engine(out: Vec<f32>) -> (EffectEngine, Rc<RefCell<MockState>>) {
    let state = Rc::new(RefCell::new(MockState { out, ..Default::default() }));
    (EffectEngine::with_runtime(Box::new(Mock(state.clone()))), state)
}

const DIMMER: u8 = 13;

// ── Tests ────────────────────────────────────────

#[test]
fn scalar_bipolar_maps_peak_to_base_and_trough_to_base_minus_strength() {
    let (mut e, _) = engine(vec![-1.0]);
    assert_eq!(e.dispatch_bin(0x14, &layout(&[vec![(0, DIMMER, 0, 1, 0xFFFF)]])), 1);
    e.dispatch_bin(0x15, &channels(&[(0, 200.0)]));
    e.dispatch_bin(0x16, &modifiers(&[inst(0, 0, 0, 0.5)]));
    e.render(0.0, 16.0);
    // base 200/255 − 0.5 → (0.784 − 0.5) × 255 ≈ 72.5
    assert_eq!(e.dmx_buffer[0], 72);

    let (mut e, _) = engine(vec![1.0]);
    e.dispatch_bin(0x14, &layout(&[vec![(0, DIMMER, 0, 1, 0xFFFF)]]));
    e.dispatch_bin(0x15, &channels(&[(0, 200.0)]));
    e.dispatch_bin(0x16, &modifiers(&[inst(0, 0, 0, 1.0)]));
    e.render(0.0, 16.0);
    assert_eq!(e.dmx_buffer[0], 200);
}

#[test]
fn scalar_targets_channel_types_and_fixture_mask() {
    let (mut e, state) = engine(vec![-1.0]);
    e.dispatch_bin(0x14, &layout(&[
        vec![(0, DIMMER, 0, 1, 0xFFFF), (1, 0, 0, 1, 0xFFFF)],
        vec![(2, DIMMER, 0, 1, 0xFFFF)],
    ]));
    e.dispatch_bin(0x15, &channels(&[(0, 255.0), (1, 255.0), (2, 255.0)]));
    let mut i = inst(0, 0, 1, 1.0);
    i.types = vec![DIMMER];
    i.mask = vec![0b10]; // only fixture 1
    e.dispatch_bin(0x16, &modifiers(&[i]));
    e.render(250.0, 16.0);
    assert_eq!(&e.dmx_buffer[0..3], &[255, 255, 0]);

    let s = state.borrow();
    assert_eq!(s.last_samples.len(), 1);
    let smp = s.last_samples[0].0;
    assert_eq!(smp[sample::GROUP_INDEX], 0.0, "rank among targeted fixtures");
    assert_eq!(smp[sample::GROUP_COUNT], 1.0);
    // phase = 250/500 − (x=0.25)/fanning 1 = 0.25
    assert!((smp[sample::PHASE] - 0.25).abs() < 1e-6);
    assert!(smp[sample::SEED] < 16_777_216.0);
    assert_eq!(s.last_ctx.0[crate::runtime::ctx::ARITY], 1.0);
}

#[test]
fn rgb_absolute_override_writes_through_rgbw() {
    let (mut e, state) = engine(vec![1.0, 1.0, 0.0]); // yellow
    e.dispatch_bin(0x14, &layout(&[vec![(0, 0, 0, 1, 0xFFFF), (1, 1, 0, 1, 0xFFFF), (2, 2, 0, 1, 0xFFFF), (3, 3, 0, 1, 0xFFFF)]]));
    e.dispatch_bin(0x15, &channels(&[(0, 0.0), (1, 0.0), (2, 0.0), (3, 255.0)]));
    e.dispatch_bin(0x16, &modifiers(&[inst(1, 1, 1, 1.0)]));
    e.render(0.0, 16.0);
    // Base white read via RGBW = (1,1,1); yellow out → W = min = 0.
    assert_eq!(&e.dmx_buffer[0..4], &[255, 255, 0, 0]);
    let s = state.borrow();
    assert_eq!(&s.last_samples[0].0[sample::BASE0..sample::BASE0 + 3], &[1.0, 1.0, 1.0]);
}

#[test]
fn pan_tilt_writes_16_bit() {
    let (mut e, _) = engine(vec![0.5, 1.0]);
    // PAN coarse 0 + fine 1, TILT coarse 2 (8 bit).
    e.dispatch_bin(0x14, &layout(&[vec![(0, 14, 0, 2, 1), (1, 14, 0, 0, 0xFFFF), (2, 15, 0, 1, 0xFFFF)]]));
    e.dispatch_bin(0x15, &channels(&[(0, 0.0), (1, 0.0), (2, 0.0)]));
    e.dispatch_bin(0x16, &modifiers(&[inst(2, 1, 1, 1.0)]));
    e.render(0.0, 16.0);
    assert_eq!(&e.dmx_buffer[0..3], &[128, 0, 255]);
}

#[test]
fn runtime_error_disables_until_params_change() {
    let (mut e, state) = engine(vec![-1.0]);
    e.dispatch_bin(0x14, &layout(&[vec![(0, DIMMER, 0, 1, 0xFFFF)]]));
    e.dispatch_bin(0x15, &channels(&[(0, 255.0)]));
    e.dispatch_bin(0x16, &modifiers(&[inst(0, 0, 1, 1.0)]));
    state.borrow_mut().fail = true;
    e.render(0.0, 16.0);
    assert!(e.instances[0].disabled);
    assert_eq!(e.dmx_buffer[0], 255, "disabled instance leaves the base value");

    state.borrow_mut().fail = false;
    // Same params: still disabled, no re-prepare.
    e.dispatch_bin(0x16, &modifiers(&[inst(0, 0, 1, 1.0)]));
    assert!(e.instances[0].disabled);
    assert_eq!(state.borrow().prepared.len(), 1);
    // Changed params: re-prepared and enabled.
    let mut i = inst(0, 0, 1, 1.0);
    i.params = vec![0.9];
    e.dispatch_bin(0x16, &modifiers(&[i]));
    assert!(!e.instances[0].disabled);
    e.render(0.0, 16.0);
    assert_eq!(e.dmx_buffer[0], 0);
}

#[test]
fn blend_modes() {
    use crate::types::{BlendMode as B, OutputMode as O};
    assert!((blend(B::Add, O::Bipolar, 0.5, 0.8, -1.0, 0.4) - 0.1).abs() < 1e-6);
    assert!((blend(B::Override, O::Bipolar, 0.5, 0.8, 1.0, 0.4) - 0.8).abs() < 1e-6);
    assert!((blend(B::Override, O::Absolute, 0.2, 0.0, 0.6, 0.5) - 0.4).abs() < 1e-6);
    assert!((blend(B::Max, O::Absolute, 0.7, 0.0, 0.6, 1.0) - 0.7).abs() < 1e-6);
    assert_eq!(blend(B::Add, O::Absolute, 0.5, 0.0, f32::NAN, 1.0), 0.5, "non-finite keeps prev");
}

#[test]
fn scale_output_is_a_fraction_of_the_programmed_value() {
    use crate::types::{BlendMode as B, OutputMode as O};
    // Floor 20 % at full strength: 20 % of the base at any base.
    assert!((blend(B::Override, O::Scale, 1.0, 1.0, 0.2, 1.0) - 0.2).abs() < 1e-6);
    assert!((blend(B::Override, O::Scale, 0.6, 0.6, 0.2, 1.0) - 0.12).abs() < 1e-6);
    assert!((blend(B::Override, O::Scale, 0.3, 0.3, 0.2, 1.0) - 0.06).abs() < 1e-6);
    // Peak lands on the base; half strength halves the depth.
    assert!((blend(B::Override, O::Scale, 0.3, 0.3, 1.0, 1.0) - 0.3).abs() < 1e-6);
    assert!((blend(B::Override, O::Scale, 0.3, 0.3, 0.0, 0.5) - 0.15).abs() < 1e-6);
    // Add applies the delta to the working value; multiply applies the factor.
    assert!((blend(B::Add, O::Scale, 0.5, 0.8, 0.5, 1.0) - 0.1).abs() < 1e-6);
    assert!((blend(B::Multiply, O::Scale, 0.5, 0.8, 0.5, 1.0) - 0.25).abs() < 1e-6);
    // At base 100 % scale equals the bipolar mapping (out = 2v − 1).
    for v in [0.0f32, 0.25, 0.7, 1.0] {
        let s = blend(B::Override, O::Scale, 1.0, 1.0, v, 0.6);
        let b = blend(B::Override, O::Bipolar, 1.0, 1.0, 2.0 * v - 1.0, 0.6);
        assert!((s - b).abs() < 1e-6);
    }
}

#[test]
fn bad_modifier_packets_are_rejected() {
    let (mut e, _) = engine(vec![0.0]);
    assert_eq!(e.dispatch_bin(0x16, &[3, 0, 0]), -1, "unknown version");
    assert_eq!(e.dispatch_bin(0x16, &[1, 1, 0]), -1, "truncated");
}

#[test]
fn read_signatures_after_render() {
    let (mut e, _) = engine(vec![1.0, 1.0, 0.0]);
    e.dispatch_bin(0x14, &layout(&[
        vec![(0, 0, 0, 1, 0xFFFF), (1, 1, 0, 1, 0xFFFF), (2, 2, 0, 1, 0xFFFF), (3, DIMMER, 0, 1, 0xFFFF)],
        vec![(4, 14, 0, 1, 0xFFFF), (5, 15, 0, 1, 0xFFFF)],
    ]));
    e.dispatch_bin(0x15, &channels(&[(0, 0.0), (1, 0.0), (2, 255.0), (3, 51.0), (4, 255.0), (5, 0.0)]));
    e.dispatch_bin(0x16, &modifiers(&[inst(1, 1, 1, 1.0)])); // rgb override → yellow
    e.render(0.0, 16.0);

    let mut out = Vec::new();
    // (group 0, rgb), (group 0, scalar), (group 1, panTilt), (group 1, rgb = unavailable)
    e.read_signatures(&[0, 1, 0, 0, 1, 2, 1, 1], &mut out);
    assert_eq!(out.len(), 12);
    assert_eq!(&out[0..3], &[1.0, 1.0, 0.0]);
    assert!((out[3] - 0.2).abs() < 1e-6, "scalar reads DIMMER");
    assert_eq!(&out[6..8], &[1.0, 0.0]);
    assert!(out[9].is_nan());
}

#[test]
fn read_head_signatures_after_render() {
    let (mut e, _) = engine(vec![1.0, 1.0, 0.0]);
    // Fixture 0: two RGB heads (head index in the 3rd tuple field), fixture 1: dimmer + red.
    e.dispatch_bin(0x14, &layout(&[
        vec![(0, 0, 0, 1, 0xFFFF), (1, 1, 0, 1, 0xFFFF), (2, 2, 0, 1, 0xFFFF), (3, 0, 1, 1, 0xFFFF), (4, 1, 1, 1, 0xFFFF), (5, 2, 1, 1, 0xFFFF)],
        vec![(6, DIMMER, 0, 1, 0xFFFF), (7, 0, 0, 1, 0xFFFF)],
    ]));
    e.dispatch_bin(0x15, &channels(&[(6, 51.0), (7, 102.0)]));
    e.render(0.0, 16.0);

    let mut out = Vec::new();
    // (0, head 1, rgb), (1, head 0, scalar auto = DIMMER), (1, head 0, scalar RED), (1, head 3, rgb = unavailable)
    e.read_head_signatures(&[0, 1, 1, 255, 1, 0, 0, 255, 1, 0, 0, 0, 1, 3, 1, 255], &mut out);
    assert_eq!(out.len(), 12);
    assert!(out[0..3].iter().all(|v| v.is_finite()));
    assert!((out[3] - 0.2).abs() < 1e-6, "auto scalar reads DIMMER");
    assert!((out[6] - 0.4).abs() < 1e-6, "typed scalar reads RED");
    assert!(out[9].is_nan());
}

#[test]
fn v2_order_distribution_fills_abi_1_1_slots() {
    let (mut e, state) = engine(vec![1.0]);
    let three = vec![vec![(0, DIMMER, 0, 1, 0xFFFF)], vec![(1, DIMMER, 0, 1, 0xFFFF)], vec![(2, DIMMER, 0, 1, 0xFFFF)]];
    e.dispatch_bin(0x14, &layout(&three));
    assert_eq!(e.dispatch_bin(0x16, &modifiers_v2(&[(0, 2), (1, 0), (2, 1)], 0, false)), 1);
    e.render(1000.0, 16.0); // 120 BPM: beat time 2 → time phase 1
    let st = state.borrow();
    assert!((st.last_ctx.0[ctx::TIME_PHASE] - 1.0).abs() < 1e-5);
    assert_eq!(st.last_ctx.0[ctx::RANK_COUNT], 3.0);
    assert_eq!(st.last_ctx.0[ctx::DIST_GROUP_COUNT], 0.0);
    assert_eq!(st.last_ctx.0[ctx::SPREAD], 2.0);
    // v1.2 handle slots carry the distribution's origin (0, 0) / end (1, 0).
    assert_eq!((st.last_ctx.0[ctx::HANDLE_ORIGIN_X], st.last_ctx.0[ctx::HANDLE_ORIGIN_Y]), (0.0, 0.0));
    assert_eq!((st.last_ctx.0[ctx::HANDLE_END_X], st.last_ctx.0[ctx::HANDLE_END_Y]), (1.0, 0.0));
    let s0 = &st.last_samples[0].0;
    assert!((s0[sample::SPATIAL] - 2.0 / 3.0).abs() < 1e-6);
    assert_eq!(s0[sample::RANK], 2.0);
    assert_eq!(s0[sample::DIST_GROUP], -1.0);
    assert!((s0[sample::PHASE] - (1.0 - 2.0 / 3.0)).abs() < 1e-5, "legacy phase = time phase − spatial");
}

#[test]
fn v2_grouping_and_reverse() {
    let (mut e, state) = engine(vec![1.0]);
    let four: Vec<_> = (0..4).map(|i| vec![(i as u16, DIMMER, 0, 1, 0xFFFF)]).collect();
    e.dispatch_bin(0x14, &layout(&four));
    e.dispatch_bin(0x16, &modifiers_v2(&[(0, 0), (1, 1), (2, 2), (3, 3)], 2, true));
    e.render(0.0, 16.0);
    let st = state.borrow();
    assert_eq!(st.last_ctx.0[ctx::DIST_GROUP_COUNT], 2.0);
    let groups: Vec<f32> = st.last_samples.iter().map(|s| s.0[sample::DIST_GROUP]).collect();
    assert_eq!(groups, vec![0.0, 1.0, 0.0, 1.0]);
    let spatial: Vec<f32> = st.last_samples.iter().map(|s| s.0[sample::SPATIAL]).collect();
    assert_eq!(spatial, vec![1.0, 0.5, 1.0, 0.5]);
}

#[test]
fn v1_packets_map_onto_a_linear_distribution() {
    let (mut e, state) = engine(vec![1.0]);
    e.dispatch_bin(0x14, &layout(&[vec![(0, DIMMER, 0, 1, 0xFFFF)], vec![(1, DIMMER, 0, 1, 0xFFFF)]]));
    e.dispatch_bin(0x16, &modifiers(&[inst(0, 0, 0, 1.0)]));
    e.render(0.0, 16.0);
    // v1 builder: linear, origin 0, angle 0, fanning 1 → spatial = x (0, 0.25).
    let st = state.borrow();
    assert!((st.last_samples[1].0[sample::SPATIAL] - 0.25).abs() < 1e-6);
    assert!((st.last_samples[1].0[sample::PHASE] + 0.25).abs() < 1e-6);
}

#[test]
fn abi_1_3_fills_z_room_coordinates_and_world_slots() {
    let (mut e, state) = engine(vec![1.0]);
    // Fixtures at x = 0, 0.25, 0.5 (one row at y 0.5), z = 0, 0.1, 0.2.
    let three: Vec<_> = (0..3).map(|i| vec![(i as u16, DIMMER, 0, 1, 0xFFFF)]).collect();
    e.dispatch_bin(0x14, &layout(&three));
    e.dispatch_bin(0x16, &modifiers(&[inst(0, 0, 0, 1.0)]));
    e.render(0.0, 16.0);
    let st = state.borrow();
    // One row: the depth borrows the width (0.5) → aspect 1, v centered.
    assert_eq!(st.last_ctx.0[ctx::WORLD_ASPECT], 1.0);
    assert!((st.last_ctx.0[ctx::WORLD_DEPTH] - 0.5).abs() < 1e-6);
    assert_eq!(st.last_ctx.0[ctx::METERS_PER_UNIT], 12.0);
    assert_eq!(st.last_ctx.0[ctx::RESERVED_19], 0.0);
    let us: Vec<f32> = st.last_samples.iter().map(|s| s.0[sample::U]).collect();
    assert_eq!(us, vec![0.0, 0.5, 1.0]);
    assert!(st.last_samples.iter().all(|s| (s.0[sample::V] - 0.5).abs() < 1e-6));
    assert!((st.last_samples[2].0[sample::Z] - 0.2).abs() < 1e-6);
    assert_eq!(st.last_samples[0].0[sample::RESERVED_19], 0.0);
}

// ── Empty layout ─────────────────────────────────

/// A project without fixtures sends a valid layout (`metersPerUnit`, count 0):
/// accepted with 0 fixtures. Only a truncated payload (e.g. 0 bytes) is
/// rejected — the startup "rejected packet 0x14" came from such a payload.
#[test]
fn empty_layout_is_accepted_and_truncated_payload_rejected() {
    let (mut e, _) = engine(vec![0.0]);
    assert_eq!(e.dispatch_bin(0x14, &layout(&[])), 0);
    assert_eq!(e.dispatch_bin(0x14, &[]), -1);
    assert_eq!(e.dispatch_bin(0x14, &12.0f32.to_le_bytes()), -1);
}
