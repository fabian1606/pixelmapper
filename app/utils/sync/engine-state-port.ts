import type { ProjectSnapshot } from '~/utils/engine/serialize';
import { commandFromPayload, type ReplayContext } from '~/components/engine/commands/serializable-command';
import { getLiveOpConfig, type LiveContext } from '~/stores/live-bus-store';
import type { ProjectStatePort, ReplayableChange } from '~/utils/sync/project-state-port';

/**
 * `ProjectStatePort` over the engine store (ADR 0004 §3.2): the same snapshot
 * apply and command / live-op replay registry that loading a project uses.
 */

/** What the engine store provides to build the port. */
export interface EngineStatePortHost {
  /** Serialize the live project (`buildSnapshot`). */
  buildSnapshot(): ProjectSnapshot;
  /** Replace the live project (`applyProjectSnapshot`). */
  applySnapshot(snapshot: ProjectSnapshot): void;
  /** Context for command factories. */
  replayContext(): ReplayContext;
  /** The engine store (live-op handlers mutate it). */
  engineStore: LiveContext['engineStore'];
}

/**
 * Minimal `LiveContext` for replaying live-ops without a realtime channel:
 * only the engine store is needed, awareness fields stay empty.
 */
export function createReplayLiveContext(engineStore: LiveContext['engineStore']): LiveContext {
  return {
    cursors: new Map(),
    remoteSelections: new Map(),
    remoteEditingModifier: new Map(),
    remoteEditSteps: new Map(),
    remoteCameras: new Map(),
    triggerCursorUpdate: () => {},
    triggerSelectionUpdate: () => {},
    triggerEditingModifierUpdate: () => {},
    triggerEditStepUpdate: () => {},
    triggerCameraUpdate: () => {},
    displayNameOf: () => '',
    colorOf: () => '',
    engineStore,
  };
}

/** Replay one change: history command registry first, then live-ops. */
export function replayChange(change: ReplayableChange, ctx: ReplayContext, liveCtx: LiveContext): boolean {
  const cmd = commandFromPayload(change.type, change.payload as object, ctx);
  if (cmd) {
    cmd.execute();
    return true;
  }
  const liveOp = getLiveOpConfig(change.type);
  if (!liveOp) return false;
  liveOp.apply(change.payload, change.userId ?? '', liveCtx, '');
  return true;
}

/** Build the port. `capture` returns a JSON copy (never aliases live objects). */
export function createEngineStatePort(host: EngineStatePortHost): ProjectStatePort {
  const liveCtx = createReplayLiveContext(host.engineStore);
  return {
    capture: () => JSON.parse(JSON.stringify(host.buildSnapshot())) as ProjectSnapshot,
    apply: snapshot => host.applySnapshot(snapshot),
    replay: change => replayChange(change, host.replayContext(), liveCtx),
  };
}
