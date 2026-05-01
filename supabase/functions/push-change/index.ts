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

  const { projectId, commandType, payload } = await req.json();
  if (!projectId || !commandType || payload === undefined) {
    return new Response(JSON.stringify({ error: 'projectId, commandType, payload required' }), { status: 400 });
  }

  const { data, error } = await supabase
    .from('project_changes')
    .insert({
      project_id: projectId,
      user_id: user.id,
      command_type: commandType,
      payload,
    })
    .select('sequence_number')
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ sequenceNumber: data.sequence_number }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
