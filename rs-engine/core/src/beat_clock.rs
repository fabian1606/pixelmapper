// ── Beat clock ───────────────────────────────────
//
// `beat_time(t)` = piecewise integral of the BPM since the clock epoch
// (ADR §6.5 step 1). BPM changes are timestamped (ms since the epoch), so
// every client that receives the same changes computes the same beat time,
// and the beat position stays continuous across a change (no phase jump).
//
// Tap alignment (`align_to`) moves the beat grid onto a tap without a jump:
// like a DJ's pitch-bend nudge, the clock runs slightly faster or slower for
// `NUDGE_BEATS` beats (one extra segment) and then returns to the tempo. A
// scheduled return segment lies in the future; a tempo change during the
// nudge keeps the correction that is still outstanding.

/// One constant-tempo segment starting at `start_ms`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Segment {
    start_ms: f32,
    bpm: f32,
    /// Beat time at `start_ms`.
    start_beat: f32,
    /// End of a nudge: the tempo returns here (the segment before is the nudge).
    settles: bool,
}

/// Piecewise-constant tempo map.
#[derive(Debug, Clone)]
pub struct BeatClock {
    segments: Vec<Segment>,
}

/// Segments kept before old ones are folded (bounded memory).
const MAX_SEGMENTS: usize = 64;

/// Beats over which a phase correction is spread (max ±0.5 beat → ±12.5 % tempo).
pub const NUDGE_BEATS: f32 = 4.0;

impl BeatClock {
    /// A clock at `bpm` from the epoch.
    pub fn new(bpm: f32) -> Self {
        Self { segments: vec![Segment { start_ms: 0.0, bpm: bpm.max(0.0), start_beat: 0.0, settles: false }] }
    }

    /// Target tempo (of the last segment; a running nudge ends there).
    pub fn bpm(&self) -> f32 {
        self.segments.last().map(|s| s.bpm).unwrap_or(120.0)
    }

    /// Records a tempo change at `at_ms`. No-op when the tempo is unchanged.
    /// Changes earlier than the last segment start replace the tail; a nudge
    /// still running at `at_ms` is re-spread at the new tempo.
    pub fn set_bpm(&mut self, bpm: f32, at_ms: f32) {
        let bpm = bpm.max(0.0);
        if (self.bpm() - bpm).abs() < 1e-6 {
            return;
        }
        let outstanding = self.outstanding_shift(at_ms);
        self.truncate_after(at_ms);
        self.push(at_ms, bpm, false);
        if outstanding.abs() > 1e-6 {
            self.shift(outstanding, at_ms);
        }
    }

    /// Moves the beat grid so the tap at `tap_ms` lands on the nearest whole
    /// beat. The correction starts at `now_ms` and is spread over
    /// `NUDGE_BEATS` beats; a newer tap replaces an unfinished correction.
    pub fn align_to(&mut self, tap_ms: f32, now_ms: f32) {
        // Without the running nudge: where would the tap be on the plain grid?
        let outstanding = self.outstanding_shift(now_ms);
        let tap_beat = self.beat_time(tap_ms) + outstanding;
        let error = tap_beat.round() - tap_beat;
        let bpm = self.bpm();
        self.truncate_after(now_ms);
        self.push(now_ms, bpm, false);
        self.shift(outstanding + error, now_ms);
    }

    /// Beats a running nudge still adds at `at_ms` (relative to the tempo).
    fn outstanding_shift(&self, at_ms: f32) -> f32 {
        let n = self.segments.len();
        if n < 2 {
            return 0.0;
        }
        let (nudge, settle) = (self.segments[n - 2], self.segments[n - 1]);
        if !settle.settles || settle.start_ms <= at_ms || nudge.start_ms > at_ms {
            return 0.0;
        }
        (settle.start_ms - at_ms) * (nudge.bpm - settle.bpm) / 60000.0
    }

    /// Adds `beats` of phase from `at_ms` over `NUDGE_BEATS` beats: a nudge
    /// segment at a scaled tempo, then the tempo again (future segment).
    fn shift(&mut self, beats: f32, at_ms: f32) {
        let bpm = self.bpm();
        if bpm <= 0.0 || beats.abs() < 1e-6 {
            return;
        }
        let duration_ms = NUDGE_BEATS * 60000.0 / bpm;
        self.truncate_after(at_ms);
        // Replaces the plain segment at `at_ms` (if any) with the nudge.
        if self.segments.len() > 1 && self.segments.last().map(|s| s.start_ms == at_ms).unwrap_or(false) {
            self.segments.pop();
        }
        self.push(at_ms, bpm * (1.0 + beats / NUDGE_BEATS), false);
        self.push(at_ms + duration_ms, bpm, true);
    }

    /// Drops segments that start after `at_ms` (scheduled nudge returns).
    fn truncate_after(&mut self, at_ms: f32) {
        while self.segments.len() > 1 && self.segments.last().map(|s| s.start_ms > at_ms).unwrap_or(false) {
            self.segments.pop();
        }
    }

    /// Appends a segment at `at_ms` continuing the beat time there.
    fn push(&mut self, at_ms: f32, bpm: f32, settles: bool) {
        let start_beat = self.beat_time(at_ms);
        self.segments.push(Segment { start_ms: at_ms, bpm, start_beat, settles });
        if self.segments.len() > MAX_SEGMENTS {
            self.segments.remove(0);
        }
    }

    /// Beats elapsed at `t_ms` (ms since the epoch).
    pub fn beat_time(&self, t_ms: f32) -> f32 {
        let seg = self
            .segments
            .iter()
            .rev()
            .find(|s| s.start_ms <= t_ms)
            .or_else(|| self.segments.first())
            .copied()
            .unwrap_or(Segment { start_ms: 0.0, bpm: 120.0, start_beat: 0.0, settles: false });
        seg.start_beat + (t_ms - seg.start_ms) * seg.bpm / 60000.0
    }

    /// Resets to a single segment (new epoch).
    pub fn reset(&mut self, bpm: f32) {
        *self = Self::new(bpm);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_tempo() {
        let c = BeatClock::new(120.0);
        assert_eq!(c.beat_time(0.0), 0.0);
        assert!((c.beat_time(1500.0) - 3.0).abs() < 1e-5);
    }

    #[test]
    fn bpm_change_mid_cycle_is_continuous() {
        let mut c = BeatClock::new(120.0);
        let before = c.beat_time(1250.0); // 2.5 beats, mid-cycle
        c.set_bpm(60.0, 1250.0);
        assert!((c.beat_time(1250.0) - before).abs() < 1e-5, "no jump at the change");
        // 1 s at 60 bpm adds exactly one beat.
        assert!((c.beat_time(2250.0) - 3.5).abs() < 1e-5);
        // Times before the change still use the old tempo.
        assert!((c.beat_time(500.0) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn same_changes_give_same_beat_time() {
        let mut a = BeatClock::new(128.0);
        let mut b = BeatClock::new(128.0);
        for c in [&mut a, &mut b] {
            c.set_bpm(140.0, 4000.0);
            c.set_bpm(90.0, 9000.0);
        }
        assert_eq!(a.beat_time(12345.0), b.beat_time(12345.0));
    }

    #[test]
    fn align_moves_the_grid_onto_the_tap_without_a_jump() {
        let mut c = BeatClock::new(120.0);
        // Tap at 1100 ms = beat 2.2 → grid must move back by 0.2 beat.
        let before = c.beat_time(1100.0);
        c.align_to(1100.0, 1100.0);
        assert!((c.beat_time(1100.0) - before).abs() < 1e-5, "no jump at the tap");
        // Slower while nudging, then back at 120 bpm.
        assert!(c.beat_time(1600.0) - c.beat_time(1100.0) < 1.0);
        assert_eq!(c.bpm(), 120.0);
        // After the nudge (4 beats = 2 s) the tap time sits on a whole beat:
        // every 500 ms after it is a whole beat again.
        let b = c.beat_time(1100.0 + 3000.0);
        assert!((b - b.round()).abs() < 1e-4, "on the grid after the nudge: {b}");
    }

    #[test]
    fn steady_tempo_calls_keep_the_nudge() {
        let mut c = BeatClock::new(120.0);
        c.align_to(1100.0, 1100.0);
        // The worker re-sends the tempo every frame.
        c.set_bpm(120.0, 1500.0);
        let b = c.beat_time(4100.0);
        assert!((b - b.round()).abs() < 1e-4);
    }

    #[test]
    fn tempo_change_mid_nudge_keeps_the_outstanding_correction() {
        let mut c = BeatClock::new(120.0);
        c.align_to(1100.0, 1100.0); // -0.2 beat
        c.set_bpm(60.0, 1600.0);
        // Plain grid at 60 bpm from 1600 ms, minus the 0.2 beat correction.
        let plain = BeatClock::new(120.0).beat_time(1600.0) + (20000.0 - 1600.0) / 1000.0;
        assert!((c.beat_time(20000.0) - (plain - 0.2)).abs() < 1e-3);
    }

    #[test]
    fn repeated_taps_converge_to_the_same_grid() {
        let mut c = BeatClock::new(120.0);
        c.align_to(1100.0, 1100.0);
        c.align_to(1600.0, 1600.0); // same grid, mid-nudge: nothing new to correct
        let b = c.beat_time(5000.0 + 100.0);
        assert!((b - b.round()).abs() < 1e-3, "{b}");
    }

    #[test]
    fn unchanged_bpm_adds_no_segment_and_late_changes_replace_tail() {
        let mut c = BeatClock::new(120.0);
        c.set_bpm(120.0, 1000.0);
        assert_eq!(c.segments.len(), 1);
        c.set_bpm(60.0, 5000.0);
        c.set_bpm(90.0, 3000.0); // arrives late: replaces the 5000 ms change
        assert_eq!(c.segments.len(), 2);
        assert_eq!(c.bpm(), 90.0);
    }
}
