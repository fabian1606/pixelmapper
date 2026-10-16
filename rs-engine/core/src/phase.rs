// ── Modifier phase ───────────────────────────────
//
// Phase accumulation moved out of every effect into the core (ADR D5, §6.5).
// Phase is measured in cycles (1.0 = one full cycle) and derived from the
// shared clock, so it is identical on every client:
//   phase = speed phase(time, beat time) − spatial (distribution.rs, ADR A20).

use crate::types::{SpeedConfig, SpeedMode};

/// Temporal phase in cycles.
/// - time: `t / timeMs`
/// - beat: `(beatTime + beatOffset) / beatValue`
/// - infinite: frozen at 0.
pub fn speed_phase(speed: &SpeedConfig, time_ms: f32, beat_time: f32) -> f32 {
    match speed.mode {
        SpeedMode::Time if speed.time_ms > 0.0 => time_ms / speed.time_ms,
        SpeedMode::Beat if speed.beat_value > 0.0 => (beat_time + speed.beat_offset) / speed.beat_value,
        _ => 0.0,
    }
}

/// Cycles per second of a speed setting (0 = frozen).
pub fn phase_speed(speed: &SpeedConfig, bpm: f32) -> f32 {
    match speed.mode {
        SpeedMode::Time if speed.time_ms > 0.0 => 1000.0 / speed.time_ms,
        SpeedMode::Beat if speed.beat_value > 0.0 => bpm / 60.0 / speed.beat_value,
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speed(mode: SpeedMode) -> SpeedConfig {
        SpeedConfig { mode, time_ms: 500.0, beat_value: 2.0, beat_offset: 0.5 }
    }

    #[test]
    fn speed_modes() {
        assert!((speed_phase(&speed(SpeedMode::Time), 1250.0, 0.0) - 2.5).abs() < 1e-6);
        assert!((speed_phase(&speed(SpeedMode::Beat), 0.0, 3.5) - 2.0).abs() < 1e-6);
        assert_eq!(speed_phase(&speed(SpeedMode::Infinite), 9999.0, 99.0), 0.0);
        assert!((phase_speed(&speed(SpeedMode::Time), 120.0) - 2.0).abs() < 1e-6);
        assert!((phase_speed(&speed(SpeedMode::Beat), 120.0) - 1.0).abs() < 1e-6);
    }
}
