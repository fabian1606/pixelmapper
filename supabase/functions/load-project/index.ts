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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  const { projectId } = await req.json();
  if (!projectId) return new Response(JSON.stringify({ error: 'projectId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  const { data: snapRow, error: snapError } = await supabase
    .from('project_snapshots')
    .select('snapshot, sequence_number')
    .eq('project_id', projectId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapError) {
    return new Response(JSON.stringify({ error: snapError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const snapshotSeq = snapRow?.sequence_number ?? 0;

  const { data: tail, error: tailError } = await supabase
    .from('project_changes')
    .select('command_type, payload, sequence_number')
    .eq('project_id', projectId)
    .gt('sequence_number', snapshotSeq)
    .order('sequence_number', { ascending: true });

  if (tailError) {
    return new Response(JSON.stringify({ error: tailError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    snapshot: snapRow?.snapshot ?? null,
    snapshotSequence: snapshotSeq,
    tail: tail ?? [],
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
