import { triggerRef, watch } from 'vue';
import { useHistory } from '~/components/engine/composables/use-history';
import { commandFromPayload } from '~/components/engine/commands/serializable-command';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore, type CollaboratorPresence, type PresenceController, TAB_SESSION_ID } from '~/stores/live-bus-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useControllerStore } from '~/stores/controller-store';
import { userColor } from '~/composables/live-ops/colors';
import { dispatchChannelUpdate } from '~/composables/dispatch-channel-update';
import { snapshotTwinStates } from '~/composables/live-ops/twin-state-hub';
import { isNetworkError, isOnline, onReconnect, reportNetworkFailure } from '~/utils/sync/connectivity';
import { getOpenSyncEngine } from '~/utils/sync/open-sync-engine';
import type { RemoteInsert } from '~/utils/sync/sync-engine';

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
  const controllerStore = useControllerStore();

  function snapshotControllers(): PresenceController[] {
    return Array.from(controllerStore.drivers.values()).map(d => ({
      id: d.id,
      definitionKey: d.definitionKey,
      deviceLabel: d.deviceLabel as unknown as string | null,
      status: d.status as unknown as PresenceController['status'],
    }));
  }

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
    const state = channel.presenceState<{ displayName: string; userId: string; sessionId: string; clockEpoch?: number; viewMode?: 'editor' | 'live'; livePageId?: string; controllers?: PresenceController[] }>();
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
        controllers: Array.isArray(p.controllers) ? p.controllers : undefined,
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
    const effects = engineStore.modifiers;
    if (effects?.length) {
      liveBus.dispatch('modifier.sync', { effects: JSON.parse(JSON.stringify(effects)) });
    }

    // Push controller-twin visual state (held buttons + fader positions) so
    // late-joining peers see the twins in their current state, not the default.
    // Bundled into one op because widget.slide is rAF-throttled with replace-merge —
    // dispatching individually would coalesce all faders down to the last one.
    const twins = snapshotTwinStates()
      .map(t => ({
        pageId: t.pageId,
        widgetId: t.widgetId,
        pressed: t.getPressed(),
        faders: t.getFaderValues(),
      }))
      .filter(t => t.pressed.length > 0 || t.faders.length > 0);

    // Also push latched section state for the active page so late joiners see
    // single-/multi-select latches, not just momentary presses.
    const activePageId = liveModeStore.activePageId;
    const sections = activePageId
      ? Array.from(liveModeStore.activeSectionMembers.entries())
          .filter(([, keys]) => keys.size > 0)
          .map(([sectionId, keys]) => ({
            pageId: activePageId,
            sectionId,
            keys: Array.from(keys),
          }))
      : [];

    if (twins.length || sections.length) {
      liveBus.dispatch('twin.snapshot', { twins, sections });
    }
  });

  // ── Postgres Changes: committed commands (existing tier) ──────────────────
  // Realtime is the fast path; the project's SyncEngine dedupes rows by
  // change id (own echoes, rows already pulled) and records them so pulls
  // never apply them twice (ADR 0004 §3.2). Live-op rows are only recorded:
  // peers apply them from the LiveBus broadcast.
  /** Apply a foreign committed command (history, so it can be undone). */
  function applyRemoteRow(row: RemoteInsert) {
    const cmd = commandFromPayload(row.commandType, row.payload as object, engineStore.getReplayContext());
    if (!cmd) return;
    history.executeRemote(cmd);
    triggerRef(engineStore.sceneNodes);
    engineStore.scheduleWorkingSnapshot();
  }

  channel.on(
    'postgres_changes' as any,
    { event: 'INSERT', schema: 'public', table: 'project_changes', filter: `project_id=eq.${projectId}` },
    (change: any) => {
      const { sequence_number, change_id, user_id, command_type, payload } = change.new ?? {};
      if (typeof sequence_number !== 'number') return;
      const engine = getOpenSyncEngine(projectId);
      // No engine (signed out / unbound copy): nothing is synced, ignore.
      if (!engine) return;
      engine.setRemoteApplier(applyRemoteRow);
      engine.handleRemoteInsert({
        sequenceNumber: sequence_number,
        // Rows without a change id (very old clients) get a stable stand-in.
        changeId: typeof change_id === 'string' && change_id ? change_id : `seq:${sequence_number}`,
        userId: user_id ?? '',
        commandType: command_type,
        payload,
      });
    },
  );


  // ── Connect ────────────────────────────────────────────────────────────────
  // Offline-tolerant (ADR 0004 D9/D10): connecting never throws. While offline
  // the subscription is deferred to `onReconnect`; after a reconnect the JWT
  // is refreshed and handed to realtime so the socket's rejoin succeeds.
  let disposed = false;
  let subscribed = false;
  let stopReconnect: (() => void) | null = null;

  /** Refresh the session (if possible) and pass the JWT to realtime. Never throws. */
  async function refreshRealtimeAuth(): Promise<void> {
    try {
      // Force-refresh so setAuth always sends a valid (non-expired) JWT.
      const { error } = await supabase.auth.refreshSession();
      if (error && isNetworkError(error)) reportNetworkFailure();
      await supabase.realtime.setAuth();
    } catch (err) {
      if (isNetworkError(err)) reportNetworkFailure();
      console.warn('[collab] auth refresh failed:', err);
    }
  }

  /** Subscribe once online; offline → wait for the reconnect listener. */
  async function connect() {
    // Re-auth + (re)subscribe on every offline → online transition.
    stopReconnect ??= onReconnect(() => { void handleReconnect(); });
    if (!isOnline.value) {
      console.info('[collab] offline — realtime connection deferred until reconnect');
      return;
    }
    await refreshRealtimeAuth();
    subscribeChannel();
  }

  /** Back online: fresh JWT for the socket, subscribe if never/no longer joined. */
  async function handleReconnect() {
    if (disposed) return;
    await refreshRealtimeAuth();
    if (disposed) return;
    // A closed channel (never joined, or closed by the server) can be
    // re-subscribed; a joined/errored one is rejoined by realtime itself.
    if (!subscribed || channel.state === 'closed') subscribeChannel();
  }

  /** Subscribe the channel and wire presence/bus on SUBSCRIBED. */
  function subscribeChannel() {
    if (disposed) return;
    subscribed = true;
    try {
      channel.subscribe(onChannelStatus);
    } catch (err) {
      console.warn('[collab] subscribe failed:', err);
    }
  }

  /** Channel status callback (SUBSCRIBED → wire bus + track presence). */
  async function onChannelStatus(status: string, err?: Error) {
    try {
      await handleChannelStatus(status, err);
    } catch (e) {
      // Never let a presence/auth hiccup become an unhandled rejection.
      if (isNetworkError(e)) reportNetworkFailure();
      console.warn('[collab] channel status handling failed:', e);
    }
  }

  /** Status handling proper — may throw; wrapped by `onChannelStatus`. */
  async function handleChannelStatus(status: string, err?: Error) {
    {
      console.info('[collab] channel status:', status, err ?? '');

      if (status === 'SUBSCRIBED') {
        // Events may have been missed while (re)joining: pull to fill the gap.
        getOpenSyncEngine(projectId)?.handleRealtimeSubscribed();
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
          controllers: snapshotControllers(),
        });
      }

      // On JWT expiry: refresh and re-authenticate so the next reconnect
      // succeeds. Offline this is skipped — `handleReconnect` does it later.
      if (status === 'CHANNEL_ERROR' && isOnline.value) {
        console.warn('[collab] channel error, refreshing auth:', err);
        await refreshRealtimeAuth();
      }
    }
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
        // Offline-safe: a failed presence update must not become an unhandled rejection.
        try {
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
            controllers: snapshotControllers(),
          });
        } catch (err) {
          console.warn('[collab] presence update failed:', err);
        }
        // Emit explicit page-change event so followers navigate exactly once.
        liveBus.dispatch('user.pageChange', { viewMode, livePageId: livePageIdValue });
      },
    );
  }

  // Re-track presence when our local controller list or any driver's status
  // changes, so collaborators see what hardware we have open in real time.
  let stopControllerWatch: (() => void) | null = null;
  function startControllerWatch() {
    stopControllerWatch = watch(
      // Read each driver's reactive fields so the watcher subscribes to them.
      () => snapshotControllers(),
      async () => {
        if (!liveBus.isConnected) return;
        // Offline-safe: a failed presence update must not become an unhandled rejection.
        try {
          const userId = user.value?.id ?? (await supabase.auth.getUser()).data.user?.id ?? 'anon';
          const displayName = (user.value?.user_metadata as any)?.display_name ?? userId;
          await channel.track({
            userId,
            displayName,
            sessionId: TAB_SESSION_ID,
            clockEpoch: engineStore.clockEpoch,
            viewMode: getViewMode(route.path),
            livePageId: liveModeStore.activePageId ?? undefined,
            controllers: snapshotControllers(),
          });
        } catch (err) {
          console.warn('[collab] presence update failed:', err);
        }
      },
      { deep: true },
    );
  }

  const _originalConnect = connect;
  async function connectWithRouteWatch() {
    await _originalConnect();
    startRouteWatch();
    startControllerWatch();
  }

  function cleanup() {
    disposed = true;
    stopReconnect?.();
    stopReconnect = null;
    stopRouteWatch?.();
    stopControllerWatch?.();
    liveBus.disconnect();
    channel.unsubscribe();
    supabase.removeChannel(channel);
  }

  return { connect: connectWithRouteWatch, cleanup };
}
