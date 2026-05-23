import { defineStore } from 'pinia';
import { ref, shallowRef, triggerRef, nextTick } from 'vue';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEngineStore } from '~/stores/engine-store';
import { userColor } from '~/composables/live-ops/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveContext {
  cursors: Map<string, CursorState>;
  remoteSelections: Map<string, Set<string | number>>;
  remoteEditingModifier: Map<string, string | null>;
  remoteEditSteps: Map<string, number>;        // key: `${userId}:${fixtureId}`
  remoteCameras: Map<string, { x: number; y: number; scale: number; context?: 'editor' | 'live'; livePageId?: string }>;
  triggerCursorUpdate: () => void;
  triggerSelectionUpdate: () => void;
  triggerEditingModifierUpdate: () => void;
  triggerEditStepUpdate: () => void;
  triggerCameraUpdate: () => void;
  displayNameOf: (userId: string) => string;
  colorOf: (userId: string) => string;
  engineStore: ReturnType<typeof useEngineStore>;
}

export interface CursorState {
  userId: string;
  sessionId: string;
  displayName: string;
  color: string;
  wx: number;
  wy: number;
  context?: 'editor' | 'live';
  livePageId?: string;
}

export interface CollaboratorPresence {
  userId: string;
  sessionId: string;
  displayName: string;
  color: string;
  viewMode?: 'editor' | 'live';
  livePageId?: string;
  /** Per-tab list of hardware controllers this collaborator currently has open. */
  controllers?: PresenceController[];
}

export interface PresenceController {
  id: string;
  definitionKey: string;
  deviceLabel?: string | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
}

export interface LiveOpConfig<T = any> {
  scope: 'shared' | 'per-user';
  throttle: 'raf' | 'immediate' | number;
  /** Replace pending op of same type (default), or append (e.g. queue of distinct events) */
  merge?: 'replace' | 'append';
  /** @deprecated Use `persist` instead — kept as alias for migration. */
  persistent?: boolean;
  /**
   * Op effect should land in `project_changes` (event log) so reload replays it.
   * Independent of `broadcast`: a persistent op also marks the engine dirty so a
   * compacting snapshot is scheduled. Awareness ops (cursor, selection, camera,
   * preview-style events) leave this unset.
   */
  persist?: boolean;
  /** Whether to broadcast this op to peers via the realtime channel. Default true. */
  broadcast?: boolean;
  /**
   * Optional dedup key for the persist queue: ops with the same key within a
   * flush window are coalesced (only the latest payload survives). Default
   * behaviour: ops with `merge: 'replace'` (or unset) dedup by their type; ops
   * with `merge: 'append'` are never deduped.
   */
  coalesceKey?: (payload: T) => string;
  apply: (payload: T, userId: string, ctx: LiveContext, sessionId: string) => void;
}

export interface LiveOp<T = any> {
  type: string;
  payload: T;
  userId: string;
  sessionId?: string;
}

// ─── Registry (module-level; populated by live-ops/*.ts at import time) ───────

const registry = new Map<string, LiveOpConfig>();

export function registerLiveOp<T>(type: string, config: LiveOpConfig<T>) {
  registry.set(type, config as LiveOpConfig);
}

export function getLiveOpConfig(type: string): LiveOpConfig | undefined {
  return registry.get(type);
}

function isPersistent(config: LiveOpConfig): boolean {
  return config.persist ?? config.persistent ?? false;
}

// ─── Persist queue (DB-tail, shared between LiveBus and history commands) ────
// Both `dispatch()` for persistent live-ops and the history layer push entries
// here. A single in-flight guard (`inFlightFlush`) serializes the round-trip
// to the push-change edge function so `lastSeenSequenceNumber` stays accurate
// across snapshots. Coalescing (dedupKey) keeps per-frame ops like knob drags
// from filling the event log with 60Hz junk — only the latest payload per key
// inside a settle window is persisted.

export interface PersistEntry {
  type: string;
  payload: any;
  /** Client-generated idempotency key (UUID). Optional for legacy live-op
   *  dispatches that don't go through the history layer; history-originated
   *  entries always carry one so WAL ACK can target them precisely. */
  changeId?: string;
  dedupKey?: string;
  resolve?: (seq: number | undefined) => void;
  reject?: (err: unknown) => void;
}

export type PersistHook = (
  entries: Array<{ type: string; payload: any; changeId?: string }>,
) => Promise<Array<number | undefined>>;

/** Called after a successful flush with all `changeId`s the server acknowledged. */
export type PersistAckHook = (changeIds: string[]) => void;

// Reduced from 250ms — the WAL makes correctness independent of this window, so
// we only need enough batching to coalesce same-frame writes. 50ms gives ~3
// animation frames of grace for back-to-back commands without spamming the
// server with one request per command.
const PERSIST_SETTLE_MS = 50;

const persistByKey = new Map<string, PersistEntry>();
const persistAppend: PersistEntry[] = [];
let persistFlushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightFlush: Promise<void> | null = null;
let persistHook: PersistHook | null = null;
let persistAckHook: PersistAckHook | null = null;

export function setPersistHook(hook: PersistHook | null): void {
  persistHook = hook;
}

export function setPersistAckHook(hook: PersistAckHook | null): void {
  persistAckHook = hook;
}

export function enqueuePersist(entry: PersistEntry): void {
  if (entry.dedupKey) {
    // Replacing an earlier entry: resolve its promise with undefined so the
    // history layer's .then() can still increment its commands-since-snapshot
    // counter without leaving an orphaned, never-resolving promise behind.
    const prev = persistByKey.get(entry.dedupKey);
    if (prev && prev !== entry) prev.resolve?.(undefined);
    persistByKey.set(entry.dedupKey, entry);
  } else {
    persistAppend.push(entry);
  }
  if (persistFlushTimer != null) clearTimeout(persistFlushTimer);
  persistFlushTimer = setTimeout(() => { flushPersistQueue(); }, PERSIST_SETTLE_MS);
}

/**
 * Drain pending persist entries to the configured hook. Serialized via
 * `inFlightFlush`: a second concurrent caller awaits the in-flight round-trip,
 * then runs its own pass. Safe to call from doSaveSnapshot, beforeunload, or
 * Cmd+S — guarantees that `lastSeenSequenceNumber` (updated synchronously
 * inside the hook) reflects every entry that was queued before the call.
 */
export async function flushPersistQueue(): Promise<void> {
  if (inFlightFlush) await inFlightFlush;
  if (persistFlushTimer != null) { clearTimeout(persistFlushTimer); persistFlushTimer = null; }
  if (persistByKey.size === 0 && persistAppend.length === 0) return;
  if (!persistHook) return; // hook not wired yet — keep entries, next dispatch will re-arm timer

  const batch: PersistEntry[] = [...persistByKey.values(), ...persistAppend];
  persistByKey.clear();
  persistAppend.length = 0;

  inFlightFlush = (async () => {
    try {
      const seqs = await persistHook!(batch.map(e => ({ type: e.type, payload: e.payload, changeId: e.changeId })));
      for (let i = 0; i < batch.length; i++) batch[i].resolve?.(seqs[i]);
      // Notify WAL that these changeIds are durable on the server now — but
      // ONLY for entries where the server actually returned a sequence number.
      // Entries with undefined seq either failed silently on the server or were
      // dropped from the response; keep them in the WAL so the next loadProject
      // recovery retries via the idempotent push-change endpoint.
      if (persistAckHook) {
        const ackedIds: string[] = [];
        for (let i = 0; i < batch.length; i++) {
          const e = batch[i];
          if (e.changeId && seqs[i] != null) ackedIds.push(e.changeId);
        }
        if (ackedIds.length > 0) persistAckHook(ackedIds);
      }
    } catch (err) {
      console.warn('[LiveBus] persist flush failed:', err);
      // Re-queue dedup entries only if no newer payload has arrived since;
      // append entries are unconditionally re-queued so history commands don't
      // silently disappear. The rejected promises let callers see the failure.
      for (const e of batch) {
        if (e.dedupKey) {
          if (!persistByKey.has(e.dedupKey)) persistByKey.set(e.dedupKey, e);
        } else {
          persistAppend.push(e);
        }
        e.reject?.(err);
      }
      if (persistByKey.size > 0 || persistAppend.length > 0) {
        if (persistFlushTimer != null) clearTimeout(persistFlushTimer);
        persistFlushTimer = setTimeout(() => { flushPersistQueue(); }, PERSIST_SETTLE_MS);
      }
    }
  })();
  try { await inFlightFlush; } finally { inFlightFlush = null; }
}

/** Snapshot of pending persist entries — used by beforeunload to drain via keepalive fetch. */
export function getPersistQueueSnapshot(): Array<{ type: string; payload: any; changeId?: string }> {
  return [...persistByKey.values(), ...persistAppend]
    .map(e => ({ type: e.type, payload: e.payload, changeId: e.changeId }));
}

/** Drop all pending entries without resolving callers. Used on project switch
 *  to discard ops queued against the previous project. Callers that care about
 *  not losing data must `await flushPersistQueue()` before calling this. */
export function clearPersistQueue(): void {
  for (const e of persistByKey.values()) e.resolve?.(undefined);
  for (const e of persistAppend) e.resolve?.(undefined);
  persistByKey.clear();
  persistAppend.length = 0;
  if (persistFlushTimer != null) { clearTimeout(persistFlushTimer); persistFlushTimer = null; }
}

// ─── Pinia Store ──────────────────────────────────────────────────────────────

// Unique per browser tab — used to filter own echoes without blocking same-user multi-tab
// Also exported so the presence layer (use-collaboration) can use it as the presence key,
// so each tab/connection appears as its own presence entry.
export const TAB_SESSION_ID = Math.random().toString(36).slice(2);

export const useLiveBusStore = defineStore('live-bus', () => {
  // Capture Nuxt app refs at setup time so they remain valid when accessed
  // later from non-component callbacks (e.g. Supabase channel events).
  const router = useRouter();
  const currentRoute = useRoute();

  // Channel + connection state
  let channel: RealtimeChannel | null = null;
  let currentUserId: string | null = null;
  let currentProjectId: string | null = null;
  let presenceDisplayNames = new Map<string, string>();
  const isConnected = ref(false);

  // Per-user awareness state (Schicht B)
  const cursors = shallowRef(new Map<string, CursorState>());
  const remoteSelections = shallowRef(new Map<string, Set<string | number>>());
  const remoteEditingModifier = shallowRef(new Map<string, string | null>());
  const remoteEditSteps = shallowRef(new Map<string, number>());
  const remoteCameras = shallowRef(new Map<string, { x: number; y: number; scale: number; context?: 'editor' | 'live'; livePageId?: string }>());

  // Presence (online users)
  const presenceUsers = ref<CollaboratorPresence[]>([]);

  // Follow mode — sessionId of the remote user we're tracking
  const followedSessionId = ref<string | null>(null);
  // Last-known location of the followed user. We only auto-navigate when this
  // changes, so the local user can manually navigate away without being yanked
  // back by every presence sync.
  let lastFollowedLocation: { viewMode?: 'editor' | 'live'; livePageId?: string } | null = null;

  // Pending outbound ops (batched per rAF)
  // For 'replace' merge: latest op per type wins
  // For 'append' merge: ops accumulate in array
  const pendingReplace = new Map<string, any>();
  const pendingAppend: Array<LiveOp> = [];
  let rafScheduled = false;

  // ─── Context passed to apply handlers ─────────────────────────────────────
  // Built lazily once and reused — getters keep the values up-to-date even
  // when shallowRef .value is reassigned (e.g. on disconnect()).
  let cachedContext: LiveContext | null = null;
  function getContext(): LiveContext {
    if (cachedContext) return cachedContext;
    const eng = useEngineStore();
    cachedContext = {
      get cursors() { return cursors.value; },
      get remoteSelections() { return remoteSelections.value; },
      get remoteEditingModifier() { return remoteEditingModifier.value; },
      get remoteEditSteps() { return remoteEditSteps.value; },
      get remoteCameras() { return remoteCameras.value; },
      triggerCursorUpdate: () => triggerRef(cursors),
      triggerSelectionUpdate: () => triggerRef(remoteSelections),
      triggerEditingModifierUpdate: () => triggerRef(remoteEditingModifier),
      triggerEditStepUpdate: () => triggerRef(remoteEditSteps),
      triggerCameraUpdate: () => triggerRef(remoteCameras),
      displayNameOf: (userId: string) => presenceDisplayNames.get(userId) ?? '',
      colorOf: (userId: string) => userColor(userId),
      engineStore: eng,
    } as LiveContext;
    return cachedContext;
  }

  // ─── Outbound dispatch ─────────────────────────────────────────────────────
  // Persistence is independent of broadcast: a persistent op MUST land in the
  // event log even when the realtime channel is offline (solo session, initial
  // load before SUBSCRIBED, transient network drop). Previously this dispatch
  // returned early when disconnected, which silently lost BPM, modifier scrubs,
  // color overrides etc. across reloads.
  function dispatch<T>(type: string, payload: T) {
    const config = registry.get(type);
    if (!config) {
      console.warn(`[LiveBus] No config for op "${type}"`);
      return;
    }

    const persist = isPersistent(config);
    const broadcast = config.broadcast ?? true;

    if (persist) {
      const dedupKey = config.coalesceKey?.(payload)
        ?? (config.merge !== 'append' ? type : undefined);
      enqueuePersist({ type, payload, dedupKey });
      // Mark engine dirty so the snapshot timer also runs as a compaction
      // safety net. dispatch() is local-origin only, so no isApplyingRemote
      // guard needed.
      useEngineStore().markEngineDirty?.();
    }

    if (!broadcast) return;
    if (!isConnected.value || !channel || !currentUserId) return;
    // Solo session — no peers to receive the broadcast. Persistence already
    // ran above, so reloads still see the latest state via the event log.
    if (presenceUsers.value.length <= 1) return;

    const op: LiveOp<T> = { type, payload, userId: currentUserId, sessionId: TAB_SESSION_ID };

    if (config.throttle === 'immediate') {
      sendOps([op]);
      return;
    }

    if (config.merge === 'append') {
      pendingAppend.push(op);
    } else {
      pendingReplace.set(type, op);
    }

    if (config.throttle === 'raf') {
      scheduleRafFlush();
    } else if (typeof config.throttle === 'number') {
      // Simple timer-based throttle (per-type)
      scheduleTimerFlush(type, config.throttle);
    }
  }

  function scheduleRafFlush() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(flushPending);
  }

  const timerHandles = new Map<string, ReturnType<typeof setTimeout>>();
  function scheduleTimerFlush(type: string, ms: number) {
    if (timerHandles.has(type)) return;
    const handle = setTimeout(() => {
      timerHandles.delete(type);
      flushPending();
    }, ms);
    timerHandles.set(type, handle);
  }

  function flushPending() {
    rafScheduled = false;
    const ops: LiveOp[] = [];
    for (const op of pendingReplace.values()) ops.push(op);
    pendingReplace.clear();
    if (pendingAppend.length > 0) {
      ops.push(...pendingAppend);
      pendingAppend.length = 0;
    }
    if (ops.length === 0) return;
    sendOps(ops);
  }

  function sendOps(ops: LiveOp[]) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'live_ops', payload: { ops } });
  }

  // ─── Inbound handler ───────────────────────────────────────────────────────
  let _applyingRemote = false;

  /** True while a remote op's apply() is running — used to suppress echo-dispatch */
  function isApplyingRemote() { return _applyingRemote; }

  function handleIncoming(ops: LiveOp[]) {
    if (!Array.isArray(ops)) return;
    const ctx = getContext();
    let touched = false;
    for (const op of ops) {
      if (!op?.type || !op.userId) continue;
      if (op.sessionId === TAB_SESSION_ID) continue;
      const config = registry.get(op.type);
      if (!config) {
        console.warn(`[LiveBus] Received unknown op "${op.type}"`);
        continue;
      }
      try {
        _applyingRemote = true;
        touched = true;
        config.apply(op.payload, op.userId, ctx, op.sessionId ?? '');
      } catch (e) {
        console.error(`[LiveBus] apply failed for "${op.type}":`, e);
      }
    }
    // Hold the flag until Vue's reactive watchers have fired so the central
    // channel-sync watcher in engine-store sees isApplyingRemote() === true
    // and skips the echo dispatch.
    if (touched) {
      nextTick(() => { _applyingRemote = false; });
    } else {
      _applyingRemote = false;
    }
  }

  // ─── Connect / Disconnect ──────────────────────────────────────────────────
  function connect(opts: {
    channel: RealtimeChannel;
    userId: string;
    projectId: string;
  }) {
    channel = opts.channel;
    currentUserId = opts.userId;
    currentProjectId = opts.projectId;

    channel.on('broadcast', { event: 'live_ops' }, ({ payload }) => {
      handleIncoming(payload?.ops ?? []);
    });

    isConnected.value = true;
    console.info(`[LiveBus] connected — session=${TAB_SESSION_ID} user=${opts.userId}`);
  }

  function setPresence(users: CollaboratorPresence[]) {
    presenceUsers.value = users;
    const names = new Map<string, string>();
    for (const u of users) {
      names.set(u.userId, u.displayName);
    }
    presenceDisplayNames = names;

    // Follow-mode navigation is now driven by the explicit `user.pageChange`
    // event (see handlePageChange). Presence is only used for the avatars and
    // initial follow target — not to drive automatic navigation, otherwise
    // every presence sync would yank the local user back.

    // GC any per-session / per-user state for connections that have left.
    // Sync fires after every join/leave, so this is the single source of truth
    // for which sessions/users are still around.
    const aliveSessions = new Set(users.map(u => u.sessionId));
    const aliveUserIds = new Set(users.map(u => u.userId));

    let cursorDirty = false;
    for (const key of cursors.value.keys()) {
      if (!aliveSessions.has(key)) {
        cursors.value.delete(key);
        cursorDirty = true;
      }
    }
    if (cursorDirty) triggerRef(cursors);

    let selDirty = false;
    for (const uid of remoteSelections.value.keys()) {
      if (!aliveUserIds.has(uid)) {
        remoteSelections.value.delete(uid);
        selDirty = true;
      }
    }
    if (selDirty) triggerRef(remoteSelections);

    let modDirty = false;
    for (const uid of remoteEditingModifier.value.keys()) {
      if (!aliveUserIds.has(uid)) {
        remoteEditingModifier.value.delete(uid);
        modDirty = true;
      }
    }
    if (modDirty) triggerRef(remoteEditingModifier);

    let stepDirty = false;
    for (const k of remoteEditSteps.value.keys()) {
      const uid = k.split(':')[0];
      if (!aliveUserIds.has(uid)) {
        remoteEditSteps.value.delete(k);
        stepDirty = true;
      }
    }
    if (stepDirty) triggerRef(remoteEditSteps);
  }

  function disconnect() {
    isConnected.value = false;
    channel = null;
    currentUserId = null;
    currentProjectId = null;
    lastFollowedLocation = null;
    pendingReplace.clear();
    pendingAppend.length = 0;
    for (const h of timerHandles.values()) clearTimeout(h);
    timerHandles.clear();
    cursors.value = new Map();
    remoteSelections.value = new Map();
    remoteEditingModifier.value = new Map();
    remoteEditSteps.value = new Map();
    remoteCameras.value = new Map<string, { x: number; y: number; scale: number; context?: 'editor' | 'live'; livePageId?: string }>();
    presenceUsers.value = [];
  }

  // Called by the user.pageChange live op when a remote user navigates between
  // editor/live or switches the active live page. If we're following them,
  // navigate locally to match.
  function handlePageChange(
    sessionId: string,
    payload: { viewMode: 'editor' | 'live'; livePageId?: string },
  ) {
    if (followedSessionId.value !== sessionId) return;
    if (!currentProjectId) return;
    if (!currentRoute.path.startsWith(`/project/${currentProjectId}`)) return;

    lastFollowedLocation = { viewMode: payload.viewMode, livePageId: payload.livePageId };
    const targetPath = payload.viewMode === 'live'
      ? `/project/${currentProjectId}/live`
      : `/project/${currentProjectId}`;
    if (currentRoute.path !== targetPath) {
      router.push(targetPath);
    }
    if (payload.viewMode === 'live' && payload.livePageId) {
      import('~/stores/live-mode-store').then(({ useLiveModeStore }) => {
        const liveStore = useLiveModeStore();
        if (liveStore.activePageId !== payload.livePageId) {
          liveStore.setActivePage(payload.livePageId!);
        }
      });
    }
  }

  function toggleFollow(sessionId: string) {
    const turningOn = followedSessionId.value !== sessionId;
    followedSessionId.value = turningOn ? sessionId : null;

    if (!turningOn) {
      // Unfollow → clear the snapshot so re-following someone in the same
      // location later is treated as a "change" and triggers navigation again.
      lastFollowedLocation = null;
      return;
    }

    // Just started following — jump to their location once.
    if (!currentProjectId) return;
    const followed = presenceUsers.value.find(u => u.sessionId === sessionId);
    if (!followed?.viewMode) {
      lastFollowedLocation = null;
      return;
    }

    lastFollowedLocation = { viewMode: followed.viewMode, livePageId: followed.livePageId };
    const targetPath = followed.viewMode === 'live'
      ? `/project/${currentProjectId}/live`
      : `/project/${currentProjectId}`;
    if (currentRoute.path !== targetPath) {
      router.push(targetPath);
    }
    if (followed.viewMode === 'live' && followed.livePageId) {
      import('~/stores/live-mode-store').then(({ useLiveModeStore }) => {
        useLiveModeStore().setActivePage(followed.livePageId!);
      });
    }
  }

  return {
    isConnected,
    cursors,
    remoteSelections,
    remoteEditingModifier,
    remoteEditSteps,
    remoteCameras,
    presenceUsers,
    followedSessionId,
    toggleFollow,
    handlePageChange,
    dispatch,
    connect,
    disconnect,
    setPresence,
    isApplyingRemote,
  };
});
