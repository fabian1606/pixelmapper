-- ============================================================
-- 014 snapshot preview layout for version-history hover previews
--
-- * snapshot_preview_layout(...): a compact schematic of one snapshot's
--   scene (fixture boxes, base colour, shape, beam count, top-level
--   group) computed in SQL, so the edge function `snapshot-preview` never
--   sends the full snapshot JSON over the wire.
--
-- SECURITY INVOKER: RLS on project_snapshots ("read if collaborator")
-- still decides what the caller may see; the edge function additionally
-- returns 403 for non-collaborators. Explicit grants: functions created by
-- the CLI's login role do not get the default privileges (see 011).
-- ============================================================

-- ── snapshot_preview_layout ─────────────────────────────────
-- Returns null when the snapshot does not exist in the project (or is not
-- visible to the caller), else
--
--   { "fixtures":  [[x, y, w, h, r, c, s, b, g], …],
--     "groups":    [[name], …],
--     "total":     <int>,
--     "truncated": <bool> }
--
-- Walk: `sceneNodes` recursively like snapshot_summary (010). A node is a
-- group when `_type = 'group'` or it has a `children` array; every other
-- object node is a fixture. Each node carries its ordinality path (array of
-- 1-based indices), so ordering by the path gives deterministic scene order
-- (depth-first document order) — a recursive CTE alone does not.
--
-- Fixture tuple (world = 3000 × 3000 px, FIXTURE_RADIUS = 18 px):
--   x, y  centre, normalized 0…1 (`fixturePosition`), 3 decimals (3 world px;
--         float8 so jsonb drops trailing zeros).
--         Fixtures without a numeric position are skipped (not in `total`).
--   w, h  size multipliers (`fixtureSize`, default 1), 2 decimals. The
--         canvas draws a single-beam fixture as a circle of radius 16·w and
--         a multi-beam fixture as a rect of half-extent 18·w × 18·h.
--   r     rotation in degrees, integer, mod 360 (default 0).
--   c     base colour: the `colorValue` of the channels with
--         `role = 'COLOR'` when exactly ONE distinct valid `#rrggbb` value
--         exists among them (lower-cased); else null (multi-colour RGB
--         fixture or no colour channel → the client draws neutral).
--   s     shape: 0 = single-beam fixture, 1 = multi-beam fixture (> 1 beam),
--         2 = kind fixture (`kind.compiled.bounds` present).
--   b     beam count (`beams` length, capped at 256).
--   g     index into `groups` of the fixture's TOP-LEVEL group, -1 when the
--         fixture is not in a group or its group is beyond the group cap.
--
-- Kind fixtures mirror the canvas (`kindCanvasFields` / `kindWorldAabb`):
-- `bounds` = {x, y, w, h} in world px relative to the fixture position,
-- rotated by `rotation`. The tuple holds the axis-aligned bounding box of
-- the rotated bounds: centre = position·3000 + rotated bounds centre
-- (normalized again), half-extents = |w/2·cos| + |h/2·sin| and
-- |w/2·sin| + |h/2·cos|, w/h = greatest(half-extent, 8) / 18, r = 0.
-- The kind body itself is not reproduced (good enough for a schematic).
--
-- groups: top-level groups in scene order as [name] (name cut to 60 chars),
-- at most 100. The client draws group outlines as bounding boxes of their
-- member fixtures.
--
-- Fixtures are capped at p_limit (clamped to 1…1000, default 400 ≈ 18 KB JSON) in scene
-- order; total = all drawable fixtures, truncated = total > returned.
create or replace function snapshot_preview_layout(
  p_project_id  uuid,
  p_snapshot_id uuid,
  p_limit       integer default 400
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with recursive
  snap as (
    select ps.snapshot
      from project_snapshots ps
     where ps.project_id = p_project_id and ps.id = p_snapshot_id
  ),
  -- ── Recursive walk with ordinality path ──
  nodes(node, path) as (
    select n.value, array[n.ord]
      from snap
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(snap.snapshot->'sceneNodes') = 'array'
             then snap.snapshot->'sceneNodes' else '[]'::jsonb end
      ) with ordinality as n(value, ord)
    union all
    select c.value, nodes.path || c.ord
      from nodes
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(nodes.node) = 'object'
              and jsonb_typeof(nodes.node->'children') = 'array'
             then nodes.node->'children' else '[]'::jsonb end
      ) with ordinality as c(value, ord)
  ),
  kinds as (
    -- coalesce: missing keys yield NULL, which must count as "not a group".
    select node, path,
           coalesce(jsonb_typeof(node) = 'object'
             and (node->>'_type' = 'group' or jsonb_typeof(node->'children') = 'array'), false) as is_group
      from nodes
  ),
  -- ── Top-level groups (index = position among top-level groups) ──
  top_groups as (
    select path[1] as top_ord,
           (row_number() over (order by path[1]) - 1)::integer as gidx,
           left(coalesce(node->>'name', ''), 60) as name
      from kinds
     where is_group and cardinality(path) = 1
  ),
  -- ── Raw fixture fields ──
  raw as (
    select k.path,
           (k.node->'fixturePosition'->>'x')::float8 as px,
           (k.node->'fixturePosition'->>'y')::float8 as py,
           case when jsonb_typeof(k.node->'fixtureSize'->'x') = 'number'
                then (k.node->'fixtureSize'->>'x')::float8 else 1 end as sw,
           case when jsonb_typeof(k.node->'fixtureSize'->'y') = 'number'
                then (k.node->'fixtureSize'->>'y')::float8 else 1 end as sh,
           case when jsonb_typeof(k.node->'rotation') = 'number'
                then (k.node->>'rotation')::float8 else 0 end as rot,
           k.node->'kind'->'compiled'->'bounds' as bounds,
           case when jsonb_typeof(k.node->'beams') = 'array'
                then least(jsonb_array_length(k.node->'beams'), 256) else 0 end as beams,
           -- Single distinct valid COLOR colorValue, else null.
           (select case when count(distinct lower(ch->>'colorValue')) = 1
                        then min(lower(ch->>'colorValue')) end
              from jsonb_array_elements(
                case when jsonb_typeof(k.node->'channels') = 'array'
                     then k.node->'channels' else '[]'::jsonb end) ch
             where ch->>'role' = 'COLOR'
               and ch->>'colorValue' ~* '^#[0-9a-f]{6}$') as color,
           coalesce(tg.gidx, -1) as gidx
      from kinds k
      left join top_groups tg
        on cardinality(k.path) > 1 and tg.top_ord = k.path[1] and tg.gidx < 100
     where not k.is_group
       and jsonb_typeof(k.node) = 'object'
       and jsonb_typeof(k.node->'fixturePosition'->'x') = 'number'
       and jsonb_typeof(k.node->'fixturePosition'->'y') = 'number'
  ),
  -- ── Kind fixtures: AABB of the rotated bounds ──
  geo as (
    select r.*,
           (jsonb_typeof(r.bounds->'x') = 'number' and jsonb_typeof(r.bounds->'y') = 'number'
            and jsonb_typeof(r.bounds->'w') = 'number' and jsonb_typeof(r.bounds->'h') = 'number') as is_kind,
           cos(radians(r.rot)) as ca,
           sin(radians(r.rot)) as sa
      from raw r
  ),
  fx as (
    select g.path,
           case when g.is_kind then
             jsonb_build_array(
               round(((g.px * 3000
                 + ((g.bounds->>'x')::float8 + (g.bounds->>'w')::float8 / 2) * g.ca
                 - ((g.bounds->>'y')::float8 + (g.bounds->>'h')::float8 / 2) * g.sa) / 3000)::numeric, 3)::float8,
               round(((g.py * 3000
                 + ((g.bounds->>'x')::float8 + (g.bounds->>'w')::float8 / 2) * g.sa
                 + ((g.bounds->>'y')::float8 + (g.bounds->>'h')::float8 / 2) * g.ca) / 3000)::numeric, 3)::float8,
               round((greatest(abs((g.bounds->>'w')::float8 / 2 * g.ca) + abs((g.bounds->>'h')::float8 / 2 * g.sa), 8) / 18)::numeric, 2)::float8,
               round((greatest(abs((g.bounds->>'w')::float8 / 2 * g.sa) + abs((g.bounds->>'h')::float8 / 2 * g.ca), 8) / 18)::numeric, 2)::float8,
               0, g.color, 2, g.beams, g.gidx)
           else
             jsonb_build_array(
               round(g.px::numeric, 3)::float8,
               round(g.py::numeric, 3)::float8,
               round(g.sw::numeric, 2)::float8,
               round(g.sh::numeric, 2)::float8,
               (round(g.rot::numeric) % 360)::integer,
               g.color,
               case when g.beams > 1 then 1 else 0 end,
               g.beams, g.gidx)
           end as tuple
      from geo g
  ),
  lim as (
    select greatest(1, least(coalesce(p_limit, 400), 1000)) as n
  )
  select jsonb_build_object(
           'fixtures', coalesce((
             select jsonb_agg(t.tuple order by t.path)
               from (select fx.path, fx.tuple from fx order by fx.path limit (select n from lim)) t
           ), '[]'::jsonb),
           'groups', coalesce((
             select jsonb_agg(jsonb_build_array(tg.name) order by tg.gidx)
               from top_groups tg where tg.gidx < 100
           ), '[]'::jsonb),
           'total', (select count(*) from fx)::integer,
           'truncated', (select count(*) from fx) > (select n from lim)
         )
    from snap;
$$;

revoke all on function snapshot_preview_layout(uuid, uuid, integer) from public, anon;
grant execute on function snapshot_preview_layout(uuid, uuid, integer) to authenticated, service_role;
