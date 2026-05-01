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

  const { projectId, emails } = await req.json();
  if (!projectId || !emails || !Array.isArray(emails)) {
    return new Response(JSON.stringify({ error: 'projectId and emails array are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Check if user is owner
  const { data: collab, error: collabError } = await adminClient
    .from('project_collaborators')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (collabError || !collab || collab.role !== 'owner') {
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }

  const results = [];

  for (const email of emails) {
    // Check if already invited
    const { data: existing } = await adminClient
      .from('project_invites')
      .select('id')
      .eq('project_id', projectId)
      .eq('email', email)
      .single();

    if (existing) {
      results.push({ email, success: false, message: 'Already invited' });
      continue;
    }

    // Create invite
    const { error: insertError } = await adminClient
      .from('project_invites')
      .insert({
        project_id: projectId,
        email: email,
        invited_by: user.id,
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      results.push({ email, success: false, message: insertError.message });
    } else {
      results.push({ email, success: true });
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
