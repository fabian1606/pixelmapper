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

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  const { name, description } = await req.json();
  if (!name) return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: project, error: projectError } = await adminClient
    .from('projects')
    .insert({ name, description })
    .select()
    .single();

  if (projectError) {
    return new Response(JSON.stringify({ error: projectError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { error: collabError } = await adminClient
    .from('project_collaborators')
    .insert({
      project_id: project.id,
      user_id: user.id,
      role: 'owner',
      accepted_at: new Date().toISOString(),
    });

  if (collabError) {
    return new Response(JSON.stringify({ error: collabError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify(project), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
