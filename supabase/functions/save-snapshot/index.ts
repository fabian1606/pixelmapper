import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  const { projectId, snapshot, sequenceNumber, label } = await req.json();
  if (!projectId || !snapshot || sequenceNumber === undefined) {
    return new Response(JSON.stringify({ error: 'projectId, snapshot, sequenceNumber required' }), { status: 400 });
  }

  const { data, error } = await supabase
    .from('project_snapshots')
    .insert({
      project_id: projectId,
      snapshot,
      sequence_number: sequenceNumber,
      created_by: user.id,
      label: label ?? null,
    })
    .select('id, sequence_number, created_at')
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
});
