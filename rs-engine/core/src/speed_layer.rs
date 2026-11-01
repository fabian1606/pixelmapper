// ── Speed layer ──────────────────────────────────
//
// Layer 2 of the tempo model (architecture/engine.md): the global speed
// multiplier `m` on top of the base beat `B` (layer 1, `BeatClock`: base
// tempo + tap nudges).
//
//   E(B) = e0 + m · (B − b0) + nudge(B)   effective beat → beat-mode modifiers
//   T(t) = t0 + m · (t − ts)              speed time (ms) → time-mode modifiers
//
// A speed change is quantized: it waits for the next *common* beat — a whole
// base beat where `E` is whole too — so the new grid stays phase-locked to
// the music (×1 → ×2: next base beat; ×1 → ×½: within 2 beats). `E` and `T`
// stay continuous across a switch. When no common beat exists (unfreeze,
// fader values like ×1.37) the switch happens at the next base beat and a
// short nudge slides `E` onto a whole beat when the new speed can lock.

use crate::beat_clock::NUDGE_BEATS;

/// Tolerance for "on a whole beat".
const WHOLE_EPS: f32 = 1e-3;

/// A pending speed change.
#[derive(Debug, Clone, Copy)]
struct Pending {
    speed: f32,
    /// Next whole base beat to check.
    candidate: f32,
}

/// Global speed multiplier with beat-quantized switching.
#[derive(Debug, Clone)]
pub struct SpeedLayer {
    speed: f32,
    /// Base beat / effective beat at the last switch.
    b0: f32,
    e0: f32,
    /// Wall time (ms since epoch) / speed time at the last switch.
    ts: f32,
    t0: f32,
    /// Beats of correction spread linearly over `NUDGE_BEATS` base beats from `b0`.
    nudge: f32,
    pending: Option<Pending>,
    /// Last update (wall ms, base beat) — used to interpolate switch times.
    last: Option<(f32, f32)>,
}

/// True when the beat grid of `m` can coincide with the base grid (×n, ×1/n).
fn lockable(m: f32) -> bool {
    if m <= 0.0 {
        return false;
    }
    let near_int = |x: f32| (x - x.round()).abs() < WHOLE_EPS;
    near_int(m) || near_int(1.0 / m)
}

/// Signed distance to the nearest whole beat.
fn off_grid(e: f32) -> f32 {
    e.round() - e
}

impl SpeedLayer {
    /// A layer running at `speed` from the epoch.
    pub fn new(speed: f32) -> Self {
        Self { speed: speed.max(0.0), b0: 0.0, e0: 0.0, ts: 0.0, t0: 0.0, nudge: 0.0, pending: None, last: None }
    }

    /// Restarts at the epoch (new clock epoch); a pending change applies right away.
    pub fn reset(&mut self) {
        let speed = self.pending.map(|p| p.speed).unwrap_or(self.speed);
        *self = Self::new(speed);
    }

    /// Active multiplier.
    pub fn speed(&self) -> f32 {
        self.speed
    }

    /// Requests a new multiplier at base beat `b_now`; replaces a pending one.
    pub fn request(&mut self, speed: f32, b_now: f32) {
        let speed = speed.max(0.0);
        if (speed - self.speed).abs() < 1e-6 {
            self.pending = None;
            return;
        }
        self.pending = Some(Pending { speed, candidate: b_now.ceil() });
    }

    /// Advances to wall time `t_ms` at base beat `b`, applying a pending
    /// change when its switch beat was crossed.
    pub fn update(&mut self, t_ms: f32, b: f32) {
        let (last_t, last_b) = self.last.unwrap_or((t_ms, b));
        while let Some(p) = self.pending {
            if b < p.candidate {
                break;
            }
            let e = self.beat(p.candidate);
            let can_wait = lockable(self.speed) && lockable(p.speed) && self.speed < 1.0;
            if can_wait && off_grid(e).abs() > WHOLE_EPS {
                // Not a common beat yet (e.g. ×½ on an odd base beat): try the next one.
                self.pending = Some(Pending { candidate: p.candidate + 1.0, ..p });
                continue;
            }
            // Wall time at which the base beat crossed the candidate.
            let ts = if b > last_b { last_t + (p.candidate - last_b) / (b - last_b) * (t_ms - last_t) } else { t_ms };
            let ts = ts.clamp(last_t.min(t_ms), t_ms);
            let t0 = self.time(ts);
            self.nudge = if lockable(p.speed) { off_grid(e) } else { 0.0 };
            if self.nudge.abs() <= WHOLE_EPS {
                self.nudge = 0.0;
            }
            self.speed = p.speed;
            self.b0 = p.candidate;
            self.e0 = e;
            self.ts = ts;
            self.t0 = t0;
            self.pending = None;
        }
        self.last = Some((t_ms, b));
    }

    /// Effective beat at base beat `b`.
    pub fn beat(&self, b: f32) -> f32 {
        let ramp = ((b - self.b0) / NUDGE_BEATS).clamp(0.0, 1.0);
        self.e0 + self.speed * (b - self.b0) + self.nudge * ramp
    }

    /// Speed time (ms) at wall time `t_ms`.
    pub fn time(&self, t_ms: f32) -> f32 {
        self.t0 + self.speed * (t_ms - self.ts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::beat_clock::BeatClock;

    /// Runs `layer` frame by frame (10 ms) over `clock` from `from` to `to` ms.
    fn run(layer: &mut SpeedLayer, clock: &BeatClock, from: f32, to: f32) {
        let mut t = from;
        while t <= to {
            layer.update(t, clock.beat_time(t));
            t += 10.0;
        }
    }

    fn whole(x: f32) -> bool {
        (x - x.round()).abs() < 1e-2
    }

    #[test]
    fn double_switches_at_the_next_base_beat_and_stays_locked() {
        let clock = BeatClock::new(120.0); // 500 ms per beat
        let mut s = SpeedLayer::new(1.0);
        run(&mut s, &clock, 0.0, 1250.0); // B = 2.5
        s.request(2.0, clock.beat_time(1250.0));
        let before = s.beat(clock.beat_time(1260.0));
        run(&mut s, &clock, 1260.0, 1490.0);
        assert_eq!(s.speed(), 1.0, "still ×1 before the beat");
        assert!((s.beat(clock.beat_time(1260.0)) - before).abs() < 1e-4);
        run(&mut s, &clock, 1500.0, 4000.0);
        assert_eq!(s.speed(), 2.0);
        // Continuous at the switch beat (B = 3 → E = 3), then twice as fast and whole on every base beat.
        assert!((s.beat(3.0) - 3.0).abs() < 1e-4);
        for b in [4.0, 5.0, 6.0, 7.0] {
            assert!(whole(s.beat(b)), "E({b}) = {}", s.beat(b));
        }
        assert!((s.beat(5.0) - 7.0).abs() < 1e-4);
    }

    #[test]
    fn half_waits_for_a_common_beat() {
        let clock = BeatClock::new(120.0);
        let mut s = SpeedLayer::new(0.5);
        // E = 0.5 B: whole on even base beats. Request at B = 2.5 → switch at B = 4, not 3.
        run(&mut s, &clock, 0.0, 1250.0);
        s.request(1.0, clock.beat_time(1250.0));
        run(&mut s, &clock, 1260.0, 1990.0); // until B ≈ 3.98
        assert_eq!(s.speed(), 0.5);
        run(&mut s, &clock, 2000.0, 3000.0);
        assert_eq!(s.speed(), 1.0);
        assert!((s.beat(4.0) - 2.0).abs() < 1e-4);
        assert!(whole(s.beat(5.0)));
    }

    #[test]
    fn speed_time_is_continuous_and_scaled() {
        let clock = BeatClock::new(120.0);
        let mut s = SpeedLayer::new(1.0);
        run(&mut s, &clock, 0.0, 1250.0);
        s.request(2.0, clock.beat_time(1250.0));
        run(&mut s, &clock, 1260.0, 3000.0);
        // Switch at 1500 ms: T = 1500 there, then twice as fast.
        assert!((s.time(1500.0) - 1500.0).abs() < 1.0);
        assert!((s.time(2500.0) - 3500.0).abs() < 1.0);
    }

    #[test]
    fn odd_fader_values_switch_at_the_next_beat_and_relock_via_nudge() {
        let clock = BeatClock::new(120.0);
        let mut s = SpeedLayer::new(1.0);
        run(&mut s, &clock, 0.0, 1000.0); // B = 2
        s.request(1.37, clock.beat_time(1000.0) + 0.1);
        run(&mut s, &clock, 1010.0, 2000.0);
        assert_eq!(s.speed(), 1.37, "switched at the next base beat");
        // Back to ×1: off grid now → switches at the next base beat, then a nudge.
        s.request(1.0, clock.beat_time(2000.0) + 0.1);
        let switch_b = 5.0;
        run(&mut s, &clock, 2010.0, 6000.0);
        assert_eq!(s.speed(), 1.0);
        let after = s.beat(switch_b + NUDGE_BEATS);
        assert!(whole(after), "locked after the nudge: {after}");
        assert!(whole(s.beat(switch_b + NUDGE_BEATS + 1.0)));
    }

    #[test]
    fn freeze_and_resume_without_a_jump() {
        let clock = BeatClock::new(120.0);
        let mut s = SpeedLayer::new(1.0);
        run(&mut s, &clock, 0.0, 1100.0);
        s.request(0.0, clock.beat_time(1100.0));
        run(&mut s, &clock, 1110.0, 2000.0);
        assert_eq!(s.speed(), 0.0);
        let frozen = s.beat(clock.beat_time(1800.0));
        assert!((s.beat(clock.beat_time(2000.0)) - frozen).abs() < 1e-4, "stands still");
        s.request(1.0, clock.beat_time(2000.0) + 0.2);
        run(&mut s, &clock, 2010.0, 3000.0);
        assert_eq!(s.speed(), 1.0);
        assert!((s.beat(5.0) - frozen).abs() < 1e-4, "resumes where it stood");
    }

    #[test]
    fn newer_request_replaces_the_pending_one() {
        let clock = BeatClock::new(120.0);
        let mut s = SpeedLayer::new(1.0);
        run(&mut s, &clock, 0.0, 1250.0);
        s.request(2.0, 2.5);
        s.request(4.0, 2.6);
        run(&mut s, &clock, 1260.0, 2000.0);
        assert_eq!(s.speed(), 4.0);
        s.request(4.0, 4.1); // same as active: nothing pending
        assert!(s.pending.is_none());
    }

    #[test]
    fn tap_nudge_on_the_base_clock_keeps_the_multiplier() {
        let mut clock = BeatClock::new(120.0);
        let mut s = SpeedLayer::new(1.0);
        run(&mut s, &clock, 0.0, 1000.0);
        s.request(2.0, clock.beat_time(1000.0));
        run(&mut s, &clock, 1010.0, 1100.0);
        assert_eq!(s.speed(), 2.0);
        clock.align_to(1100.0, 1100.0); // tap 0.2 beat late
        run(&mut s, &clock, 1110.0, 5000.0);
        assert_eq!(s.speed(), 2.0);
        // After the base nudge the tap time is a whole base beat, and E is whole there.
        let b = clock.beat_time(4100.0);
        assert!(whole(b));
        assert!(whole(s.beat(b)));
    }
}
