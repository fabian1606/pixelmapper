/**
 * Following a node after an IP change (plan M7.3, contract §5): ArtIpProg
 * takes effect at once, the reply still comes from the old IP, and then the
 * node answers polls from its new IP with the same UID. This composable
 * waits for that answer in the node directory — by `nodeId`, or by the new
 * IP for nodes identified only by IP — and polls the new IP directly while
 * waiting, so a node outside the broadcast domain is found as well.
 */
import { onScopeDispose, shallowRef, watch, type ShallowRef, type WatchStopHandle } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeDirectory } from '../bridge/node-directory';
import type { NodeState } from '../bridge/protocol-model';

/** Progress of following the node. */
export type FollowState =
  | { kind: 'idle' }
  /** Waiting for the node at `ip` (null = assigned by DHCP, not known in advance). */
  | { kind: 'waiting'; ip: string | null }
  /** The node answers at `ip` under `nodeId`. */
  | { kind: 'found'; ip: string; nodeId: string }
  /** No answer in time; still watching in case it comes late. */
  | { kind: 'lost'; ip: string | null };

/** Where the node is expected. */
export interface FollowTarget {
  /** New static IP; null when DHCP (or a reset) picks it. */
  ip: string | null;
  /** IP the node answered from before the change. */
  previousIp: string;
}

/** Default time until “no answer” is reported. */
export const FOLLOW_TIMEOUT_MS = 20_000;

/** Follows the node `nodeId()` to its new address (see file comment). */
export function useNodeFollow(
  backend: ArtNetBackend,
  directory: NodeDirectory,
  nodeId: () => string,
  onFound: (node: NodeState) => void,
  timeoutMs = FOLLOW_TIMEOUT_MS,
): { state: ShallowRef<FollowState>; start: (target: FollowTarget) => void; stop: () => void } {
  const state = shallowRef<FollowState>({ kind: 'idle' });
  let releasePoll: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopWatch: WatchStopHandle | null = null;
  /** Bumped per `start`, so a deferred stop never ends a newer follow. */
  let generation = 0;

  /** Ends polling, the timer and the watch (the state stays). */
  function stop() {
    releasePoll?.();
    releasePoll = null;
    if (timer) clearTimeout(timer);
    timer = null;
    stopWatch?.();
    stopWatch = null;
  }

  /** True when `node` shows the change took effect. */
  function arrived(node: NodeState, target: FollowTarget): boolean {
    if (target.ip) return node.ip === target.ip;
    return node.ip !== target.previousIp || node.status.dhcpConfigured;
  }

  /** Starts waiting for the node at `target`. */
  function start(target: FollowTarget) {
    stop();
    const mine = ++generation;
    state.value = { kind: 'waiting', ip: target.ip };
    if (target.ip && target.ip !== target.previousIp) releasePoll = backend.addPollTarget(target.ip);
    timer = setTimeout(() => {
      timer = null;
      if (state.value.kind === 'waiting') state.value = { kind: 'lost', ip: target.ip };
    }, timeoutMs);
    stopWatch = watch(
      () => directory.getNode(nodeId()) ?? (target.ip ? directory.findByIp(target.ip) : undefined),
      (node) => {
        if (!node || !arrived(node, target)) return;
        state.value = { kind: 'found', ip: node.ip, nodeId: node.nodeId };
        // The connector re-targets its own poll by the node's new IP; ours is no longer needed.
        // Deferred: with `immediate` this runs before `watch` returned its stop handle.
        queueMicrotask(() => { if (mine === generation) stop(); });
        onFound(node);
      },
      { immediate: true },
    );
  }

  onScopeDispose(stop);
  return { state, start, stop };
}
