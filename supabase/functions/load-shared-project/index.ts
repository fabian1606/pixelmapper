import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Public read-only patch data. Access is granted by a share token, NOT by auth:
// the function uses the service-role key to bypass RLS after validating the token.
// It only ever returns patch fields (never positions/effects/etc.).

interface PatchRow {
  id: string | number;
  name: string;
  manufacturer: string;
  fixtureType: string;
  universe: number;
  localAddress: number;
  channels: number;
}

// Snapshot sceneNodes are plain JSON: { _type: 'fixture' | 'group', ... }.
// Groups nest via `children`. universe/localAddress are derived from startAddress
// exactly like app/utils/engine/core/fixture.ts.
function flattenFixtures(nodes: any[], out: PatchRow[]) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (node?._type === 'group') {
      flattenFixtures(node.children ?? [], out);
    } else if (node) {
      const startAddress = Number(node.startAddress) || 1;
      out.push({
        id: node.id,
        name: node.name ?? '',
        manufacturer: node.manufacturer ?? '',
        fixtureType: node.fixtureType ?? '',
        universe: Math.floor((startAddress - 1) / 512) + 1,
        localAddress: ((startAddress - 1) % 512) + 1,
        channels: Array.isArray(node.channels) ? node.channels.length : 0,
      });
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  let token: string | undefined;
  try {
    ({ token } = await req.json());
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (!token) return json({ error: 'token required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: project, error: projError } = await supabase
    .from('projects')
    .select('id, name')
    .eq('public_share_token', token)
    .maybeSingle();

  if (projError) return json({ error: projError.message }, 500);
  if (!project) return json({ error: 'not found' }, 404);

  const { data: snapRow, error: snapError } = await supabase
    .from('project_snapshots')
    .select('snapshot')
    .eq('project_id', project.id)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapError) return json({ error: snapError.message }, 500);

  const fixtures: PatchRow[] = [];
  flattenFixtures(snapRow?.snapshot?.sceneNodes ?? [], fixtures);
  fixtures.sort((a, b) =>
    a.universe !== b.universe ? a.universe - b.universe : a.localAddress - b.localAddress
  );

  return json({ projectName: project.name, fixtures });
});
