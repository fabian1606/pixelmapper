import { triggerRef } from 'vue';
import { useHistory, lastSeenSequenceNumber } from '~/components/engine/composables/use-history';
import { commandFromPayload } from '~/components/engine/commands/serializable-command';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore, type CollaboratorPresence, TAB_SESSION_ID } from '~/stores/live-bus-store';
import { userColor } from '~/composables/live-ops/colors';

// Side-effect import: registers all live ops
import '~/composables/live-ops';

export interface CollaborationContext {
  connect: () => Promise<void>;
  cleanup: () => void;
}

export function useCollaboration(projectId: string): CollaborationContext {
  const supabase = useSupabaseClient();
  const user = useSupabaseUser();

  const history = useHistory();
  const engineStore = useEngineStore();
  const liveBus = useLiveBusStore();

  // Presence key = per-tab session, so each WebSocket connection of the same user
  // appears as its own presence entry (and gets its own cursor/avatar slot).
  const channel = supabase.channel(`project:${projectId}`, {
    config: {
      private: true,
      presence: { key: TAB_SESSION_ID },
      broadcast: { self: false, ack: false },
    },
  });

  // ── Presence ──────────────────────────────────────────────────────────────
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState<{ displayName: string; userId: string; sessionId: string; clockEpoch?: number }>();
    const users: CollaboratorPresence[] = [];
    for (const [sessionId, presences] of Object.entries(state)) {
      const p = presences[0] as any;
      if (!p?.userId) continue;
      users.push({
        userId: p.userId,
        sessionId,
        displayName: p.displayName ?? '',
        color: userColor(sessionId),
      });
    }
    liveBus.setPresence(users);

    // Converge to the earliest clockEpoch across all collaborators so noise/chaser
    // patterns stay in sync. Earliest wins because Date.now() is wall-clock time.
    let minEpoch = engineStore.clockEpoch;
    for (const presences of Object.values(state)) {
      const ep = (presences[0] as any)?.clockEpoch;
      if (typeof ep === 'number' && ep < minEpoch) minEpoch = ep;
    }
    if (minEpoch < engineStore.clockEpoch) {
      engineStore.setClockEpoch(minEpoch);
    }
  });

  // ── Postgres Changes: committed commands (existing tier) ──────────────────
  channel.on(
    'postgres_changes' as any,
    { event: 'INSERT', schema: 'public', table: 'project_changes', filter: `project_id=eq.${projectId}` },
    (change: any) => {
      const { sequence_number, user_id, command_type, payload } = change.new ?? {};
      if (sequence_number == null) return;
      if (sequence_number <= lastSeenSequenceNumber.value) return;
      lastSeenSequenceNumber.value = Math.max(lastSeenSequenceNumber.value, sequence_number);
      if (user_id === user.value?.id) return;

      const ctx = engineStore.getReplayContext();
      const cmd = commandFromPayload(command_type, payload, ctx);
      if (cmd) {
        history.executeRemote(cmd);
        triggerRef(engineStore.sceneNodes);
      }
    },
  );


  // ── Connect ────────────────────────────────────────────────────────────────
  async function connect() {
    // Force-refresh the session so setAuth always sends a valid (non-expired) JWT
    await supabase.auth.refreshSession();
    await supabase.realtime.setAuth();

    channel.subscribe(async (status, err) => {
      console.info('[collab] channel status:', status, err ?? '');

      if (status === 'SUBSCRIBED') {
        let userId = user.value?.id;
        let email = user.value?.email ?? '';
        let displayName = (user.value?.user_metadata as any)?.display_name ?? '';
        if (!userId) {
          const { data } = await supabase.auth.getUser();
          userId = data.user?.id ?? 'anon';
          email = data.user?.email ?? '';
          displayName = (data.user?.user_metadata as any)?.display_name ?? displayName;
        }
        if (!displayName) displayName = email ? email.split('@')[0] : userId;
        // Guard: only wire up the bus once; on reconnect just re-track presence
        if (!liveBus.isConnected) {
          liveBus.connect({ channel, userId });
        }
        await channel.track({ userId, displayName, sessionId: TAB_SESSION_ID, clockEpoch: engineStore.clockEpoch });
      }

      // On JWT expiry: refresh and re-authenticate so the next reconnect succeeds
      if (status === 'CHANNEL_ERROR') {
        console.warn('[collab] channel error, refreshing auth:', err);
        await supabase.auth.refreshSession();
        await supabase.realtime.setAuth();
      }
    });
  }

  function cleanup() {
    liveBus.disconnect();
    channel.unsubscribe();
    supabase.removeChannel(channel);
  }

  return { connect, cleanup };
}
