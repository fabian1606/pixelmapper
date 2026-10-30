-- ============================================================
-- 015 snapshot highlights for version-history hover previews
--
-- "What is special about this version": the `snapshot-preview` edge function
-- returns, next to the 014 layout, a comparison of the snapshot with the
-- version it is compared to — computed here with per-entity hashes
-- (md5 of the entity's jsonb text, which is canonical: sorted keys, fixed
-- spacing). Only category counts and the payloads of CHANGED entities leave
-- the database, never a full snapshot.
--
-- * snapshot_preview_highlights(project, snapshot, compareTo, limit, maxBytes)
--     the RPC (SECURITY INVOKER: RLS on project_snapshots decides). Pair by
--     snapshot_details_pair (012): explicit compareTo when it exists in the
--     project and is not the snapshot itself, else the older list neighbour
--     (sequence_number desc, created_at desc, id desc). null = snapshot not
--     found / not visible.
-- * snapshot_highlights_compare(prev, cur, limit, maxBytes)
--     the pure comparison of two snapshot JSONs (prev null = first version).
-- * helpers: snapshot_id_key, snapshot_scene_walk, snapshot_layout_index,
--   snapshot_scene_hashes, snapshot_entity_list, snapshot_list_diff,
--   snapshot_changed_keys, snapshot_live_widget_diff, snapshot_fixture_refs.
--
-- Result (previousId added by the RPC):
--   { previousId, categories: { live|effect|preset|fixtures|settings: counts },
--     live:    { pages: [{status, page, widgets: {added, changed, removed:[{id,type,label}]}, sectionsChanged}],
--                removed: [{id, name}] },
--     effects: { items: [{status, modifier, changedKeys, before}], removed: [{id, name: plugin}] },
--     presets: { items: [{status, preset, changedKeys}], removed: [{id, name}] },
--     fixtures: { added: [idx], changed: [idx], moved: [idx], removed: n },
--     fixtureIndex: { "<fixture id>": idx }, settings: [key], truncated }
--
-- Rules (mirroring the client diff in app/utils/sync/version-diff/):
-- * Entities match by id: a non-empty string or a number, compared as text
--   (`snapshot_id_key`); entities without a usable id are ignored; on
--   duplicate ids the first one wins.
-- * Scene: `sceneNodes` flattened at any depth (group = `_type: 'group'` or a
--   `children` array, as 010/014). Fixture hash = node minus `_type` / `id`
--   plus its parent group id (a fixture moved into another group is
--   changed). moved = changed with fixturePosition / fixtureSize / rotation /
--   positionZ / tiltX / rollZ differing (moved ⊆ changed). Group hash = node
--   minus `_type` / `id` / `expanded` / `children`, plus parent id and the
--   ordered member ids. categories.fixtures.groups = added + changed +
--   removed groups.
-- * Modifiers (effect): hash ignores `id`; changedKeys = differing top-level
--   keys, `params` expanded to `params.<key>` when both sides are objects;
--   `before` = old values (> 2 KB or missing omitted). removed name = plugin.
-- * Presets: hash ignores `id` and `createdAt`; changedKeys top-level.
-- * Live pages: hash ignores `id`; per page widgets diffed by id (added ids,
--   changed ids, removed {id, type, label}), sectionsChanged = `sections`
--   differ. An added page lists all widget ids as added.
-- * Settings: top-level keys other than sceneNodes / modifiers /
--   savedPresets / livePages / clockEpoch / schemaVersion; globalBpm
--   defaults to 120, selectedPresetId to null, [] and {} equal missing.
--   A clockEpoch-only change yields no categories.
-- * Layout indices: index into snapshot_preview_layout(...).fixtures —
--   same walk, ordinality-path order, "drawable" filter (object, not a group,
--   numeric fixturePosition.x/y) and cap (p_limit clamped 1…1000, default
--   400). Fixtures outside the drawn layout are omitted from the lists.
--
-- Caps: removed lists ≤ 20 entries (names ≤ 60 chars), settings ≤ 50 keys,
-- widget id lists ≤ 200, removed widgets ≤ 50. Payload budget p_max_bytes
-- (clamped 2000…1000000, default 30000) measured as octet_length of the
-- jsonb text: the base (counts, index lists, removed lists, settings) is
-- always returned; then live pages (added first, then most widget changes),
-- effects, presets (added before changed, list order) and finally the
-- fixtureIndex entries of changed/added fixtures are added while they fit —
-- an item's cost includes the fixtureIndex entries it references. An item
-- that does not fit is dropped (its count stays) and truncated = true.
-- Output order of items: added before changed, then list order.
--
-- Grants: revoke from public/anon, execute to authenticated + service_role
-- (see 011). snapshot_details_pair (012) is additionally granted to
-- service_role so the invoker RPC also works for the service role.
-- ============================================================

-- ── snapshot_id_key ─────────────────────────────────────────
-- Id of an entity as text: non-empty string or number, else null
-- (mirror of `idKey` in version-diff/compare.ts).
create or replace function snapshot_id_key(p_id jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when jsonb_typeof(p_id) = 'string' and p_id #>> '{}' <> '' then p_id #>> '{}'
           when jsonb_typeof(p_id) = 'number' then p_id #>> '{}'
         end;
$$;

-- ── snapshot_scene_walk ─────────────────────────────────────
-- Every node of `sceneNodes` (any depth) with its ordinality path (exactly
-- the walk of snapshot_preview_layout, 014), the id of its parent group and
-- whether it is a group.
create or replace function snapshot_scene_walk(p_snapshot jsonb)
returns table (path bigint[], node jsonb, parent_id text, is_group boolean)
language sql
immutable
set search_path = public
as $$
  with recursive nodes(node, path, parent_id) as (
    select n.value, array[n.ord], null::text
      from jsonb_array_elements(
        case when jsonb_typeof(p_snapshot->'sceneNodes') = 'array'
             then p_snapshot->'sceneNodes' else '[]'::jsonb end
      ) with ordinality as n(value, ord)
    union all
    select c.value, nodes.path || c.ord, snapshot_id_key(nodes.node->'id')
      from nodes
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(nodes.node) = 'object'
              and jsonb_typeof(nodes.node->'children') = 'array'
             then nodes.node->'children' else '[]'::jsonb end
      ) with ordinality as c(value, ord)
  )
  select n.path, n.node, n.parent_id,
         coalesce(jsonb_typeof(n.node) = 'object'
           and (n.node->>'_type' = 'group' or jsonb_typeof(n.node->'children') = 'array'), false)
    from nodes n;
$$;

-- ── snapshot_layout_index ───────────────────────────────────
-- Fixture id → index into snapshot_preview_layout(...).fixtures (same order,
-- drawable filter and cap). Fixtures without a usable id keep their slot but
-- are not listed; duplicate ids map to their first slot.
create or replace function snapshot_layout_index(p_snapshot jsonb, p_limit integer default 400)
returns table (fixture_id text, layout_idx integer)
language sql
immutable
set search_path = public
as $$
  select distinct on (d.fid) d.fid, d.idx
    from (
      select snapshot_id_key(w.node->'id') as fid,
             (row_number() over (order by w.path) - 1)::integer as idx
        from snapshot_scene_walk(p_snapshot) w
       where not w.is_group
         and jsonb_typeof(w.node) = 'object'
         and jsonb_typeof(w.node->'fixturePosition'->'x') = 'number'
         and jsonb_typeof(w.node->'fixturePosition'->'y') = 'number'
       order by w.path
       limit greatest(1, least(coalesce(p_limit, 400), 1000))
    ) d
   where d.fid is not null
   order by d.fid, d.idx;
$$;

-- ── snapshot_scene_hashes ───────────────────────────────────
-- Per-entity hashes of the flattened scene: kind 'fixture' | 'group',
-- content hash and (fixtures) position hash. First node wins per id.
create or replace function snapshot_scene_hashes(p_snapshot jsonb)
returns table (kind text, entity_id text, hash text, pos_hash text)
language sql
immutable
set search_path = public
as $$
  select distinct on (h.kind, h.eid) h.kind, h.eid, h.hash, h.pos_hash
    from (
      select case when w.is_group then 'group' else 'fixture' end as kind,
             snapshot_id_key(w.node->'id') as eid,
             w.path,
             case when w.is_group then
               md5(((w.node - '_type' - 'id' - 'expanded' - 'children')
                    || jsonb_build_object('__parent', w.parent_id, '__members', (
                         select coalesce(jsonb_agg(snapshot_id_key(c.value->'id') order by c.ord), '[]'::jsonb)
                           from jsonb_array_elements(
                             case when jsonb_typeof(w.node->'children') = 'array'
                                  then w.node->'children' else '[]'::jsonb end
                           ) with ordinality as c(value, ord)
                          where jsonb_typeof(c.value) = 'object'
                            and snapshot_id_key(c.value->'id') is not null)))::text)
             else
               md5(((w.node - '_type' - 'id') || jsonb_build_object('__parent', w.parent_id))::text)
             end as hash,
             case when not w.is_group then
               md5((select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                      from jsonb_each(w.node) e
                     where e.key in ('fixturePosition', 'fixtureSize', 'rotation',
                                     'positionZ', 'tiltX', 'rollZ'))::text)
             end as pos_hash
        from snapshot_scene_walk(p_snapshot) w
       where jsonb_typeof(w.node) = 'object'
    ) h
   where h.eid is not null
   order by h.kind, h.eid, h.path;
$$;

-- ── snapshot_entity_list ────────────────────────────────────
-- Objects of an entity array by id (first wins), with their list position.
create or replace function snapshot_entity_list(p_list jsonb)
returns table (entity_id text, ord bigint, entity jsonb)
language sql
immutable
set search_path = public
as $$
  select distinct on (x.eid) x.eid, x.ord, x.value
    from (
      select snapshot_id_key(e.value->'id') as eid, e.ord, e.value
        from jsonb_array_elements(
          case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end
        ) with ordinality as e(value, ord)
       where jsonb_typeof(e.value) = 'object'
    ) x
   where x.eid is not null
   order by x.eid, x.ord;
$$;

-- ── snapshot_list_diff ──────────────────────────────────────
-- Added / changed / removed entities of two id-keyed lists. Hash = md5 of the
-- entity minus p_ignore. ord = position in the newer list (older list for
-- removed rows). Unchanged entities are not returned.
create or replace function snapshot_list_diff(p_prev jsonb, p_cur jsonb, p_ignore text[])
returns table (entity_id text, ord bigint, status text, cur jsonb, prev jsonb)
language sql
immutable
set search_path = public
as $$
  select coalesce(b.entity_id, a.entity_id),
         coalesce(b.ord, a.ord),
         case when a.entity_id is null then 'added'
              when b.entity_id is null then 'removed'
              else 'changed' end,
         b.entity, a.entity
    from snapshot_entity_list(p_prev) a
    full join snapshot_entity_list(p_cur) b on b.entity_id = a.entity_id
   where a.entity_id is null
      or b.entity_id is null
      or md5((a.entity - p_ignore)::text) <> md5((b.entity - p_ignore)::text);
$$;

-- ── snapshot_changed_keys ───────────────────────────────────
-- Differing top-level keys of two entities (minus p_ignore) with the old
-- value; p_expand (e.g. 'params') is split into '<p_expand>.<key>' when it is
-- an object on both sides. A missing key has a SQL-null `before`.
create or replace function snapshot_changed_keys(
  p_prev jsonb, p_cur jsonb, p_ignore text[], p_expand text default null
)
returns table (changed_key text, before jsonb)
language sql
immutable
set search_path = public
as $$
  with obj as (
    select case when jsonb_typeof(p_prev) = 'object' then p_prev else '{}'::jsonb end as a,
           case when jsonb_typeof(p_cur)  = 'object' then p_cur  else '{}'::jsonb end as b
  ),
  sub as (
    select case when jsonb_typeof(obj.a->p_expand) = 'object' then obj.a->p_expand end as a,
           case when jsonb_typeof(obj.b->p_expand) = 'object' then obj.b->p_expand end as b
      from obj
  ),
  top as (
    select k.key
      from obj, lateral (select key from jsonb_each(obj.a) union select key from jsonb_each(obj.b)) k
     where not (k.key = any(coalesce(p_ignore, '{}')))
       and (obj.a->k.key) is distinct from (obj.b->k.key)
  )
  select t.key, obj.a->t.key
    from top t, obj, sub
   where p_expand is null or t.key <> p_expand or sub.a is null or sub.b is null
  union all
  select p_expand || '.' || k.key, sub.a->k.key
    from sub, lateral (select key from jsonb_each(coalesce(sub.a, '{}'::jsonb))
                       union select key from jsonb_each(coalesce(sub.b, '{}'::jsonb))) k
   where p_expand is not null and sub.a is not null and sub.b is not null
     and (sub.a->k.key) is distinct from (sub.b->k.key);
$$;

-- ── snapshot_live_widget_diff ───────────────────────────────
-- Widget-level diff of one live page (p_prev null = added page: every
-- widget is added). n = number of widget changes (+1 for sections).
create or replace function snapshot_live_widget_diff(p_prev jsonb, p_cur jsonb)
returns table (added jsonb, changed jsonb, removed jsonb, sections_changed boolean, n integer)
language sql
immutable
set search_path = public
as $$
  with d as (
    select * from snapshot_list_diff(p_prev->'widgets', p_cur->'widgets', array['id'])
  ),
  sc as (
    select p_prev is not null and (p_prev->'sections') is distinct from (p_cur->'sections') as v
  )
  select coalesce((select jsonb_agg(x.entity_id order by x.ord)
                     from (select * from d where status = 'added' order by ord limit 200) x), '[]'::jsonb),
         coalesce((select jsonb_agg(x.entity_id order by x.ord)
                     from (select * from d where status = 'changed' order by ord limit 200) x), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'id', x.entity_id,
                            'type', coalesce(x.prev->>'type', ''),
                            'label', left(coalesce(x.prev->>'label', ''), 60)) order by x.ord)
                     from (select * from d where status = 'removed' order by ord limit 50) x), '[]'::jsonb),
         (select v from sc),
         ((select count(*) from d) + case when (select v from sc) then 1 else 0 end)::integer;
$$;

-- ── snapshot_fixture_refs ───────────────────────────────────
-- Fixture id → layout index for the ids of a JSON array that are drawn.
create or replace function snapshot_fixture_refs(p_ids jsonb, p_layout jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(k.id, p_layout->k.id), '{}'::jsonb)
    from (select distinct snapshot_id_key(e.value) as id
            from jsonb_array_elements(
              case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end) e) k
   where k.id is not null and p_layout ? k.id;
$$;

-- ── snapshot_highlights_compare ─────────────────────────────
-- The comparison of two snapshot JSONs (see the header). p_prev null =
-- first version: empty categories and payloads. Without `previousId`.
create or replace function snapshot_highlights_compare(
  p_prev      jsonb,
  p_cur       jsonb,
  p_limit     integer default 400,
  p_max_bytes integer default 30000
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_prev     jsonb := case when jsonb_typeof(p_prev) = 'object' then p_prev else '{}'::jsonb end;
  v_cur      jsonb := case when jsonb_typeof(p_cur)  = 'object' then p_cur  else '{}'::jsonb end;
  v_lim      integer := greatest(1, least(coalesce(p_limit, 400), 1000));
  v_max      integer := greatest(2000, least(coalesce(p_max_bytes, 30000), 1000000));
  v_layout   jsonb;            -- fixture id → layout index
  v_scene    jsonb;            -- scene counts, index lists, scene fixtureIndex
  v_cats     jsonb := '{}';
  v_base     jsonb;
  v_index    jsonb := '{}';    -- fixtureIndex being filled
  v_live     jsonb := '[]';    -- [{a, o, item}] (sort keys + item)
  v_effects  jsonb := '[]';
  v_presets  jsonb := '[]';
  v_trunc    boolean := false;
  v_used     integer;
  v_item     jsonb;
  v_refs     jsonb;
  v_cost     integer;
  v_n        record;
  r          record;
begin
  -- ── First version ──
  if p_prev is null then
    return jsonb_build_object(
      'categories', '{}'::jsonb,
      'live', jsonb_build_object('pages', '[]'::jsonb, 'removed', '[]'::jsonb),
      'effects', jsonb_build_object('items', '[]'::jsonb, 'removed', '[]'::jsonb),
      'presets', jsonb_build_object('items', '[]'::jsonb, 'removed', '[]'::jsonb),
      'fixtures', jsonb_build_object('added', '[]'::jsonb, 'changed', '[]'::jsonb, 'moved', '[]'::jsonb, 'removed', 0),
      'fixtureIndex', '{}'::jsonb,
      'settings', '[]'::jsonb,
      'truncated', false);
  end if;

  -- ── Scene: fixtures + groups ──
  select coalesce(jsonb_object_agg(li.fixture_id, li.layout_idx), '{}'::jsonb)
    into v_layout
    from snapshot_layout_index(v_cur, v_lim) li;

  with d as (
    select coalesce(b.kind, a.kind) as kind,
           coalesce(b.entity_id, a.entity_id) as eid,
           case when a.entity_id is null then 'added'
                when b.entity_id is null then 'removed'
                when a.hash <> b.hash then 'changed' end as st,
           (a.entity_id is not null and b.entity_id is not null
            and a.pos_hash is distinct from b.pos_hash) as moved,
           case when b.entity_id is not null then (v_layout->>b.entity_id)::integer end as idx
      from snapshot_scene_hashes(v_prev) a
      full join snapshot_scene_hashes(v_cur) b on b.kind = a.kind and b.entity_id = a.entity_id
  )
  select jsonb_build_object(
           'added',   count(*) filter (where kind = 'fixture' and st = 'added'),
           'changed', count(*) filter (where kind = 'fixture' and st = 'changed'),
           'removed', count(*) filter (where kind = 'fixture' and st = 'removed'),
           'moved',   count(*) filter (where kind = 'fixture' and st = 'changed' and moved),
           'groups',  count(*) filter (where kind = 'group' and st is not null),
           'addedIdx',   coalesce(jsonb_agg(idx order by idx) filter (where kind = 'fixture' and st = 'added' and idx is not null), '[]'::jsonb),
           'changedIdx', coalesce(jsonb_agg(idx order by idx) filter (where kind = 'fixture' and st = 'changed' and idx is not null), '[]'::jsonb),
           'movedIdx',   coalesce(jsonb_agg(idx order by idx) filter (where kind = 'fixture' and st = 'changed' and moved and idx is not null), '[]'::jsonb),
           'index',      coalesce(jsonb_object_agg(eid, idx) filter (where kind = 'fixture' and st in ('added', 'changed') and idx is not null), '{}'::jsonb))
    into v_scene
    from d;

  if (v_scene->>'added')::int + (v_scene->>'changed')::int + (v_scene->>'removed')::int
     + (v_scene->>'groups')::int > 0 then
    v_cats := v_cats || jsonb_build_object('fixtures', jsonb_build_object(
      'added', (v_scene->>'added')::int, 'changed', (v_scene->>'changed')::int,
      'removed', (v_scene->>'removed')::int, 'moved', (v_scene->>'moved')::int,
      'groups', (v_scene->>'groups')::int));
  end if;

  -- ── Entity list counts (live / effect / preset) ──
  for v_n in
    select x.cat,
           count(*) filter (where d.status = 'added')   as added,
           count(*) filter (where d.status = 'changed') as changed,
           count(*) filter (where d.status = 'removed') as removed
      from (values ('live', 'livePages', array['id']),
                   ('effect', 'modifiers', array['id']),
                   ('preset', 'savedPresets', array['id', 'createdAt'])) x(cat, key, ign)
      cross join lateral snapshot_list_diff(v_prev->x.key, v_cur->x.key, x.ign) d
     group by x.cat
  loop
    v_cats := v_cats || jsonb_build_object(v_n.cat, jsonb_build_object(
      'added', v_n.added, 'changed', v_n.changed, 'removed', v_n.removed));
  end loop;

  -- ── Settings (normalized like version-diff/settings.ts) ──
  with keys as (
    select k.key from jsonb_each(v_prev) k
    union
    select k.key from jsonb_each(v_cur) k
  ),
  norm as (
    select keys.key,
           case when keys.key = 'globalBpm' then coalesce(v_prev->keys.key, '120'::jsonb)
                when keys.key = 'selectedPresetId' then coalesce(v_prev->keys.key, 'null'::jsonb)
                when v_prev->keys.key in ('[]'::jsonb, '{}'::jsonb) then null
                else v_prev->keys.key end as a,
           case when keys.key = 'globalBpm' then coalesce(v_cur->keys.key, '120'::jsonb)
                when keys.key = 'selectedPresetId' then coalesce(v_cur->keys.key, 'null'::jsonb)
                when v_cur->keys.key in ('[]'::jsonb, '{}'::jsonb) then null
                else v_cur->keys.key end as b
      from keys
     where keys.key not in ('sceneNodes', 'modifiers', 'savedPresets', 'livePages',
                            'clockEpoch', 'schemaVersion')
  ),
  changed as (
    select norm.key from norm where norm.a is distinct from norm.b
  )
  select v_cats || case when count(*) > 0 then jsonb_build_object('settings',
           jsonb_build_object('added', 0, 'changed', count(*), 'removed', 0)) else '{}'::jsonb end,
         jsonb_build_object('settings', coalesce((
           select jsonb_agg(s.key order by s.key)
             from (select c2.key from changed c2 order by c2.key limit 50) s), '[]'::jsonb))
    into v_cats, v_base
    from changed;

  -- ── Base (always returned): counts, removed lists, index lists ──
  v_base := v_base || jsonb_build_object(
    'categories', v_cats,
    'live', jsonb_build_object('pages', '[]'::jsonb, 'removed', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.entity_id,
               'name', left(coalesce(x.prev->>'name', ''), 60)) order by x.ord), '[]'::jsonb)
        from (select * from snapshot_list_diff(v_prev->'livePages', v_cur->'livePages', array['id'])
               where status = 'removed' order by ord limit 20) x)),
    'effects', jsonb_build_object('items', '[]'::jsonb, 'removed', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.entity_id,
               'name', left(coalesce(x.prev->>'plugin', ''), 100)) order by x.ord), '[]'::jsonb)
        from (select * from snapshot_list_diff(v_prev->'modifiers', v_cur->'modifiers', array['id'])
               where status = 'removed' order by ord limit 20) x)),
    'presets', jsonb_build_object('items', '[]'::jsonb, 'removed', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.entity_id,
               'name', left(coalesce(x.prev->>'name', ''), 60)) order by x.ord), '[]'::jsonb)
        from (select * from snapshot_list_diff(v_prev->'savedPresets', v_cur->'savedPresets', array['id', 'createdAt'])
               where status = 'removed' order by ord limit 20) x)),
    'fixtures', jsonb_build_object(
      'added', v_scene->'addedIdx', 'changed', v_scene->'changedIdx',
      'moved', v_scene->'movedIdx', 'removed', (v_scene->>'removed')::int),
    'fixtureIndex', '{}'::jsonb,
    'truncated', false);

  -- Lists cut by the fixed caps count as truncated.
  v_trunc := jsonb_array_length(v_base->'settings') < coalesce((v_cats->'settings'->>'changed')::int, 0)
    or jsonb_array_length(v_base->'live'->'removed') < coalesce((v_cats->'live'->>'removed')::int, 0)
    or jsonb_array_length(v_base->'effects'->'removed') < coalesce((v_cats->'effect'->>'removed')::int, 0)
    or jsonb_array_length(v_base->'presets'->'removed') < coalesce((v_cats->'preset'->>'removed')::int, 0);

  -- Reserve room for `previousId` and `"truncated": true`.
  v_used := octet_length(v_base::text) + 64;

  -- ── Live pages: added first, then most widget changes ──
  for r in
    select d.status, d.ord, d.cur, w.added, w.changed, w.removed, w.sections_changed
      from snapshot_list_diff(v_prev->'livePages', v_cur->'livePages', array['id']) d
      cross join lateral snapshot_live_widget_diff(d.prev, d.cur) w
     where d.status <> 'removed'
     order by (d.status = 'added') desc, w.n desc, d.ord
  loop
    v_item := jsonb_build_object('status', r.status, 'page', r.cur,
      'widgets', jsonb_build_object('added', r.added, 'changed', r.changed, 'removed', r.removed),
      'sectionsChanged', r.sections_changed);
    v_cost := octet_length(v_item::text) + 2;
    if v_used + v_cost > v_max then v_trunc := true; continue; end if;
    v_used := v_used + v_cost;
    v_live := v_live || jsonb_build_array(jsonb_build_object(
      'a', case when r.status = 'added' then 0 else 1 end, 'o', r.ord, 'item', v_item));
  end loop;

  -- ── Effects: added before changed, list order ──
  for r in
    select d.status, d.cur, d.prev
      from snapshot_list_diff(v_prev->'modifiers', v_cur->'modifiers', array['id']) d
     where d.status <> 'removed'
     order by (d.status = 'added') desc, d.ord
  loop
    -- One row even for added items (aggregate without group by).
    select jsonb_build_object('status', r.status, 'modifier', r.cur,
             'changedKeys', coalesce(jsonb_agg(k.changed_key order by k.changed_key), '[]'::jsonb),
             'before', coalesce(jsonb_object_agg(k.changed_key, k.before)
                         filter (where k.before is not null and octet_length(k.before::text) <= 2048), '{}'::jsonb))
      into v_item
      from snapshot_changed_keys(r.prev, r.cur, array['id'], 'params') k
     where r.status = 'changed';
    v_refs := (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                 from jsonb_each(snapshot_fixture_refs(r.cur->'targetFixtureIds', v_layout)) e
                where not v_index ? e.key);
    v_cost := octet_length(v_item::text) + 2 + octet_length(v_refs::text);
    if v_used + v_cost > v_max then v_trunc := true; continue; end if;
    v_used := v_used + v_cost;
    v_index := v_index || v_refs;
    v_effects := v_effects || jsonb_build_array(v_item);
  end loop;

  -- ── Presets: added before changed, list order ──
  for r in
    select d.status, d.cur, d.prev
      from snapshot_list_diff(v_prev->'savedPresets', v_cur->'savedPresets', array['id', 'createdAt']) d
     where d.status <> 'removed'
     order by (d.status = 'added') desc, d.ord
  loop
    select jsonb_build_object('status', r.status, 'preset', r.cur,
             'changedKeys', coalesce(jsonb_agg(k.changed_key order by k.changed_key), '[]'::jsonb))
      into v_item
      from snapshot_changed_keys(r.prev, r.cur, array['id', 'createdAt']) k
     where r.status = 'changed';
    v_refs := (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                 from jsonb_each(snapshot_fixture_refs(
                        jsonb_path_query_array(r.cur, 'lax $.categories[*].fixtureIds[*]'), v_layout)) e
                where not v_index ? e.key);
    v_cost := octet_length(v_item::text) + 2 + octet_length(v_refs::text);
    if v_used + v_cost > v_max then v_trunc := true; continue; end if;
    v_used := v_used + v_cost;
    v_index := v_index || v_refs;
    v_presets := v_presets || jsonb_build_array(v_item);
  end loop;

  -- ── fixtureIndex of changed / added fixtures (scene order) ──
  for r in
    select e.key, e.value from jsonb_each(v_scene->'index') e
     where not v_index ? e.key
     order by (e.value)::text::int
  loop
    v_cost := octet_length(r.key) + octet_length(r.value::text) + 6;
    if v_used + v_cost > v_max then v_trunc := true; exit; end if;
    v_used := v_used + v_cost;
    v_index := v_index || jsonb_build_object(r.key, r.value);
  end loop;

  -- ── Assemble ──
  return v_base
    || jsonb_build_object(
         'live', jsonb_build_object('removed', v_base->'live'->'removed', 'pages', (
           select coalesce(jsonb_agg(e->'item' order by (e->>'a')::int, (e->>'o')::bigint), '[]'::jsonb)
             from jsonb_array_elements(v_live) e)),
         'effects', jsonb_build_object('removed', v_base->'effects'->'removed', 'items', v_effects),
         'presets', jsonb_build_object('removed', v_base->'presets'->'removed', 'items', v_presets),
         'fixtureIndex', v_index,
         'truncated', v_trunc);
end;
$$;

-- ── snapshot_preview_highlights ─────────────────────────────
-- The RPC of `snapshot-preview`: pair via snapshot_details_pair (012, RLS
-- applies), then snapshot_highlights_compare. null = snapshot not found.
create or replace function snapshot_preview_highlights(
  p_project_id    uuid,
  p_snapshot_id   uuid,
  p_compare_to_id uuid default null,
  p_limit         integer default 400,
  p_max_bytes     integer default 30000
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with pair as (
    select * from snapshot_details_pair(p_project_id, p_snapshot_id, p_compare_to_id)
  )
  select jsonb_build_object('previousId', p.id)
         || snapshot_highlights_compare(p.snapshot, c.snapshot, p_limit, p_max_bytes)
    from pair c
    left join pair p on p.slot = 'previous'
   where c.slot = 'current';
$$;

-- ── Grants (see 011) ────────────────────────────────────────
revoke all on function snapshot_id_key(jsonb) from public, anon;
revoke all on function snapshot_scene_walk(jsonb) from public, anon;
revoke all on function snapshot_layout_index(jsonb, integer) from public, anon;
revoke all on function snapshot_scene_hashes(jsonb) from public, anon;
revoke all on function snapshot_entity_list(jsonb) from public, anon;
revoke all on function snapshot_list_diff(jsonb, jsonb, text[]) from public, anon;
revoke all on function snapshot_changed_keys(jsonb, jsonb, text[], text) from public, anon;
revoke all on function snapshot_live_widget_diff(jsonb, jsonb) from public, anon;
revoke all on function snapshot_fixture_refs(jsonb, jsonb) from public, anon;
revoke all on function snapshot_highlights_compare(jsonb, jsonb, integer, integer) from public, anon;
revoke all on function snapshot_preview_highlights(uuid, uuid, uuid, integer, integer) from public, anon;

grant execute on function snapshot_id_key(jsonb) to authenticated, service_role;
grant execute on function snapshot_scene_walk(jsonb) to authenticated, service_role;
grant execute on function snapshot_layout_index(jsonb, integer) to authenticated, service_role;
grant execute on function snapshot_scene_hashes(jsonb) to authenticated, service_role;
grant execute on function snapshot_entity_list(jsonb) to authenticated, service_role;
grant execute on function snapshot_list_diff(jsonb, jsonb, text[]) to authenticated, service_role;
grant execute on function snapshot_changed_keys(jsonb, jsonb, text[], text) to authenticated, service_role;
grant execute on function snapshot_live_widget_diff(jsonb, jsonb) to authenticated, service_role;
grant execute on function snapshot_fixture_refs(jsonb, jsonb) to authenticated, service_role;
grant execute on function snapshot_highlights_compare(jsonb, jsonb, integer, integer) to authenticated, service_role;
grant execute on function snapshot_preview_highlights(uuid, uuid, uuid, integer, integer) to authenticated, service_role;
-- The invoker RPC pairs through 012, which was granted to authenticated only.
grant execute on function snapshot_details_pair(uuid, uuid, uuid) to service_role;
