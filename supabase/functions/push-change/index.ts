import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const projectId: string | undefined = body.projectId;
  if (!projectId) {
    return new Response(JSON.stringify({ error: 'projectId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Accept both single-form { commandType, payload, changeId? } and array-form { changes: [...] }.
  // `changeId` is the client-generated idempotency key — same id on retry returns the existing row.
  type Change = { commandType: string; payload: unknown; changeId?: string };
  let changes: Change[];
  if (Array.isArray(body.changes)) {
    changes = body.changes;
  } else if (body.commandType && body.payload !== undefined) {
    changes = [{ commandType: body.commandType, payload: body.payload, changeId: body.changeId }];
  } else {
    return new Response(
      JSON.stringify({ error: 'either { commandType, payload } or { changes: [...] } required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  if (changes.length === 0) {
    return new Response(JSON.stringify({ sequenceNumbers: [], changeIds: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Assign a server-side change_id if the client didn't supply one (back-compat).
  const rows = changes.map(c => ({
    project_id: projectId,
    user_id: user.id,
    command_type: c.commandType,
    payload: c.payload,
    change_id: c.changeId ?? crypto.randomUUID(),
  }));

  // Idempotent upsert: on (project_id, change_id) conflict, the existing row is preserved
  // (sequence_number is `generated always as identity` so it cannot be changed). The
  // returned data reflects the existing row, so retries see the same sequence_number.
  const { data, error } = await supabase
    .from('project_changes')
    .upsert(rows, { onConflict: 'project_id,change_id', ignoreDuplicates: false })
    .select('sequence_number, change_id');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Re-order response to match request order, since upsert may return rows in a different order.
  // We match by change_id (which is unique per request).
  const byChangeId = new Map<string, { sequence_number: number; change_id: string }>();
  for (const r of (data ?? [])) byChangeId.set(r.change_id as string, r as any);
  const ordered = rows.map(r => byChangeId.get(r.change_id) ?? null);

  const sequenceNumbers = ordered.map(r => r?.sequence_number as number | undefined);
  const changeIds       = ordered.map(r => r?.change_id as string | undefined);

  return new Response(
    JSON.stringify({ sequenceNumbers, sequenceNumber: sequenceNumbers[0], changeIds }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
