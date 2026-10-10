// ── Distribution tests ───────────────────────────
//
// Table test per mode/scope/grouping/reverse (plan M3.5). The table is shared
// with the TS port (`app/utils/engine/distribution/sample.test.ts`).

use super::*;
use serde_json::Value;

const TABLE: &str = include_str!("distribution_table.json");

/// Builds a distribution from a table case; fixture `i` gets rank `ranks[i]`.
fn dist_of(v: &Value, ranks: Vec<i32>, rank_count: u32) -> Distribution {
    let s = |k: &str| v.get(k).and_then(Value::as_str);
    let pt = |k: &str, d: (f32, f32)| {
        v.get(k).and_then(Value::as_array).map(|a| (a[0].as_f64().unwrap() as f32, a[1].as_f64().unwrap() as f32)).unwrap_or(d)
    };
    let g = v.get("grouping");
    Distribution {
        scope: if s("scope") == Some("within") { Scope::Within } else { Scope::Across },
        mode: match s("mode").unwrap_or("none") {
            "linear" => Mode::Linear,
            "radial" => Mode::Radial,
            "conical" => Mode::Conical,
            "order" => Mode::Order,
            _ => Mode::None,
        },
        origin: pt("origin", (0.4, 0.5)),
        end: pt("end", (0.6, 0.5)),
        reverse: v.get("reverse").and_then(Value::as_bool).unwrap_or(false),
        grouping: match g.and_then(|g| g.get("kind")).and_then(Value::as_str).unwrap_or("none") {
            "everyN" => Grouping::EveryN,
            "sections" => Grouping::Sections,
            "random" => Grouping::Random,
            _ => Grouping::None,
        },
        grouping_n: g.and_then(|g| g.get("n")).and_then(Value::as_u64).unwrap_or(2) as u32,
        grouping_seed: g.and_then(|g| g.get("seed")).and_then(Value::as_u64).unwrap_or(1) as u32,
        within_order: s("withinOffset") == Some("order"),
        ranks,
        rank_count,
    }
}

#[test]
fn permutations_match_the_table() {
    let table: Value = serde_json::from_str(TABLE).unwrap();
    for p in table["permutations"].as_array().unwrap() {
        let want: Vec<u32> = p["perm"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u32).collect();
        assert_eq!(permutation(p["count"].as_u64().unwrap() as usize, p["seed"].as_u64().unwrap() as u32), want);
    }
}

#[test]
fn table_cases() {
    let table: Value = serde_json::from_str(TABLE).unwrap();
    for case in table["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let samples = case["samples"].as_array().unwrap();
        let ranks: Vec<i32> = samples.iter().map(|s| s["fixtureRank"].as_i64().unwrap() as i32).collect();
        let d = dist_of(&case["dist"], ranks, case["rankCount"].as_u64().unwrap() as u32);
        let mut perms = HashMap::new();
        for (i, s) in samples.iter().enumerate() {
            let f = |k: &str| s[k].as_f64().unwrap() as f32;
            let out = d.sample(f("x"), f("y"), i, s["head"].as_u64().unwrap() as usize, s["headCount"].as_u64().unwrap() as usize, &mut perms);
            let e = s["expect"].as_array().unwrap();
            assert!((out.spatial - e[0].as_f64().unwrap() as f32).abs() < 1e-5, "{name} #{i}: spatial {} vs {}", out.spatial, e[0]);
            assert_eq!(out.rank, e[1].as_i64().unwrap() as i32, "{name} #{i}: rank");
            assert_eq!(out.group, e[2].as_i64().unwrap() as i32, "{name} #{i}: group");
        }
    }
}

#[test]
fn mirror_mode_is_absolute_linear() {
    let d = Distribution { mode: Mode::Mirror, origin: (0.5, 0.0), end: (0.75, 0.0), ..Default::default() };
    let mut perms = HashMap::new();
    assert!((d.sample(0.25, 0.0, 0, 0, 1, &mut perms).spatial - 1.0).abs() < 1e-6);
    assert!((d.sample(0.75, 0.0, 0, 0, 1, &mut perms).spatial - 1.0).abs() < 1e-6);
}

#[test]
fn frame_counts() {
    let mut d = Distribution { mode: Mode::Order, rank_count: 5, ..Default::default() };
    assert_eq!(d.frame_counts(1), (5, 0));
    d.grouping = Grouping::EveryN;
    d.grouping_n = 2;
    assert_eq!(d.frame_counts(1), (5, 2));
    d.mode = Mode::Linear;
    assert_eq!(d.frame_counts(1), (16, 2));
    d.scope = Scope::Within;
    assert_eq!(d.frame_counts(8), (8, 2));
}
