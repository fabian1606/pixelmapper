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

  const { projectId, snapshotId } = await req.json();
  if (!projectId || !snapshotId) {
    return new Response(JSON.stringify({ error: 'projectId and snapshotId required' }), { status: 400 });
  }

  // Load the old snapshot
  const { data: old, error: fetchError } = await supabase
    .from('project_snapshots')
    .select('snapshot, sequence_number')
    .eq('id', snapshotId)
    .eq('project_id', projectId)
    .single();

  if (fetchError || !old) {
    return new Response(JSON.stringify({ error: fetchError?.message ?? 'Snapshot not found' }), { status: 404 });
  }

  // Find the latest sequence_number so the restored snapshot appears at the head
  const { data: latest } = await supabase
    .from('project_changes')
    .select('sequence_number')
    .eq('project_id', projectId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestSeq = latest?.sequence_number ?? 0;

  const { data: newSnap, error: insertError } = await supabase
    .from('project_snapshots')
    .insert({
      project_id: projectId,
      snapshot: old.snapshot,
      sequence_number: latestSeq,
      created_by: user.id,
      label: `Restored from snapshot ${old.sequence_number}`,
    })
    .select('id, sequence_number, created_at')
    .single();

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ snapshot: old.snapshot, meta: newSnap }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
