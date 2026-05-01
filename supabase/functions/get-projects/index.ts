import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  const { data, error } = await supabase
    .from('project_collaborators')
    .select('role, accepted_at, projects(*)')
    .eq('user_id', user.id)
    .not('accepted_at', 'is', null)
    .order('projects(updated_at)', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const projects = (data ?? []).map((row: any) => ({
    ...row.projects,
    role: row.role,
  }));

  return new Response(JSON.stringify(projects), {
    headers: { 'Content-Type': 'application/json' },
  });
});
