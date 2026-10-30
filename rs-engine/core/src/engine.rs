// ── Engine ───────────────────────────────────────
//
// Render pipeline per frame (ADR §6.5):
//   1. beat time from the piecewise BPM clock,
//   2. base values from chasers,
//   3. for each modifier instance in list order: collect samples for its
//      signature (scalar channels / rgb heads / pan-tilt heads), compute
//      phase and seeds, run the plugin through `ModifierRuntime`, blend,
//   4. write the DMX buffer with per-channel range remapping.
// Modifiers themselves live in content plugins; the core only orchestrates.

use crate::beat_clock::BeatClock;
use crate::distribution::Distribution;
use crate::phase::{phase_speed, speed_phase};
use crate::room::Room;
use crate::runtime::{ctx, sample, FrameCtx, ModifierRuntime, NullRuntime, PluginRef, Sample};
use crate::signatures::{from_dmx16, remap_range, rgb_read, rgb_write, to_dmx16, ColorSystem, Signature};
use crate::types::{BlendMode, ChaserConfig, OutputMode, RenderTarget, SpeedConfig, SpeedMode};

// ── Layout input ─────────────────────────────────

/// One channel of the layout packet.
pub struct LayoutChannelEntry {
    pub dmx_index: usize,
    pub channel_type_id: u8,
    pub world_x: f32,
    pub world_y: f32,
    /// v1.3: height above the floor (normalized like x/y).
    pub world_z: f32,
    pub resolution: u8,
    pub fine_offsets: [usize; 2],
    pub range_min: u8,
    pub range_max: u8,
    pub head_index: u16,
}

/// One fixture of the layout packet.
pub struct LayoutEntry {
    pub group_index: usize,
    /// Stable hash of the fixture id (seeds).
    pub id_hash: u32,
    pub channels: Vec<LayoutChannelEntry>,
}

/// One chaser config shared by several channels.
pub struct ChannelEntry {
    pub dmx_indices: Vec<usize>,
    pub chaser: ChaserConfig,
}

/// Maps the binary channel type id to its name (seeds, debugging).
pub fn channel_type_name(id: u8) -> &'static str {
    match id {
        0 => "RED", 1 => "GREEN", 2 => "BLUE", 3 => "WHITE", 4 => "WARM_WHITE", 5 => "COOL_WHITE",
        6 => "AMBER", 7 => "UV", 8 => "CYAN", 9 => "MAGENTA", 10 => "YELLOW", 11 => "LIME",
        12 => "INDIGO", 13 => "DIMMER", 14 => "PAN", 15 => "TILT", 16 => "PANTILT_SPEED", 17 => "STROBE",
        18 => "STROBE_SPEED", 19 => "STROBE_DURATION", 20 => "ZOOM", 21 => "FOCUS", 22 => "IRIS", 23 => "FROST",
        24 => "BEAM_ANGLE", 25 => "BEAM_POSITION", 26 => "PRISM", 27 => "PRISM_ROTATION", 28 => "BLADE",
        29 => "COLOR_WHEEL", 30 => "COLOR_PRESET", 31 => "COLOR_TEMPERATURE", 32 => "GOBO_WHEEL",
        33 => "GOBO_SPIN", 34 => "EFFECT", 35 => "EFFECT_SPEED", 36 => "EFFECT_DURATION",
        37 => "SOUND_SENSITIVITY", 38 => "ROTATION", 39 => "SPEED", 40 => "TIME", 41 => "FOG",
        42 => "MAINTENANCE", 43 => "GENERIC", 44 => "CUSTOM",
        _ => "OTHER",
    }
}

/// Channel type ids used by signature mapping.
mod ct {
    pub const RED: u8 = 0;
    pub const GREEN: u8 = 1;
    pub const BLUE: u8 = 2;
    pub const WHITE: u8 = 3;
    pub const AMBER: u8 = 6;
    pub const CYAN: u8 = 8;
    pub const MAGENTA: u8 = 9;
    pub const YELLOW: u8 = 10;
    pub const DIMMER: u8 = 13;
    pub const PAN: u8 = 14;
    pub const TILT: u8 = 15;
}

/// FNV-1a of a channel type name (per-channel-type seed, as before).
fn channel_seed(type_id: u8) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in channel_type_name(type_id).as_bytes() {
        h = (h ^ (*b as u32)).wrapping_mul(0x01000193);
    }
    h
}

/// Murmur3 finalizer (seed mixing).
fn fmix32(mut h: u32) -> u32 {
    h ^= h >> 16;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^ (h >> 16)
}

/// Stable 24-bit seed of (fixture, head, instance).
fn sample_seed(id_hash: u32, head: usize, key: u32) -> u32 {
    fmix32(id_hash ^ (head as u32).wrapping_mul(0x9e37_79b1) ^ key.wrapping_mul(0x85eb_ca6b)) & 0x00ff_ffff
}

// ── Heads (rgb / pan-tilt targets) ───────────────

/// Color channels of a head (DMX indices in system order).
#[derive(Debug, Clone)]
pub struct HeadColor {
    pub system: ColorSystem,
    pub dmx: [usize; 4],
}

/// One head of a fixture with its signature-relevant channels.
#[derive(Debug, Clone)]
pub struct Head {
    pub group: usize,
    pub head: usize,
    pub head_count: usize,
    pub x: f32,
    pub y: f32,
    /// v1.3: height above the floor.
    pub z: f32,
    pub color: Option<HeadColor>,
    /// (coarse, optional fine) DMX indices.
    pub pan: Option<(usize, Option<usize>)>,
    pub tilt: Option<(usize, Option<usize>)>,
}

/// Groups coarse channels into heads and detects color systems.
fn build_heads(targets: &[RenderTarget]) -> Vec<Head> {
    use std::collections::BTreeMap;
    let mut by_head: BTreeMap<(usize, usize), Vec<&RenderTarget>> = BTreeMap::new();
    let mut head_counts: BTreeMap<usize, usize> = BTreeMap::new();
    for t in targets.iter().filter(|t| t.resolution > 0) {
        by_head.entry((t.group_index, t.head_index)).or_default().push(t);
        let c = head_counts.entry(t.group_index).or_insert(0);
        *c = (*c).max(t.head_index + 1);
    }
    let fine = |t: &RenderTarget| if t.fine_offsets[0] != 0xFFFF && t.resolution > 1 { Some(t.fine_offsets[0]) } else { None };
    by_head
        .into_iter()
        .map(|((group, head), chs)| {
            let find = |id: u8| chs.iter().find(|t| t.channel_type_id == id).copied();
            let color = match (find(ct::RED), find(ct::GREEN), find(ct::BLUE)) {
                (Some(r), Some(g), Some(b)) => Some(if let Some(w) = find(ct::WHITE) {
                    HeadColor { system: ColorSystem::Rgbw, dmx: [r.dmx_index, g.dmx_index, b.dmx_index, w.dmx_index] }
                } else if let Some(a) = find(ct::AMBER) {
                    HeadColor { system: ColorSystem::Rgba, dmx: [r.dmx_index, g.dmx_index, b.dmx_index, a.dmx_index] }
                } else {
                    HeadColor { system: ColorSystem::Rgb, dmx: [r.dmx_index, g.dmx_index, b.dmx_index, 0] }
                }),
                _ => match (find(ct::CYAN), find(ct::MAGENTA), find(ct::YELLOW)) {
                    (Some(c), Some(m), Some(y)) => Some(HeadColor { system: ColorSystem::Cmy, dmx: [c.dmx_index, m.dmx_index, y.dmx_index, 0] }),
                    _ => None,
                },
            };
            let first = chs[0];
            Head {
                group,
                head,
                head_count: *head_counts.get(&group).unwrap_or(&1),
                x: first.world_x,
                y: first.world_y,
                z: first.world_z,
                color,
                pan: find(ct::PAN).map(|t| (t.dmx_index, fine(t))),
                tilt: find(ct::TILT).map(|t| (t.dmx_index, fine(t))),
            }
        })
        .collect()
}

// ── Modifier instances ───────────────────────────

/// A modifier instance from the modifiers packet.
#[derive(Debug, Clone)]
pub struct ModifierInstance {
    /// Stable key (hash of the instance id); runtime instance id.
    pub key: u32,
    pub plugin: PluginRef,
    pub signature: Signature,
    pub output: OutputMode,
    pub blend: BlendMode,
    /// 0–1.
    pub strength: f32,
    pub speed: SpeedConfig,
    pub distribution: Distribution,
    /// Scalar target channel type ids (empty = all).
    pub channel_types: Vec<u8>,
    /// Targeted fixtures by group index (`None` = all).
    pub fixture_mask: Option<Vec<bool>>,
    pub params: Vec<f32>,
    /// Set after a runtime error; cleared when plugin/params change.
    pub disabled: bool,
}

impl ModifierInstance {
    /// True when the instance applies to fixture `group`.
    pub fn targets_group(&self, group: usize) -> bool {
        self.fixture_mask.as_ref().map(|m| m.get(group).copied().unwrap_or(false)).unwrap_or(true)
    }
}

// ── Blending ─────────────────────────────────────

/// Blends one component (all values normalized 0–1). See ADR amendments A13
/// (bipolar, absolute) and A20 (scale).
pub fn blend(mode: BlendMode, output: OutputMode, prev: f32, base: f32, out: f32, strength: f32) -> f32 {
    let v = match output {
        OutputMode::Bipolar => {
            let mapped = base + strength * (out - 1.0) * 0.5;
            match mode {
                BlendMode::Add => prev + (mapped - base),
                BlendMode::Override => mapped,
                BlendMode::Multiply => prev * mapped,
                BlendMode::Max => prev.max(mapped),
                BlendMode::Min => prev.min(mapped),
            }
        }
        OutputMode::Scale => {
            // Level as a fraction of the programmed value (ADR A20).
            let factor = 1.0 - strength + strength * out.clamp(0.0, 1.0);
            let mapped = base * factor;
            match mode {
                BlendMode::Add => prev + (mapped - base),
                BlendMode::Override => mapped,
                BlendMode::Multiply => prev * factor,
                BlendMode::Max => prev.max(mapped),
                BlendMode::Min => prev.min(mapped),
            }
        }
        OutputMode::Absolute => {
            let mixed = match mode {
                BlendMode::Add => prev + out,
                BlendMode::Override => out,
                BlendMode::Multiply => prev * out,
                BlendMode::Max => prev.max(out),
                BlendMode::Min => prev.min(out),
            };
            prev + (mixed - prev) * strength
        }
    };
    if v.is_finite() { v.clamp(0.0, 1.0) } else { prev }
}

// ── Sample references ────────────────────────────

/// What a collected sample refers to.
#[derive(Debug, Clone, Copy)]
enum SampleRef {
    /// Scalar: target index.
    Channel(usize),
    /// rgb / panTilt: head index.
    Head(usize),
}

// ── Engine ───────────────────────────────────────

pub struct EffectEngine {
    pub dmx_buffer: Vec<u8>,
    /// Chaser base values (0–255).
    pub base_buffer: Vec<f32>,
    /// Working values (0–255).
    pub render_buffer: Vec<f32>,
    pub clock: BeatClock,
    pub targets: Vec<RenderTarget>,
    pub heads: Vec<Head>,
    /// Fixture id hashes by group index.
    pub fixture_hashes: Vec<u32>,
    pub instances: Vec<ModifierInstance>,
    /// v1.3: bounding box of all channel positions (rebuilt on layout sync).
    pub room: Room,
    /// v1.3: meters per normalized world unit (layout packet header).
    pub meters_per_unit: f32,
    runtime: Box<dyn ModifierRuntime>,
    // Scratch buffers reused every frame.
    refs: Vec<SampleRef>,
    samples: Vec<Sample>,
    out: Vec<f32>,
    group_rank: Vec<i32>,
    /// Head index per target (scalar samples' head count lookup).
    target_head: Vec<usize>,
    /// Random-grouping permutations by rank count (per instance render).
    perms: std::collections::HashMap<usize, Vec<u32>>,
}

impl Default for EffectEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl EffectEngine {
    /// Engine without a plugin runtime (modifiers are skipped).
    pub fn new() -> Self {
        Self::with_runtime(Box::new(NullRuntime))
    }

    /// Engine using `runtime` for modifiers.
    pub fn with_runtime(runtime: Box<dyn ModifierRuntime>) -> Self {
        Self {
            dmx_buffer: vec![0; 512],
            base_buffer: vec![0.0; 512],
            render_buffer: vec![0.0; 512],
            clock: BeatClock::new(120.0),
            targets: Vec::new(),
            heads: Vec::new(),
            fixture_hashes: Vec::new(),
            instances: Vec::new(),
            room: Room::default(),
            meters_per_unit: 0.0,
            runtime,
            refs: Vec::new(),
            samples: Vec::new(),
            out: Vec::new(),
            group_rank: Vec::new(),
            target_head: Vec::new(),
            perms: std::collections::HashMap::new(),
        }
    }

    /// Tempo change at `at_ms` (ms since the clock epoch).
    pub fn set_bpm_at(&mut self, bpm: f32, at_ms: f32) {
        self.clock.set_bpm(bpm, at_ms);
    }

    /// Tempo change at the epoch (convenience; prefer `set_bpm_at`).
    pub fn set_bpm(&mut self, bpm: f32) {
        self.clock.set_bpm(bpm, 0.0);
    }

    /// Restarts the beat clock (new clock epoch).
    pub fn reset_clock(&mut self, bpm: f32) {
        self.clock.reset(bpm);
    }

    /// Single entry point for binary packets.
    pub fn dispatch_bin(&mut self, packet_type: u8, data: &[u8]) -> i32 {
        match packet_type {
            0x10 => {
                if data.len() < 4 { return -1; }
                self.set_bpm(f32::from_le_bytes([data[0], data[1], data[2], data[3]]));
                0
            }
            0x14 => crate::bin_protocol::parse_layout_bin(self, data),
            0x15 => crate::bin_protocol::parse_channels_bin(self, data),
            0x16 => crate::bin_protocol::parse_modifiers_bin(self, data),
            _ => -1,
        }
    }

    // ── Sync ─────────────────────────────────────

    /// Rebuilds targets and heads from the layout (preserves chaser configs).
    pub fn sync_layout(&mut self, entries: Vec<LayoutEntry>) {
        let old: std::collections::HashMap<usize, ChaserConfig> = self
            .targets
            .drain(..)
            .filter_map(|t| t.chaser_config.map(|c| (t.dmx_index, c)))
            .collect();
        let mut max_dmx = 0;
        self.fixture_hashes.clear();
        for fixture in &entries {
            if self.fixture_hashes.len() <= fixture.group_index {
                self.fixture_hashes.resize(fixture.group_index + 1, 0);
            }
            self.fixture_hashes[fixture.group_index] = fixture.id_hash;
            for ch in &fixture.channels {
                max_dmx = max_dmx.max(ch.dmx_index);
                self.targets.push(RenderTarget {
                    dmx_index: ch.dmx_index,
                    channel_type_id: ch.channel_type_id,
                    group_index: fixture.group_index,
                    head_index: ch.head_index as usize,
                    world_x: ch.world_x,
                    world_y: ch.world_y,
                    world_z: ch.world_z,
                    chaser_config: old.get(&ch.dmx_index).cloned(),
                    resolution: ch.resolution,
                    fine_offsets: ch.fine_offsets,
                    range_min: ch.range_min,
                    range_max: ch.range_max,
                });
            }
        }
        self.heads = build_heads(&self.targets);
        self.room = Room::from_points(self.targets.iter().map(|t| (t.world_x, t.world_y)), self.meters_per_unit);
        // Head count per fixture for scalar samples.
        let mut counts = vec![1usize; self.fixture_hashes.len()];
        for h in &self.heads {
            if let Some(c) = counts.get_mut(h.group) { *c = h.head_count; }
        }
        self.target_head = self.targets.iter().map(|t| counts.get(t.group_index).copied().unwrap_or(1)).collect();
        let size = (((max_dmx + 1) + 511) / 512 * 512).max(512);
        if self.dmx_buffer.len() != size {
            self.dmx_buffer.resize(size, 0);
            self.base_buffer.resize(size, 0.0);
            self.render_buffer.resize(size, 0.0);
        }
    }

    /// Updates chaser configs of channels.
    pub fn sync_channels(&mut self, entries: Vec<ChannelEntry>) {
        let mut index: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
        for (i, t) in self.targets.iter().enumerate() {
            index.insert(t.dmx_index, i);
        }
        for entry in entries {
            for dmx in &entry.dmx_indices {
                if let Some(&i) = index.get(dmx) {
                    self.targets[i].chaser_config = Some(entry.chaser.clone());
                }
            }
        }
    }

    /// Replaces the modifier list. Prepares new or changed instances and
    /// releases removed ones; unchanged instances keep their runtime state.
    pub fn sync_modifiers(&mut self, next: Vec<ModifierInstance>) {
        let mut prepared = Vec::with_capacity(next.len());
        for mut inst in next {
            let unchanged = self
                .instances
                .iter()
                .find(|o| o.key == inst.key)
                .filter(|o| o.plugin == inst.plugin && o.params == inst.params);
            match unchanged {
                Some(old) => inst.disabled = old.disabled,
                None => inst.disabled = self.runtime.prepare(inst.key, inst.plugin, &inst.params).is_err(),
            }
            prepared.push(inst);
        }
        for old in &self.instances {
            if !prepared.iter().any(|n| n.key == old.key) {
                self.runtime.release(old.key);
            }
        }
        self.instances = prepared;
    }

    /// Re-enables disabled instances (e.g. after plugins were (re)loaded).
    pub fn retry_disabled(&mut self) {
        for i in 0..self.instances.len() {
            if self.instances[i].disabled {
                let (key, plugin) = (self.instances[i].key, self.instances[i].plugin);
                let params = self.instances[i].params.clone();
                self.instances[i].disabled = self.runtime.prepare(key, plugin, &params).is_err();
            }
        }
    }

    // ── Render helpers ───────────────────────────

    fn resolve_speed_to_ms(speed: &SpeedConfig, bpm: f32) -> f32 {
        match speed.mode {
            SpeedMode::Infinite => f32::INFINITY,
            SpeedMode::Time => speed.time_ms,
            SpeedMode::Beat => (60000.0 / bpm) * speed.beat_value,
        }
    }

    /// Chaser value of a target at `time_ms`.
    fn chaser_value(chaser: &ChaserConfig, time_ms: f32, bpm: f32) -> f32 {
        let step = |i: usize| *chaser.step_values.get(i).unwrap_or(&0.0);
        let active = chaser.active_edit_step.min(chaser.step_values.len().saturating_sub(1));
        if !chaser.is_playing || chaser.steps_count <= 1 {
            return step(active);
        }
        let step_ms = Self::resolve_speed_to_ms(&chaser.step_duration, bpm);
        let fade_ms = Self::resolve_speed_to_ms(&chaser.fade_duration, bpm);
        if step_ms.is_infinite() {
            return step(active);
        }
        let offset_ms = if chaser.step_duration.mode == SpeedMode::Beat {
            chaser.step_duration.beat_offset * 60000.0 / bpm
        } else {
            0.0
        };
        let cycle = step_ms * chaser.steps_count as f32;
        let t = (time_ms + offset_ms).max(0.0) % cycle;
        let current = (t / step_ms).floor() as usize;
        let next = (current + 1) % chaser.steps_count;
        let in_step = t % step_ms;
        let factor = if fade_ms > 0.0 && in_step < fade_ms { in_step / fade_ms } else { 1.0 };
        step(current) + (step(next) - step(current)) * factor
    }

    /// Normalized value of a (coarse, fine) pair in `buf`.
    fn read_pair(buf: &[f32], coarse: usize, fine: Option<usize>) -> f32 {
        match fine {
            Some(f) if f < buf.len() => from_dmx16(buf[coarse].clamp(0.0, 255.0) as u8, buf[f].clamp(0.0, 255.0) as u8),
            _ => buf.get(coarse).copied().unwrap_or(0.0) / 255.0,
        }
    }

    /// Writes a normalized value to a (coarse, fine) pair.
    fn write_pair(buf: &mut [f32], coarse: usize, fine: Option<usize>, v: f32) {
        match fine {
            Some(f) if f < buf.len() => {
                let (c, fb) = to_dmx16(v);
                buf[coarse] = c as f32;
                buf[f] = fb as f32;
            }
            _ => {
                if let Some(slot) = buf.get_mut(coarse) { *slot = (v * 255.0).clamp(0.0, 255.0); }
            }
        }
    }

    /// RGB of a head from `buf` (normalized).
    fn read_rgb(buf: &[f32], c: &HeadColor) -> [f32; 3] {
        let mut vals = [0.0f32; 4];
        for k in 0..c.system.channel_count() {
            vals[k] = buf.get(c.dmx[k]).copied().unwrap_or(0.0) / 255.0;
        }
        rgb_read(c.system, &vals)
    }

    // ── Signature readback (live values, plan P3.15) ─────

    /// Normalized signature tuple of fixture `group`'s first head after the
    /// last render (padded to 3 components). Scalar reads the DIMMER channel,
    /// else the fixture's first channel. `None` when the fixture lacks the
    /// signature's channels.
    pub fn signature_values(&self, group: usize, signature: Signature) -> Option<[f32; 3]> {
        match signature {
            Signature::Scalar => {
                let mut chans = self.targets.iter().filter(|t| t.group_index == group && t.resolution > 0);
                let t = self.targets.iter()
                    .find(|t| t.group_index == group && t.resolution > 0 && t.channel_type_id == ct::DIMMER)
                    .or_else(|| chans.next())?;
                let v = self.render_buffer.get(t.dmx_index).copied()? / 255.0;
                Some([v, 0.0, 0.0])
            }
            Signature::Rgb => {
                let c = self.heads.iter().find(|h| h.group == group && h.color.is_some())?.color.as_ref()?;
                Some(Self::read_rgb(&self.render_buffer, c))
            }
            Signature::PanTilt => {
                let h = self.heads.iter().find(|h| h.group == group && h.pan.is_some() && h.tilt.is_some())?;
                let ((pc, pf), (tc, tf)) = (h.pan?, h.tilt?);
                Some([Self::read_pair(&self.render_buffer, pc, pf), Self::read_pair(&self.render_buffer, tc, tf), 0.0])
            }
        }
    }

    /// Normalized signature tuple of head `head` of fixture `group` after the
    /// last render (observation, ADR 0002 §6). Scalar reads the head's channel
    /// of type `channel_type` (`None` = DIMMER, else the head's first channel).
    pub fn head_signature_values(&self, group: usize, head: usize, signature: Signature, channel_type: Option<u8>) -> Option<[f32; 3]> {
        match signature {
            Signature::Scalar => {
                let on_head = |t: &&RenderTarget| t.group_index == group && t.head_index == head && t.resolution > 0;
                let wanted = channel_type.unwrap_or(ct::DIMMER);
                let t = self.targets.iter().filter(on_head).find(|t| t.channel_type_id == wanted)
                    .or_else(|| if channel_type.is_none() { self.targets.iter().find(on_head) } else { None })?;
                let v = self.render_buffer.get(t.dmx_index).copied()? / 255.0;
                Some([v, 0.0, 0.0])
            }
            Signature::Rgb => {
                let c = self.heads.iter().find(|h| h.group == group && h.head == head && h.color.is_some())?.color.as_ref()?;
                Some(Self::read_rgb(&self.render_buffer, c))
            }
            Signature::PanTilt => {
                let h = self.heads.iter().find(|h| h.group == group && h.head == head && h.pan.is_some() && h.tilt.is_some())?;
                let ((pc, pf), (tc, tf)) = (h.pan?, h.tilt?);
                Some([Self::read_pair(&self.render_buffer, pc, pf), Self::read_pair(&self.render_buffer, tc, tf), 0.0])
            }
        }
    }

    /// Reads `(group, head, signature id, channel type id or 255)` quads into
    /// `out` as 3 f32 each; unavailable tuples are NaN.
    pub fn read_head_signatures(&self, requests: &[u32], out: &mut Vec<f32>) {
        out.clear();
        for q in requests.chunks_exact(4) {
            let channel_type = if q[3] >= 255 { None } else { Some(q[3] as u8) };
            let v = Signature::from_id(q[2] as u8)
                .and_then(|sig| self.head_signature_values(q[0] as usize, q[1] as usize, sig, channel_type))
                .unwrap_or([f32::NAN; 3]);
            out.extend_from_slice(&v);
        }
    }

    /// Reads several `(group, signature id)` requests (flat pairs) into
    /// `out` as 3 f32 each; unavailable tuples are NaN.
    pub fn read_signatures(&self, requests: &[u32], out: &mut Vec<f32>) {
        out.clear();
        for pair in requests.chunks_exact(2) {
            let v = Signature::from_id(pair[1] as u8)
                .and_then(|sig| self.signature_values(pair[0] as usize, sig))
                .unwrap_or([f32::NAN; 3]);
            out.extend_from_slice(&v);
        }
    }

    /// Collects the samples of instance `idx` into `self.refs`.
    fn collect(&mut self, idx: usize) {
        self.refs.clear();
        let inst = &self.instances[idx];
        match inst.signature {
            Signature::Scalar => {
                for (i, t) in self.targets.iter().enumerate() {
                    if t.resolution == 0 || t.dmx_index >= self.render_buffer.len() || !inst.targets_group(t.group_index) {
                        continue;
                    }
                    if !inst.channel_types.is_empty() && !inst.channel_types.contains(&t.channel_type_id) {
                        continue;
                    }
                    self.refs.push(SampleRef::Channel(i));
                }
            }
            Signature::Rgb | Signature::PanTilt => {
                for (h, head) in self.heads.iter().enumerate() {
                    let ok = match inst.signature {
                        Signature::Rgb => head.color.is_some(),
                        _ => head.pan.is_some() && head.tilt.is_some(),
                    };
                    if ok && inst.targets_group(head.group) {
                        self.refs.push(SampleRef::Head(h));
                    }
                }
            }
        }
    }

    // ── Render ───────────────────────────────────

    /// Renders one frame at `time_ms` (ms since the clock epoch).
    pub fn render(&mut self, time_ms: f32, _delta_time_ms: f32) {
        self.dmx_buffer.fill(0);
        self.base_buffer.fill(0.0);
        self.render_buffer.fill(0.0);

        let beat_time = self.clock.beat_time(time_ms);
        let bpm = self.clock.bpm();

        // 1. Base values from chasers.
        for t in &self.targets {
            if t.dmx_index >= self.render_buffer.len() { continue; }
            let v = t.chaser_config.as_ref().map(|c| Self::chaser_value(c, time_ms, bpm)).unwrap_or(0.0).clamp(0.0, 255.0);
            self.base_buffer[t.dmx_index] = v;
            self.render_buffer[t.dmx_index] = v;
        }

        // 2. Modifiers in list order.
        for idx in 0..self.instances.len() {
            if !self.instances[idx].disabled {
                self.render_instance(idx, time_ms, beat_time, bpm);
            }
        }

        // 3. DMX output with per-channel range remap.
        for t in &self.targets {
            if t.dmx_index >= self.dmx_buffer.len() { continue; }
            self.dmx_buffer[t.dmx_index] = remap_range(self.render_buffer[t.dmx_index], t.range_min, t.range_max) as u8;
        }
    }

    /// Runs one modifier instance and blends its output.
    fn render_instance(&mut self, idx: usize, time_ms: f32, beat_time: f32, bpm: f32) {
        self.collect(idx);
        if self.refs.is_empty() { return; }
        let inst = self.instances[idx].clone();

        // Rank of each targeted fixture (groupIndex) and their count.
        let group_total = self.fixture_hashes.len();
        self.group_rank.clear();
        self.group_rank.resize(group_total, -1);
        let mut group_count = 0;
        for g in 0..group_total {
            if inst.targets_group(g) {
                self.group_rank[g] = group_count;
                group_count += 1;
            }
        }

        let arity = inst.signature.arity();
        let sp = speed_phase(&inst.speed, time_ms, beat_time);
        let mut fctx = FrameCtx::default();
        fctx.0[ctx::TIME_MS] = time_ms;
        fctx.0[ctx::BEAT_TIME] = beat_time;
        fctx.0[ctx::BPM] = bpm;
        fctx.0[ctx::PHASE_SPEED] = phase_speed(&inst.speed, bpm);
        fctx.0[ctx::ARITY] = arity as f32;
        fctx.0[ctx::SEED_LO] = (inst.key & 0xffff) as f32;
        fctx.0[ctx::SEED_HI] = (inst.key >> 16) as f32;
        fctx.0[ctx::STRENGTH] = inst.strength;
        fctx.0[ctx::TIME_PHASE] = sp;
        self.perms.clear();
        let mut max_heads = 1usize;

        // Samples (base = working value before this modifier).
        self.samples.clear();
        for &r in &self.refs {
            let mut s = Sample::default();
            let (group, head, head_count, x, y, z) = match r {
                SampleRef::Channel(i) => {
                    let t = &self.targets[i];
                    let seed = channel_seed(t.channel_type_id);
                    s.0[sample::CHANNEL_SEED_LO] = (seed & 0xffff) as f32;
                    s.0[sample::CHANNEL_SEED_HI] = (seed >> 16) as f32;
                    s.0[sample::BASE0] = self.render_buffer[t.dmx_index] / 255.0;
                    (t.group_index, t.head_index, self.target_head.get(i).copied().unwrap_or(1), t.world_x, t.world_y, t.world_z)
                }
                SampleRef::Head(h) => {
                    let head = &self.heads[h];
                    if let (Signature::Rgb, Some(c)) = (inst.signature, head.color.as_ref()) {
                        let rgb = Self::read_rgb(&self.render_buffer, c);
                        s.0[sample::BASE0..sample::BASE0 + 3].copy_from_slice(&rgb);
                    } else if let (Some((pc, pf)), Some((tc, tf))) = (head.pan, head.tilt) {
                        s.0[sample::BASE0] = Self::read_pair(&self.render_buffer, pc, pf);
                        s.0[sample::BASE0 + 1] = Self::read_pair(&self.render_buffer, tc, tf);
                    }
                    (head.group, head.head, head.head_count, head.x, head.y, head.z)
                }
            };
            let d = inst.distribution.sample(x, y, group, head, head_count, &mut self.perms);
            max_heads = max_heads.max(head_count);
            s.0[sample::X] = x;
            s.0[sample::Y] = y;
            // v1.3: height and room coordinates.
            let (u, v) = self.room.uv(x, y);
            s.0[sample::Z] = z;
            s.0[sample::U] = u;
            s.0[sample::V] = v;
            // Legacy phase (ABI v1): speed phase minus the distribution position.
            s.0[sample::PHASE] = sp - d.spatial;
            s.0[sample::SPATIAL] = d.spatial;
            s.0[sample::RANK] = d.rank as f32;
            s.0[sample::DIST_GROUP] = d.group as f32;
            s.0[sample::GROUP_INDEX] = self.group_rank.get(group).copied().unwrap_or(0).max(0) as f32;
            s.0[sample::GROUP_COUNT] = group_count as f32;
            s.0[sample::HEAD_INDEX] = head as f32;
            s.0[sample::HEAD_COUNT] = head_count as f32;
            s.0[sample::SEED] = sample_seed(self.fixture_hashes.get(group).copied().unwrap_or(0), head, inst.key) as f32;
            self.samples.push(s);
        }

        let (rank_count, group_count) = inst.distribution.frame_counts(max_heads);
        fctx.0[ctx::RANK_COUNT] = rank_count as f32;
        fctx.0[ctx::DIST_GROUP_COUNT] = group_count as f32;
        fctx.0[ctx::SPREAD] = inst.distribution.spread_kind() as f32;
        fctx.0[ctx::HANDLE_ORIGIN_X] = inst.distribution.origin.0;
        fctx.0[ctx::HANDLE_ORIGIN_Y] = inst.distribution.origin.1;
        fctx.0[ctx::HANDLE_END_X] = inst.distribution.end.0;
        fctx.0[ctx::HANDLE_END_Y] = inst.distribution.end.1;
        fctx.0[ctx::WORLD_ASPECT] = self.room.aspect();
        fctx.0[ctx::WORLD_DEPTH] = self.room.depth;
        fctx.0[ctx::METERS_PER_UNIT] = self.room.meters_per_unit;

        self.out.clear();
        self.out.resize(self.samples.len() * arity, 0.0);
        if self.runtime.render(inst.key, &fctx, &self.samples, arity, &mut self.out).is_err() {
            self.instances[idx].disabled = true;
            return;
        }

        // Blend outputs into the working values.
        for n in 0..self.refs.len() {
            let o = &self.out[n * arity..n * arity + arity];
            match self.refs[n] {
                SampleRef::Channel(i) => {
                    let d = self.targets[i].dmx_index;
                    let prev = self.render_buffer[d] / 255.0;
                    let base = self.base_buffer[d] / 255.0;
                    self.render_buffer[d] = blend(inst.blend, inst.output, prev, base, o[0], inst.strength) * 255.0;
                }
                SampleRef::Head(h) => {
                    let head = &self.heads[h];
                    if let (Signature::Rgb, Some(c)) = (inst.signature, head.color.as_ref()) {
                        let prev = Self::read_rgb(&self.render_buffer, c);
                        let base = Self::read_rgb(&self.base_buffer, c);
                        let mut rgb = [0.0f32; 3];
                        for k in 0..3 {
                            rgb[k] = blend(inst.blend, inst.output, prev[k], base[k], o[k], inst.strength);
                        }
                        let vals = rgb_write(c.system, rgb);
                        for k in 0..c.system.channel_count() {
                            if let Some(slot) = self.render_buffer.get_mut(c.dmx[k]) { *slot = vals[k] * 255.0; }
                        }
                    } else if let (Some((pc, pf)), Some((tc, tf))) = (head.pan, head.tilt) {
                        let pan = blend(inst.blend, inst.output, Self::read_pair(&self.render_buffer, pc, pf), Self::read_pair(&self.base_buffer, pc, pf), o[0], inst.strength);
                        let tilt = blend(inst.blend, inst.output, Self::read_pair(&self.render_buffer, tc, tf), Self::read_pair(&self.base_buffer, tc, tf), o[1], inst.strength);
                        Self::write_pair(&mut self.render_buffer, pc, pf, pan);
                        Self::write_pair(&mut self.render_buffer, tc, tf, tilt);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
