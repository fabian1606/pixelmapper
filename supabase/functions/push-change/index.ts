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

  // Accept both single-form { commandType, payload } and array-form { changes: [...] }.
  // Array form: a single bulk INSERT preserves caller order in returned sequence_numbers.
  type Change = { commandType: string; payload: unknown };
  let changes: Change[];
  if (Array.isArray(body.changes)) {
    changes = body.changes;
  } else if (body.commandType && body.payload !== undefined) {
    changes = [{ commandType: body.commandType, payload: body.payload }];
  } else {
    return new Response(
      JSON.stringify({ error: 'either { commandType, payload } or { changes: [...] } required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  if (changes.length === 0) {
    return new Response(JSON.stringify({ sequenceNumbers: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const rows = changes.map(c => ({
    project_id: projectId,
    user_id: user.id,
    command_type: c.commandType,
    payload: c.payload,
  }));

  const { data, error } = await supabase
    .from('project_changes')
    .insert(rows)
    .select('sequence_number');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const sequenceNumbers = (data ?? []).map(r => r.sequence_number as number);
  return new Response(
    JSON.stringify({ sequenceNumbers, sequenceNumber: sequenceNumbers[0] }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
