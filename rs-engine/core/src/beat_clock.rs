// ── Beat clock ───────────────────────────────────
//
// `beat_time(t)` = piecewise integral of the BPM since the clock epoch
// (ADR §6.5 step 1). BPM changes are timestamped (ms since the epoch), so
// every client that receives the same changes computes the same beat time,
// and the beat position stays continuous across a change (no phase jump).

/// One constant-tempo segment starting at `start_ms`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Segment {
    start_ms: f32,
    bpm: f32,
    /// Beat time at `start_ms`.
    start_beat: f32,
}

/// Piecewise-constant tempo map.
#[derive(Debug, Clone)]
pub struct BeatClock {
    segments: Vec<Segment>,
}

/// Segments kept before old ones are folded (bounded memory).
const MAX_SEGMENTS: usize = 64;

impl BeatClock {
    /// A clock at `bpm` from the epoch.
    pub fn new(bpm: f32) -> Self {
        Self { segments: vec![Segment { start_ms: 0.0, bpm: bpm.max(0.0), start_beat: 0.0 }] }
    }

    /// Current tempo (of the last segment).
    pub fn bpm(&self) -> f32 {
        self.segments.last().map(|s| s.bpm).unwrap_or(120.0)
    }

    /// Records a tempo change at `at_ms`. No-op when the tempo is unchanged.
    /// Changes earlier than the last segment start replace the tail.
    pub fn set_bpm(&mut self, bpm: f32, at_ms: f32) {
        let bpm = bpm.max(0.0);
        if (self.bpm() - bpm).abs() < 1e-6 {
            return;
        }
        while self.segments.len() > 1 && self.segments.last().map(|s| s.start_ms > at_ms).unwrap_or(false) {
            self.segments.pop();
        }
        let start_beat = self.beat_time(at_ms);
        self.segments.push(Segment { start_ms: at_ms, bpm, start_beat });
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
            .unwrap_or(Segment { start_ms: 0.0, bpm: 120.0, start_beat: 0.0 });
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
