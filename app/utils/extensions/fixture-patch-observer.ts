/**
 * Fixture patch observation (plan M4.6, API `onFixturePatchChange`).
 *
 * While at least one subscriber exists, the observer keeps a baseline of
 * every fixture's patch state and diffs it after each command applied
 * through the history (local, undo, redo, collaborator). Changes are
 * delivered per history step in a microtask, so subscribers may run
 * commands. Project loads replace the state without history; the engine
 * store calls `rebaseFixturePatchObservation()` afterwards so a load is not
 * reported as a change.
 */
import type {
  FixtureId,
  FixturePatchChange,
  FixturePatchChangeOrigin,
  FixturePatchObserverOptions,
  FixturePatchState,
} from '@pixelmapper/extension-api';
import type { SceneNode } from '~/utils/engine/core/group';
import { collectFixtures } from '~/utils/engine/scene-tree';
import { onHistoryApplied, type HistoryOrigin } from '~/components/engine/composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import { patchStateOf, patchStatesDiffer } from './fixture-patch-state';

/** Patch states by fixture id. */
type PatchSnapshot = Map<FixtureId, FixturePatchState>;

/** One subscription. */
interface Subscriber {
  callback: (changes: FixturePatchChange[]) => void;
  fixtureIds?: FixturePatchObserverOptions['fixtureIds'];
}

const subscribers = new Set<Subscriber>();
/** Baseline while subscribed; `null` otherwise. */
let baseline: PatchSnapshot | null = null;
/** History listener disposer while subscribed. */
let stopListening: (() => void) | null = null;
/** Extension currently running a command through its context (see `runAsExtension`). */
let currentInitiator: string | undefined;

/** Scene source; replaceable in tests. */
let getSceneNodes: () => readonly SceneNode[] = () => useEngineStore().sceneNodes as SceneNode[];

/** Replaces the scene source (tests). `null` restores the engine store. */
export function setPatchObserverSceneSource(source: (() => readonly SceneNode[]) | null): void {
  getSceneNodes = source ?? (() => useEngineStore().sceneNodes as SceneNode[]);
  if (baseline) baseline = snapshotPatch(getSceneNodes());
}

/** Patch states of all fixtures of a tree. */
export function snapshotPatch(nodes: readonly SceneNode[]): PatchSnapshot {
  const out: PatchSnapshot = new Map();
  for (const f of collectFixtures(nodes)) out.set(f.id, patchStateOf(f));
  return out;
}

/** Differences between two snapshots (changed, added and removed fixtures). */
export function diffPatch(
  before: PatchSnapshot,
  after: PatchSnapshot,
): { fixtureId: FixtureId; before: FixturePatchState | null; after: FixturePatchState | null }[] {
  const out: { fixtureId: FixtureId; before: FixturePatchState | null; after: FixturePatchState | null }[] = [];
  for (const [id, next] of after) {
    const prev = before.get(id);
    if (!prev) out.push({ fixtureId: id, before: null, after: next });
    else if (patchStatesDiffer(prev, next)) out.push({ fixtureId: id, before: prev, after: next });
  }
  for (const [id, prev] of before) {
    if (!after.has(id)) out.push({ fixtureId: id, before: prev, after: null });
  }
  return out;
}

/**
 * Runs `fn` (which executes a command through the history) attributed to
 * an extension, so observers see it as `initiator`.
 */
export function runAsExtension<T>(extensionId: string | null | undefined, fn: () => T): T {
  const previous = currentInitiator;
  currentInitiator = extensionId ?? undefined;
  try { return fn(); }
  finally { currentInitiator = previous; }
}

/** Ids a subscriber is interested in, or `null` for all. */
function interestOf(sub: Subscriber): Set<FixtureId> | null {
  const ids = sub.fixtureIds;
  if (!ids) return null;
  return new Set(typeof ids === 'function' ? ids() : ids);
}

/** Delivers one step's changes to every subscriber (filtered). */
function deliver(changes: FixturePatchChange[]): void {
  for (const sub of [...subscribers]) {
    let mine = changes;
    try {
      const interest = interestOf(sub);
      if (interest) mine = changes.filter(c => interest.has(c.fixtureId));
      if (mine.length > 0) sub.callback(mine.map(c => ({ ...c })));
    }
    catch (err) {
      console.error('[fixture-patch] observer failed:', err);
    }
  }
}

/** History listener: diff against the baseline and schedule delivery. */
function onApplied(origin: HistoryOrigin): void {
  if (!baseline) return;
  const next = snapshotPatch(getSceneNodes());
  const diff = diffPatch(baseline, next);
  baseline = next;
  if (diff.length === 0) return;
  const initiator = origin === 'local' ? currentInitiator : undefined;
  const changes: FixturePatchChange[] = diff.map(d => ({
    ...d,
    origin: origin as FixturePatchChangeOrigin,
    ...(initiator ? { initiator } : {}),
  }));
  queueMicrotask(() => deliver(changes));
}

/**
 * Re-reads the baseline without reporting changes (after a project load or
 * any other wholesale state replacement outside the history).
 */
export function rebaseFixturePatchObservation(): void {
  if (baseline) baseline = snapshotPatch(getSceneNodes());
}

/** Subscribes (host side of `onFixturePatchChange`). */
export function subscribeFixturePatchChanges(
  callback: (changes: FixturePatchChange[]) => void,
  options: FixturePatchObserverOptions = {},
): () => void {
  const sub: Subscriber = { callback, fixtureIds: options.fixtureIds };
  subscribers.add(sub);
  if (!stopListening) {
    baseline = snapshotPatch(getSceneNodes());
    stopListening = onHistoryApplied(onApplied);
  }
  return () => {
    subscribers.delete(sub);
    if (subscribers.size === 0 && stopListening) {
      stopListening();
      stopListening = null;
      baseline = null;
    }
  };
}
