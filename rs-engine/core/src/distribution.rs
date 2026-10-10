// ── Distribution ─────────────────────────────────
//
// How a modifier instance spreads over fixtures (ADR A20, plan §1.2). The
// host computes `spatial`, `rank` and `distGroup` per sample; ranks of the
// `order` mode are resolved in TypeScript and arrive as a table. Mirrored in
// `app/utils/engine/distribution/sample.ts` (parity-tested on the same table).

use std::collections::HashMap;

/// Ranks used for grouping gradient modes (spatial quantized to 16 steps).
pub const QUANTIZED_RANKS: usize = 16;

/// Over fixtures, or over the heads/pixels inside each fixture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Scope {
    #[default]
    Across,
    Within,
}

/// How `spatial` is derived.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    #[default]
    None,
    Linear,
    Radial,
    Conical,
    Order,
    /// |linear| (only produced from legacy v1 `SYMMETRICAL` packets).
    Mirror,
}

impl Mode {
    /// Wire id → mode (unknown → none).
    pub fn from_id(id: u8) -> Self {
        match id {
            1 => Mode::Linear,
            2 => Mode::Radial,
            3 => Mode::Conical,
            4 => Mode::Order,
            5 => Mode::Mirror,
            _ => Mode::None,
        }
    }

    fn is_gradient(self) -> bool {
        matches!(self, Mode::Linear | Mode::Radial | Mode::Conical | Mode::Mirror)
    }
}

/// Grouping of ranks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Grouping {
    #[default]
    None,
    EveryN,
    Sections,
    Random,
}

impl Grouping {
    /// Wire id → grouping (unknown → none).
    pub fn from_id(id: u8) -> Self {
        match id {
            1 => Grouping::EveryN,
            2 => Grouping::Sections,
            3 => Grouping::Random,
            _ => Grouping::None,
        }
    }
}

/// Distribution of one instance (decoded from the modifiers packet).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Distribution {
    pub scope: Scope,
    pub mode: Mode,
    pub origin: (f32, f32),
    pub end: (f32, f32),
    pub reverse: bool,
    pub grouping: Grouping,
    pub grouping_n: u32,
    pub grouping_seed: u32,
    /// Scope within: offset fixtures by their order rank.
    pub within_order: bool,
    /// Order rank by fixture layout index (−1 = none).
    pub ranks: Vec<i32>,
    /// Distinct order ranks (max rank + 1).
    pub rank_count: u32,
}

/// Per-sample output (ABI v1.1 sample slots 13–15).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DistSample {
    pub spatial: f32,
    pub rank: i32,
    pub group: i32,
}

/// mulberry32 step (u32), identical to the TS port.
fn next_random(state: &mut u32) -> u32 {
    *state = state.wrapping_add(0x6d2b_79f5);
    let s = *state;
    let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
    t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
    t ^ (t >> 14)
}

/// Seeded Fisher–Yates permutation of 0..count.
pub fn permutation(count: usize, seed: u32) -> Vec<u32> {
    let mut perm: Vec<u32> = (0..count as u32).collect();
    let mut state = seed;
    for i in (1..count).rev() {
        let j = (next_random(&mut state) % (i as u32 + 1)) as usize;
        perm.swap(i, j);
    }
    perm
}

/// Wraps to [0, 1).
fn wrap01(v: f32) -> f32 {
    v - v.floor()
}

impl Distribution {
    /// Order rank of a fixture (−1 = none).
    pub fn fixture_rank(&self, fixture: usize) -> i32 {
        self.ranks.get(fixture).copied().unwrap_or(-1)
    }

    /// True when grouping applies.
    pub fn has_grouping(&self) -> bool {
        self.grouping != Grouping::None && self.grouping_n >= 1
    }

    /// Spatial position of a point for the gradient modes.
    fn gradient_spatial(&self, x: f32, y: f32) -> f32 {
        let (ex, ey) = (self.end.0 - self.origin.0, self.end.1 - self.origin.1);
        let len = (ex * ex + ey * ey).sqrt().max(1e-4);
        let (px, py) = (x - self.origin.0, y - self.origin.1);
        match self.mode {
            Mode::Linear => (px * ex + py * ey) / (len * len),
            Mode::Mirror => ((px * ex + py * ey) / (len * len)).abs(),
            Mode::Radial => (px * px + py * py).sqrt() / len,
            Mode::Conical => wrap01((py.atan2(px) - ey.atan2(ex)) / core::f32::consts::TAU),
            _ => 0.0,
        }
    }

    /// `spatial`, `rank` and `distGroup` of one sample. `perms` caches
    /// random-grouping permutations by rank count for the current frame.
    pub fn sample(&self, x: f32, y: f32, fixture: usize, head: usize, head_count: usize, perms: &mut HashMap<usize, Vec<u32>>) -> DistSample {
        let heads = head_count.max(1);
        let fixture_rank = self.fixture_rank(fixture);
        let mut spatial = 0.0f32;
        let mut rank = -1i32;
        let mut count = 0usize;

        if self.scope == Scope::Within {
            rank = head as i32;
            count = heads;
            spatial = if self.within_order && fixture_rank >= 0 && self.rank_count > 0 {
                (fixture_rank as f32 + head as f32 / heads as f32) / self.rank_count as f32
            } else {
                head as f32 / heads as f32
            };
        } else if self.mode == Mode::Order {
            if fixture_rank >= 0 && self.rank_count > 0 {
                rank = fixture_rank;
                count = self.rank_count as usize;
                spatial = rank as f32 / count as f32;
            }
        } else if self.mode.is_gradient() {
            spatial = self.gradient_spatial(x, y);
        }

        let mut group = -1i32;
        if self.has_grouping() {
            if self.scope == Scope::Across && self.mode.is_gradient() {
                rank = ((spatial.clamp(0.0, 1.0) * QUANTIZED_RANKS as f32).floor() as i32).min(QUANTIZED_RANKS as i32 - 1);
                count = QUANTIZED_RANKS;
            }
            if rank >= 0 && count > 0 {
                let n = self.grouping_n as i32;
                group = match self.grouping {
                    Grouping::EveryN => rank % n,
                    Grouping::Sections => ((rank as i64 * n as i64) / count as i64).min(n as i64 - 1) as i32,
                    Grouping::Random => {
                        let perm = perms.entry(count).or_insert_with(|| permutation(count, self.grouping_seed));
                        (perm[rank as usize] % n as u32) as i32
                    }
                    Grouping::None => -1,
                };
                spatial = group as f32 / n as f32;
            }
        }

        if self.reverse {
            spatial = 1.0 - spatial;
        }
        DistSample { spatial, rank, group }
    }

    /// Frame-level counts (ABI v1.1 frame slots 9–10).
    pub fn frame_counts(&self, max_heads: usize) -> (u32, u32) {
        let rc = if self.scope == Scope::Within {
            max_heads.max(1) as u32
        } else if self.mode == Mode::Order {
            self.rank_count
        } else if self.mode.is_gradient() && self.has_grouping() {
            QUANTIZED_RANKS as u32
        } else {
            0
        };
        (rc, if self.has_grouping() && rc > 0 { self.grouping_n } else { 0 })
    }
}

#[cfg(test)]
#[path = "distribution_tests.rs"]
mod tests;
