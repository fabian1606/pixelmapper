import { IncompatibleProjectError, serializeProject, type ProjectSnapshot } from '~/utils/engine/serialize';
import type { ProjectRequirement } from '~/utils/extensions/requires';
import type { LocalProjectMeta, OutboxEntry, ProjectStore } from '~/utils/persistence/project-store';
import type { RemoteClient } from '~/utils/sync/remote-api';
import type { ProjectStatePort } from '~/utils/sync/project-state-port';
import type { BaseState } from '~/utils/sync/sync-context';
import { packSnapshot, SyncPosition } from '~/utils/sync/sync-position';
import {
  classifyDownloadError,
  downloadedPosition,
  downloadProject,
  maxOrder,
  type DownloadFailure,
  type LocalOpenData,
} from '~/utils/sync/open-project';
import { settleLegacyRows } from '~/utils/sync/open-legacy-rows';

/**
 * Local-first open (ADR 0004 D1, §3.1): build the live state from the local
 * copy, or download it on the first open. Talks to the engine store only
 * through the `OpenFlowHost`.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenFlowHost {
  port: ProjectStatePort;
  /** Clear the live project (scene, presets, controllers) before applying. */
  reset(): Promise<void>;
  /** Extension gate (ADR §5.10); false = blocked (the host shows the dialog). */
  gate(requires: readonly ProjectRequirement[], changeTypes: string[]): boolean;
}

/** A successfully opened project. */
export interface OpenedProject {
  meta: LocalProjectMeta | null;
  position: SyncPosition;
  base: BaseState | null;
  /** Highest outbox order the live state reflects. */
  outboxOrder: number;
  /** Pending outbox rows exist → the first sync rebases. */
  backlog: boolean;
}

export type OpenFailure = DownloadFailure | 'incompatible' | 'missing-extensions';

export type OpenResult = { ok: true; project: OpenedProject } | { ok: false; error: OpenFailure };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Apply a snapshot, mapping an incompatible schema to an error. */
function applySnapshot(port: ProjectStatePort, snapshot: ProjectSnapshot): OpenFailure | null {
  try {
    port.apply(snapshot);
    return null;
  }
  catch (err) {
    if (err instanceof IncompatibleProjectError) {
      console.warn('[sync] incompatible project snapshot:', err.found);
      return 'incompatible';
    }
    throw err;
  }
}

/** State of a new, empty project (no fixtures, presets, modifiers or pages). */
export function emptyProjectSnapshot(): ProjectSnapshot {
  return serializeProject([], [], [], { RED: 0, GREEN: 0, BLUE: 0, DIMMER: 0 }, []);
}

/** Replay outbox rows onto the live state (logged, never throws). */
function replayRows(port: ProjectStatePort, rows: OutboxEntry[]): void {
  for (const row of rows) {
    try {
      if (!port.replay({ type: row.type, payload: row.payload })) console.warn(`[sync] no handler for pending "${row.type}"`);
    }
    catch (err) {
      console.warn(`[sync] replay of pending "${row.type}" failed:`, err);
    }
  }
}

// ── Local copy ───────────────────────────────────────────────────────────────

/**
 * Open from the local copy. A local-only project without any snapshot yet
 * (created as meta only) opens with the empty default state.
 */
export async function openFromLocal(host: OpenFlowHost, local: LocalOpenData | null, meta: LocalProjectMeta | null): Promise<OpenResult> {
  const requires = local?.snapshot.requires ?? [];
  if (!host.gate(requires, (local?.replay ?? []).map(r => r.type))) return { ok: false, error: 'missing-extensions' };
  await host.reset();
  // Meta-only local project (just created): the empty default state.
  const failed = applySnapshot(host.port, local?.snapshot ?? emptyProjectSnapshot());
  if (failed) return { ok: false, error: failed };
  if (local) replayRows(host.port, local.replay);
  return {
    ok: true,
    project: {
      meta: local?.meta ?? meta,
      position: local?.position ?? SyncPosition.at(meta?.serverCursor ?? 0),
      base: local?.base ?? null,
      outboxOrder: local?.outboxOrder ?? 0,
      backlog: (local?.outbox.length ?? 0) > 0,
    },
  };
}

// ── First open ───────────────────────────────────────────────────────────────

export interface ServerOpenInput {
  store: ProjectStore;
  client: RemoteClient;
  projectId: string;
  /** Signed-in account (the copy is bound to it, D15). */
  userId: string | null;
  meta: LocalProjectMeta | null;
}

/**
 * First open of a cloud project: download snapshot + tail, store the base,
 * working snapshot and meta (`origin: 'cloud'`). Outbox rows that exist
 * already (moved from the legacy WAL) are settled by `settleLegacyRows`:
 * acked when the server has them, replayed on top otherwise.
 */
export async function openFromServer(host: OpenFlowHost, input: ServerOpenInput): Promise<OpenResult> {
  const { store, client, projectId, userId, meta } = input;
  const res = await downloadProject(client, projectId);
  if (!res.ok) return { ok: false, error: classifyDownloadError(res.error) };
  const data = res.data;
  if (!host.gate(data.snapshot?.requires ?? [], data.tail.map(c => c.commandType))) return { ok: false, error: 'missing-extensions' };

  await host.reset();
  // No server snapshot yet: start from the empty state, not the previous project.
  const failed = applySnapshot(host.port, data.snapshot ?? emptyProjectSnapshot());
  if (failed) return { ok: false, error: failed };
  for (const c of data.tail) {
    try { host.port.replay({ type: c.commandType, payload: c.payload, userId: c.userId }); }
    catch (err) { console.warn(`[sync] tail replay of "${c.commandType}" failed:`, err); }
  }
  const position = downloadedPosition(data);

  // Rows from an older build: in the tail → ack. The others are pushed once
  // (idempotent): covered by the snapshot → ack without replay; inserted
  // above it → server changes (base); unconfirmed → pending on top.
  const outbox = await store.getOutbox(projectId);
  const tailIds = new Set(data.tail.map(c => c.changeId));
  const inTail = outbox.filter(r => tailIds.has(r.id));
  const settled = await settleLegacyRows(client, projectId, outbox.filter(r => !tailIds.has(r.id)), data.snapshotSequence);
  replayRows(host.port, settled.inserted.map(i => i.row));
  for (const { row, seq } of settled.inserted) position.add(row.id, seq);
  const baseSnapshot = host.port.capture();
  const done = [...inTail, ...settled.covered, ...settled.inserted.map(i => i.row)];
  if (done.length > 0) await store.ackOutbox(done.map(r => r.id));
  const pending = settled.pending;
  replayRows(host.port, pending);

  const now = Date.now();
  const nextMeta: LocalProjectMeta = {
    id: projectId,
    name: meta?.name ?? '',
    description: meta?.description,
    origin: 'cloud',
    ownerUserId: meta?.ownerUserId ?? userId,
    role: meta?.role,
    serverCursor: position.cursor,
    createdAt: meta?.createdAt ?? now,
    updatedAt: now,
    lastSyncedAt: now,
    remoteDeletedAt: meta?.remoteDeletedAt,
  };
  const outboxOrder = maxOrder(pending);
  await store.putProject(nextMeta);
  await store.putBaseSnapshot(projectId, packSnapshot(baseSnapshot, position), position.cursor);
  await store.putWorkingSnapshot(projectId, packSnapshot(host.port.capture(), position, outboxOrder));
  return {
    ok: true,
    project: {
      meta: nextMeta,
      position: position.clone(),
      base: { snapshot: baseSnapshot, position },
      outboxOrder,
      backlog: pending.length > 0,
    },
  };
}
