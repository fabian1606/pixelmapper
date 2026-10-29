-- ============================================================
-- Tests for migration 015 (snapshot highlights). Run through
-- supabase/tests/run-sql-tests.sh (throwaway postgres:16 container).
--
-- Snapshot A → B covers every category at once; further cases cover
-- no-op changes, numeric/string ids, pairing (neighbour / explicit /
-- foreign compareTo / equal sequence numbers), layout indices against
-- snapshot_preview_layout, the payload cap and access control.
-- ============================================================

\set ON_ERROR_STOP 1
\o /dev/null

-- ── Assertion helper ────────────────────────────────────────
-- Raises when two jsonb values differ.
create function pg_temp.eq(p_label text, p_actual jsonb, p_expected jsonb) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '%: expected %, got %', p_label, p_expected, p_actual;
  end if;
end;
$$;

-- ── Snapshots A (older) and B (newer) ───────────────────────
create temp table snaps (tag text primary key, data jsonb);
insert into snaps values ('A', $j${
  "schemaVersion": 3, "clockEpoch": 1, "globalBpm": 120,
  "sceneNodes": [
    {"_type": "group", "id": "g1", "name": "Truss", "expanded": true, "children": [
      {"_type": "fixture", "id": "f1", "name": "F1", "fixturePosition": {"x": 0.1, "y": 0.11}},
      {"_type": "group", "id": "g2", "name": "Inner", "expanded": true, "children": [
        {"_type": "fixture", "id": "f2", "name": "F2", "fixturePosition": {"x": 0.2, "y": 0.21}}
      ]}
    ]},
    {"_type": "fixture", "id": 3, "name": "F3", "fixturePosition": {"x": 0.3, "y": 0.31}},
    {"_type": "fixture", "id": "f4", "name": "no position"},
    {"_type": "fixture", "id": "f5", "name": "F5", "fixturePosition": {"x": 0.5, "y": 0.51}}
  ],
  "modifiers": [
    {"id": "m1", "plugin": "sha256:aa", "strength": 1, "params": {"color": "#ff0000", "size": 2}},
    {"id": "m3", "plugin": "sha256:cc", "strength": 1, "params": {}}
  ],
  "savedPresets": [
    {"id": "p1", "name": "One", "createdAt": "2026-01-01", "categories": []},
    {"id": "p2", "name": "Two", "createdAt": "2026-01-01", "categories": []}
  ],
  "livePages": [
    {"id": "L1", "name": "Main", "widgets": [
      {"id": "w1", "type": "button", "label": "Go"},
      {"id": "w2", "type": "slider", "label": "Dim"}
    ], "sections": []},
    {"id": "L2", "name": "Old", "widgets": []}
  ]
}$j$);

insert into snaps values ('B', $j${
  "schemaVersion": 3, "clockEpoch": 2, "globalBpm": 128,
  "sceneNodes": [
    {"_type": "group", "id": "g1", "name": "Truss", "expanded": false, "children": [
      {"_type": "fixture", "id": "f1", "name": "F1", "fixturePosition": {"x": 0.15, "y": 0.11}},
      {"_type": "fixture", "id": "f2", "name": "F2", "fixturePosition": {"x": 0.2, "y": 0.21}},
      {"_type": "group", "id": "g2", "name": "Inner", "expanded": true, "children": []}
    ]},
    {"_type": "fixture", "id": 3, "name": "F3 renamed", "fixturePosition": {"x": 0.3, "y": 0.31}},
    {"_type": "fixture", "id": "f4", "name": "no position"},
    {"_type": "fixture", "id": "f6", "name": "F6", "fixturePosition": {"x": 0.6, "y": 0.61}}
  ],
  "modifiers": [
    {"id": "m2", "plugin": "sha256:bb", "strength": 1, "params": {}, "targetFixtureIds": ["f1", 3, "f4", "nope"]},
    {"id": "m1", "plugin": "sha256:aa", "strength": 0.5, "params": {"color": "#00ff00", "size": 2}}
  ],
  "savedPresets": [
    {"id": "p1", "name": "One", "createdAt": "2026-02-02", "categories": []},
    {"id": "p2", "name": "Two!", "createdAt": "2026-01-01", "categories": []},
    {"id": "p3", "name": "New", "createdAt": "2026-02-02",
     "categories": [{"type": "color", "label": "x", "fixtureIds": ["f6"], "channels": [], "modifiers": []}]}
  ],
  "livePages": [
    {"id": "L1", "name": "Main", "widgets": [
      {"id": "w1", "type": "button", "label": "Go!"},
      {"id": "w3", "type": "xy", "label": "Pos"}
    ], "sections": [{"id": "s1", "source": "all-presets", "mode": "flash", "members": []}]},
    {"id": "L3", "name": "New page", "widgets": [{"id": "w9", "type": "label"}]}
  ]
}$j$);

-- ── A → B: every category ───────────────────────────────────
do $$
declare
  h jsonb := snapshot_highlights_compare((select data from snaps where tag = 'A'),
                                         (select data from snaps where tag = 'B'));
begin
  perform pg_temp.eq('categories', h->'categories', $j${
    "fixtures": {"added": 1, "changed": 3, "removed": 1, "moved": 1, "groups": 2},
    "effect":   {"added": 1, "changed": 1, "removed": 1},
    "preset":   {"added": 1, "changed": 1, "removed": 0},
    "live":     {"added": 1, "changed": 1, "removed": 1},
    "settings": {"added": 0, "changed": 1, "removed": 0}}$j$);
  -- Layout of B: f1 0, f2 1, 3 → 2, f6 3 (f4 has no position).
  perform pg_temp.eq('fixtures', h->'fixtures',
    '{"added": [3], "changed": [0, 1, 2], "moved": [0], "removed": 1}');
  perform pg_temp.eq('fixtureIndex', h->'fixtureIndex', '{"f1": 0, "f2": 1, "3": 2, "f6": 3}');
  perform pg_temp.eq('settings', h->'settings', '["globalBpm"]');
  perform pg_temp.eq('effects', h->'effects', $j${
    "items": [
      {"status": "added", "modifier": {"id": "m2", "plugin": "sha256:bb", "strength": 1, "params": {},
        "targetFixtureIds": ["f1", 3, "f4", "nope"]}, "changedKeys": [], "before": {}},
      {"status": "changed", "modifier": {"id": "m1", "plugin": "sha256:aa", "strength": 0.5,
        "params": {"color": "#00ff00", "size": 2}},
       "changedKeys": ["params.color", "strength"], "before": {"params.color": "#ff0000", "strength": 1}}],
    "removed": [{"id": "m3", "name": "sha256:cc"}]}$j$);
  perform pg_temp.eq('preset ids', jsonb_path_query_array(h, '$.presets.items[*].preset.id'), '["p3", "p2"]');
  perform pg_temp.eq('preset keys', jsonb_path_query_array(h, '$.presets.items[*].changedKeys'), '[[], ["name"]]');
  perform pg_temp.eq('preset removed', h->'presets'->'removed', '[]');
  perform pg_temp.eq('live removed', h->'live'->'removed', '[{"id": "L2", "name": "Old"}]');
  perform pg_temp.eq('live page order', jsonb_path_query_array(h, '$.live.pages[*].page.id'), '["L3", "L1"]');
  perform pg_temp.eq('live added page', (h->'live'->'pages'->0) - 'page', $j${
    "status": "added", "widgets": {"added": ["w9"], "changed": [], "removed": []}, "sectionsChanged": false}$j$);
  perform pg_temp.eq('live changed page', (h->'live'->'pages'->1) - 'page', $j${
    "status": "changed", "sectionsChanged": true,
    "widgets": {"added": ["w3"], "changed": ["w1"], "removed": [{"id": "w2", "type": "slider", "label": "Dim"}]}}$j$);
  perform pg_temp.eq('truncated', h->'truncated', 'false');
end;
$$;
\echo '   A → B categories / fixtures / effects / presets / live / settings: PASS'

-- ── No-op changes ───────────────────────────────────────────
do $$
declare
  a jsonb := (select data from snaps where tag = 'A');
  h jsonb;
begin
  -- clockEpoch, group `expanded`, preset createdAt, fixture `_type`, id 3 → "3".
  h := snapshot_highlights_compare(a,
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(a || '{"clockEpoch": 99}',
      '{sceneNodes,0,expanded}', 'false'),
      '{savedPresets,0,createdAt}', '"2030-01-01"'),
      '{sceneNodes,1,id}', '"3"'),
      '{sceneNodes,1}', (a->'sceneNodes'->1) - '_type' || '{"id": "3"}'));
  perform pg_temp.eq('no-op categories', h->'categories', '{}');
  perform pg_temp.eq('no-op fixtures', h->'fixtures', '{"added": [], "changed": [], "moved": [], "removed": 0}');
  perform pg_temp.eq('no-op settings', h->'settings', '[]');
  -- Settings defaults: missing globalBpm = 120, [] = missing.
  h := snapshot_highlights_compare(a - 'globalBpm' || '{"requires": []}', a);
  perform pg_temp.eq('settings defaults', h->'categories', '{}');
  -- Malformed snapshots compare as empty.
  h := snapshot_highlights_compare('"x"', '[]');
  perform pg_temp.eq('malformed', h->'categories', '{}');
  -- First version.
  h := snapshot_highlights_compare(null, a);
  perform pg_temp.eq('first version', h->'categories', '{}');
  perform pg_temp.eq('first version payloads', h->'effects', '{"items": [], "removed": []}');
end;
$$;
\echo '   clockEpoch / expanded / createdAt / id type no-ops, defaults, first version: PASS'

-- ── Layout indices = snapshot_preview_layout positions ──────
insert into projects (id, name) values
  ('15000000-0000-4000-8000-000000000001', 'highlights'),
  ('15000000-0000-4000-8000-000000000002', 'other');

-- A scene with non-object nodes, groups without children, nested groups,
-- kind fixtures and fixtures without (numeric) positions.
insert into project_snapshots (id, project_id, snapshot, sequence_number, created_at) values
  ('15000000-0000-4000-8000-0000000000f1', '15000000-0000-4000-8000-000000000002', $j${"sceneNodes": [
    5, "x", null,
    {"_type": "group", "id": "ga", "children": [
      {"id": "a1", "fixturePosition": {"x": 0.101, "y": 0.9}},
      {"children": [{"id": "a2", "fixturePosition": {"x": 0.102, "y": 0.9}},
                    {"id": "a3", "fixturePosition": {"x": "0.5", "y": 0.9}},
                    {"id": 77, "fixturePosition": {"x": 0.103, "y": 0.9}}]},
      {"_type": "group", "id": "gempty"}
    ]},
    {"fixturePosition": {"x": 0.104, "y": 0.9}},
    {"id": "a5", "fixturePosition": {"x": 0.105, "y": 0.9}},
    {"id": "a5", "fixturePosition": {"x": 0.106, "y": 0.9}},
    {"id": "a6", "fixturePosition": {"x": 0.107, "y": 0.9}}
  ]}$j$, 1, now());

do $$
declare
  s jsonb := (select snapshot from project_snapshots where id = '15000000-0000-4000-8000-0000000000f1');
  lim integer;
  layout jsonb;
  r record;
  n integer;
begin
  foreach lim in array array[400, 3] loop
    layout := snapshot_preview_layout('15000000-0000-4000-8000-000000000002',
                                      '15000000-0000-4000-8000-0000000000f1', lim);
    n := 0;
    for r in select * from snapshot_layout_index(s, lim) loop
      n := n + 1;
      -- x = 0.1xx encodes the fixture; compare with the layout tuple.
      if (layout->'fixtures'->r.layout_idx->>0)::numeric <> (
           select (w.node->'fixturePosition'->>'x')::numeric
             from snapshot_scene_walk(s) w
            where snapshot_id_key(w.node->'id') = r.fixture_id
            order by w.path limit 1) then
        raise exception 'layout index mismatch for % at % (limit %)', r.fixture_id, r.layout_idx, lim;
      end if;
    end loop;
    -- 400: a1, a2, 77, a5 (first), a6 (+ id-less slot 3, duplicate slot 5).
    if n <> (case when lim = 3 then 3 else 5 end) then
      raise exception 'unexpected index count % (limit %)', n, lim;
    end if;
  end loop;
  perform pg_temp.eq('index of 77 / a5 / a6',
    (select jsonb_object_agg(fixture_id, layout_idx) from snapshot_layout_index(s, 400)),
    '{"a1": 0, "a2": 1, "77": 2, "a5": 4, "a6": 6}');
end;
$$;
\echo '   layout indices match snapshot_preview_layout (incl. cap): PASS'

-- ── Pairing through the RPC ─────────────────────────────────
-- s1 (seq 1, A) < s2 (seq 2, B) < s3 (seq 2, later, = B + bpm) ; foreign: other project.
insert into project_snapshots (id, project_id, snapshot, sequence_number, created_at) values
  ('15000000-0000-4000-8000-0000000000a1', '15000000-0000-4000-8000-000000000001',
   (select data from snaps where tag = 'A'), 1, '2026-10-01 10:00Z'),
  ('15000000-0000-4000-8000-0000000000a2', '15000000-0000-4000-8000-000000000001',
   (select data from snaps where tag = 'B'), 2, '2026-10-01 11:00Z'),
  ('15000000-0000-4000-8000-0000000000a3', '15000000-0000-4000-8000-000000000001',
   (select data from snaps where tag = 'B') || '{"globalBpm": 140}', 2, '2026-10-01 12:00Z');

do $$
declare
  p uuid := '15000000-0000-4000-8000-000000000001';
  h jsonb;
begin
  -- First version.
  h := snapshot_preview_highlights(p, '15000000-0000-4000-8000-0000000000a1');
  perform pg_temp.eq('first previousId', h->'previousId', 'null');
  perform pg_temp.eq('first categories', h->'categories', '{}');
  -- Neighbour with equal sequence numbers: a3 → a2 (only BPM).
  h := snapshot_preview_highlights(p, '15000000-0000-4000-8000-0000000000a3');
  perform pg_temp.eq('neighbour id', h->'previousId', '"15000000-0000-4000-8000-0000000000a2"');
  perform pg_temp.eq('neighbour categories', h->'categories', '{"settings": {"added": 0, "changed": 1, "removed": 0}}');
  -- Explicit compareTo: a3 vs a1.
  h := snapshot_preview_highlights(p, '15000000-0000-4000-8000-0000000000a3', '15000000-0000-4000-8000-0000000000a1');
  perform pg_temp.eq('explicit id', h->'previousId', '"15000000-0000-4000-8000-0000000000a1"');
  perform pg_temp.eq('explicit fixtures', h->'categories'->'fixtures'->'changed', '3');
  -- compareTo of another project / itself is ignored → neighbour.
  h := snapshot_preview_highlights(p, '15000000-0000-4000-8000-0000000000a3', '15000000-0000-4000-8000-0000000000f1');
  perform pg_temp.eq('foreign compareTo', h->'previousId', '"15000000-0000-4000-8000-0000000000a2"');
  h := snapshot_preview_highlights(p, '15000000-0000-4000-8000-0000000000a3', '15000000-0000-4000-8000-0000000000a3');
  perform pg_temp.eq('self compareTo', h->'previousId', '"15000000-0000-4000-8000-0000000000a2"');
  -- Unknown snapshot / snapshot of another project → null.
  perform pg_temp.eq('unknown', snapshot_preview_highlights(p, '15000000-0000-4000-8000-0000000000ff'), null);
  perform pg_temp.eq('other project', snapshot_preview_highlights(p, '15000000-0000-4000-8000-0000000000f1'), null);
end;
$$;
\echo '   pairing: first / neighbour (equal seq) / explicit / foreign / self / unknown: PASS'

-- ── Payload cap ─────────────────────────────────────────────
do $$
declare
  a jsonb := (select data from snaps where tag = 'A');
  big_page jsonb := jsonb_build_object('id', 'BIG', 'name', 'Big', 'widgets', (
    select jsonb_agg(jsonb_build_object('id', 'bw' || g, 'type', 'button', 'label', repeat('x', 200)))
      from generate_series(1, 300) g));
  presets jsonb := (select jsonb_agg(jsonb_build_object('id', 'np' || g, 'name', 'Preset ' || g,
      'categories', jsonb_build_array(jsonb_build_object('fixtureIds', jsonb_build_array('f1'),
        'channels', (select jsonb_agg(jsonb_build_object('channelIndex', c, 'stepValues', '[255, 0, 128]'))
                       from generate_series(1, 20) c)))))
    from generate_series(1, 60) g);
  b jsonb;
  h jsonb;
  cap integer;
begin
  b := jsonb_set(a, '{livePages}', (a->'livePages') || jsonb_build_array(big_page));
  b := jsonb_set(b, '{savedPresets}', (b->'savedPresets') || presets);
  foreach cap in array array[30000, 5000] loop
    h := snapshot_highlights_compare(a, b, 400, cap);
    if octet_length(h::text) + 50 > cap then
      raise exception 'cap %: % bytes', cap, octet_length(h::text);
    end if;
    perform pg_temp.eq('cap truncated', h->'truncated', 'true');
    -- Counts are complete even when payloads are dropped.
    perform pg_temp.eq('cap live count', h->'categories'->'live'->'added', '1');
    perform pg_temp.eq('cap preset count', h->'categories'->'preset'->'added', '60');
    perform pg_temp.eq('big page dropped', jsonb_path_query_array(h, '$.live.pages[*].page.id'), '[]');
  end loop;
  -- 30 KB: some presets fit; first in list order; fixtureIndex follows them.
  h := snapshot_highlights_compare(a, b);
  if jsonb_array_length(h->'presets'->'items') not between 1 and 59 then
    raise exception 'expected some presets, got %', jsonb_array_length(h->'presets'->'items');
  end if;
  perform pg_temp.eq('first preset', h->'presets'->'items'->0->'preset'->'id', '"np1"');
  perform pg_temp.eq('preset fixtureIndex', h->'fixtureIndex'->'f1', '0');
end;
$$;
\echo '   payload cap (large live page, many presets): PASS'

-- ── Access ──────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('15000000-0000-4000-8000-0000000000b1', 'viewer@test'),
  ('15000000-0000-4000-8000-0000000000b2', 'stranger@test');
insert into project_collaborators (project_id, user_id, role, accepted_at) values
  ('15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-0000000000b1', 'viewer', now());

-- Runs the RPC for a3 as p_role / p_sub; returns the result as text or the SQLSTATE.
create function pg_temp.as_user(p_sub text, p_role text) returns text
language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
  v := snapshot_preview_highlights('15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-0000000000a3');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v->>'previousId', 'null');
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return sqlstate;
end;
$$;

do $$
declare r text;
begin
  r := pg_temp.as_user('15000000-0000-4000-8000-0000000000b1', 'authenticated');
  if r <> '15000000-0000-4000-8000-0000000000a2' then raise exception 'viewer: %', r; end if;
  r := pg_temp.as_user('15000000-0000-4000-8000-0000000000b2', 'authenticated');
  if r <> 'null' then raise exception 'stranger must get null (RLS): %', r; end if;
  r := pg_temp.as_user('15000000-0000-4000-8000-0000000000b2', 'anon');
  if r <> '42501' then raise exception 'anon: % (expected permission denied)', r; end if;
  r := pg_temp.as_user('15000000-0000-4000-8000-0000000000b2', 'service_role');
  if r <> '15000000-0000-4000-8000-0000000000a2' then raise exception 'service_role: %', r; end if;
end;
$$;
\echo '   access: viewer ok, stranger null (RLS), anon denied, service_role ok: PASS'

\o
