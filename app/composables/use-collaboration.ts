import { triggerRef, watch } from 'vue';
import { useHistory, lastSeenSequenceNumber } from '~/components/engine/composables/use-history';
import { commandFromPayload } from '~/components/engine/commands/serializable-command';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore, type CollaboratorPresence, TAB_SESSION_ID } from '~/stores/live-bus-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { userColor } from '~/composables/live-ops/colors';
import { dispatchChannelUpdate } from '~/composables/dispatch-channel-update';

// Side-effect imports: register all live ops and live widget commands
import '~/composables/live-ops';
import '~/components/engine/commands/live-widget-commands';

export interface CollaborationContext {
  connect: () => Promise<void>;
  cleanup: () => void;
}

function getViewMode(path: string): 'editor' | 'live' {
  return path.endsWith('/live') ? 'live' : 'editor';
}

export function useCollaboration(projectId: string): CollaborationContext {
  const supabase = useSupabaseClient();
  const user = useSupabaseUser();
  const route = useRoute();
  const liveModeStore = useLiveModeStore();

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

  // Becomes true once we have seen our own session in a presence:sync. From that
  // point on, any presence:join is a genuinely new peer (not part of the initial
  // flood of joins Supabase fires for already-present sessions when we subscribe).
  let initialPresenceSettled = false;

  // ── Presence ──────────────────────────────────────────────────────────────
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState<{ displayName: string; userId: string; sessionId: string; clockEpoch?: number; viewMode?: 'editor' | 'live'; livePageId?: string }>();
    const users: CollaboratorPresence[] = [];
    for (const [sessionId, presences] of Object.entries(state)) {
      const p = presences[0] as any;
      if (!p?.userId) continue;
      users.push({
        userId: p.userId,
        sessionId,
        displayName: p.displayName ?? '',
        color: userColor(sessionId),
        viewMode: p.viewMode,
        livePageId: p.livePageId,
      });
    }
    liveBus.setPresence(users);

    // Mark the channel as bootstrapped once our own track has propagated.
    if (!initialPresenceSettled && state[TAB_SESSION_ID]) {
      initialPresenceSettled = true;
    }

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

  // ── Presence join: push full live state to newly connected clients ────────
  // Only fires for genuinely new peers — the initial flood of joins for already-
  // present sessions is gated by `initialPresenceSettled`. This prevents a
  // reloading client from pushing its stale snapshot to existing live clients.
  channel.on('presence', { event: 'join' }, ({ key }: any) => {
    if (!liveBus.isConnected) return;
    if (!initialPresenceSettled) return;
    if (key === TAB_SESSION_ID) return;

    // Push fixture positions
    const flat = engineStore.flatFixtures;
    if (flat.length) {
      liveBus.dispatch('fixture.drag', {
        fixtures: flat.map((f: any) => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y })),
      });
    }

    // Push channel state (stepValues / colorValue)
    dispatchChannelUpdate(flat);

    // Push modifier/effect state
    const effects = engineStore.activeEffects;
    if (effects?.length) {
      liveBus.dispatch('modifier.sync', { effects: JSON.parse(JSON.stringify(effects)) });
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
          liveBus.connect({ channel, userId, projectId });
        }
        await channel.track({
          userId,
          displayName,
          sessionId: TAB_SESSION_ID,
          clockEpoch: engineStore.clockEpoch,
          viewMode: getViewMode(route.path),
          livePageId: liveModeStore.activePageId ?? undefined,
        });
      }

      // On JWT expiry: refresh and re-authenticate so the next reconnect succeeds
      if (status === 'CHANNEL_ERROR') {
        console.warn('[collab] channel error, refreshing auth:', err);
        await supabase.auth.refreshSession();
        await supabase.realtime.setAuth();
      }
    });
  }

  // Re-track presence when user navigates between editor and live sub-pages
  // so that other clients can see their viewMode change in real time.
  let stopRouteWatch: (() => void) | null = null;

  function startRouteWatch() {
    stopRouteWatch = watch(
      [() => route.path, () => liveModeStore.activePageId],
      async ([path, livePageId]) => {
        if (!liveBus.isConnected) return;
        const viewMode = getViewMode(path as string);
        const livePageIdValue = (livePageId as string | null) ?? undefined;
        const userId = user.value?.id ?? (await supabase.auth.getUser()).data.user?.id ?? 'anon';
        const displayName = (user.value?.user_metadata as any)?.display_name ?? userId;
        // Update presence for avatars / initial follow target.
        await channel.track({
          userId,
          displayName,
          sessionId: TAB_SESSION_ID,
          clockEpoch: engineStore.clockEpoch,
          viewMode,
          livePageId: livePageIdValue,
        });
        // Emit explicit page-change event so followers navigate exactly once.
        liveBus.dispatch('user.pageChange', { viewMode, livePageId: livePageIdValue });
      },
    );
  }

  const _originalConnect = connect;
  async function connectWithRouteWatch() {
    await _originalConnect();
    startRouteWatch();
  }

  function cleanup() {
    stopRouteWatch?.();
    liveBus.disconnect();
    channel.unsubscribe();
    supabase.removeChannel(channel);
  }

  return { connect: connectWithRouteWatch, cleanup };
}
