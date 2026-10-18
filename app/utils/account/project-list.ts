import type { LocalProjectMeta } from '~/utils/persistence/project-store';
import type { RemoteProjectHead, RemoteRole } from '~/utils/sync/remote-api-types';

/**
 * Project list view model (ADR 0004 D1, D13, D15): local store entries
 * merged with the account's remote project heads. The local store is the
 * source; remote heads only add entries that have no local copy yet (web:
 * never opened; desktop: not mirrored yet) and refresh names.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * - `local`: never uploaded, lives only on this device.
 * - `cloud`: synced with the signed-in account.
 * - `foreign`: a kept copy bound to another account, or to an account while
 *   nobody is signed in (D15).
 */
export type ProjectListKind = 'local' | 'cloud' | 'foreign';

/** Where a new project lives: the signed-in account or this device only. */
export type ProjectTarget = 'cloud' | 'local';

export interface ProjectListItem {
  id: string;
  name: string;
  description: string | null;
  kind: ProjectListKind;
  /** Role of the signed-in account (cloud entries); `null` otherwise. */
  role: RemoteRole | null;
  /** Account the copy is bound to (`foreign` entries). */
  ownerUserId: string | null;
  /** Pending outbox entries of the local copy. */
  pending: number;
  /** A local copy exists on this device. */
  cached: boolean;
  /** The project vanished from the server but local changes were kept. */
  remoteDeleted: boolean;
  /** Last change as epoch ms (for sorting and "Updated …"); `null` if unknown. */
  updatedAt: number | null;
}

export interface MergeProjectListInput {
  locals: LocalProjectMeta[];
  /** Remote heads, or `null` when they could not be fetched (offline / signed out). */
  heads: RemoteProjectHead[] | null;
  /** Signed-in account id, `null` when signed out. */
  userId: string | null;
  /** Pending count per project id (missing = 0). */
  pending?: Record<string, number>;
  /** Include entries bound to other accounts (desktop). */
  showForeign: boolean;
}

// ── Classification ───────────────────────────────────────────────────────────

/** Kind of a local entry relative to the signed-in account. */
export function classifyLocal(meta: LocalProjectMeta, userId: string | null): ProjectListKind {
  if (meta.origin === 'local' && meta.ownerUserId === null) return 'local';
  if (userId !== null && meta.ownerUserId === userId) return 'cloud';
  return 'foreign';
}

/** Latest of two ISO timestamps as epoch ms; `null` if neither parses. */
function headTime(head: RemoteProjectHead): number | null {
  const times = [head.latestChangeAt, head.updatedAt]
    .map(t => (t ? Date.parse(t) : Number.NaN))
    .filter(t => Number.isFinite(t));
  return times.length ? Math.max(...times) : null;
}

// ── Merge ────────────────────────────────────────────────────────────────────

/** Builds the list, newest first. */
export function mergeProjectList(input: MergeProjectListInput): ProjectListItem[] {
  const { locals, heads, userId, pending = {}, showForeign } = input;
  const headById = new Map((heads ?? []).map(h => [h.id, h]));
  const items: ProjectListItem[] = [];
  const seen = new Set<string>();

  for (const meta of locals) {
    const kind = classifyLocal(meta, userId);
    if (kind === 'foreign' && !showForeign) continue;
    seen.add(meta.id);
    // Remote data only applies to copies bound to the signed-in account.
    const head = kind === 'cloud' ? headById.get(meta.id) : undefined;
    items.push({
      id: meta.id,
      name: head?.name || meta.name,
      description: (head ? head.description : meta.description) ?? null,
      kind,
      role: kind === 'cloud' ? head?.role ?? meta.role ?? null : null,
      ownerUserId: kind === 'local' ? null : meta.ownerUserId,
      pending: pending[meta.id] ?? 0,
      cached: true,
      remoteDeleted: !!meta.remoteDeletedAt,
      updatedAt: Math.max(meta.updatedAt, head ? headTime(head) ?? 0 : 0) || null,
    });
  }

  for (const head of heads ?? []) {
    if (seen.has(head.id)) continue;
    items.push({
      id: head.id,
      name: head.name,
      description: head.description,
      kind: 'cloud',
      role: head.role,
      ownerUserId: userId,
      pending: 0,
      cached: false,
      remoteDeleted: false,
      updatedAt: headTime(head),
    });
  }

  return items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

// ── Capabilities ─────────────────────────────────────────────────────────────

/** What the list offers for an entry, given connectivity. */
export interface ProjectActions {
  /** Rename possible now. */
  rename: boolean;
  /** Delete possible now (local delete or server delete). */
  delete: boolean;
  /** Delete only removes the copy on this device. */
  deleteIsLocalOnly: boolean;
  /** "Detach as local copy" (D15). */
  detach: boolean;
  /** "Upload to account" (signed in, local-only). */
  upload: boolean;
  /** Why rename/delete are disabled, if they are. */
  disabledHint: string | null;
}

/** Derives the available actions of an entry. */
export function projectActions(item: ProjectListItem, opts: { online: boolean; signedIn: boolean }): ProjectActions {
  if (item.kind === 'local') {
    return { rename: true, delete: true, deleteIsLocalOnly: true, detach: false, upload: opts.signedIn, disabledHint: null };
  }
  if (item.kind === 'foreign') {
    // Bound to another account: never touches the server from here.
    return { rename: false, delete: true, deleteIsLocalOnly: true, detach: true, upload: false, disabledHint: 'Sign in with the owning account to rename' };
  }
  if (item.remoteDeleted) {
    return { rename: false, delete: true, deleteIsLocalOnly: true, detach: true, upload: false, disabledHint: 'Deleted on the server' };
  }
  const isOwner = item.role === 'owner';
  const hint = !isOwner ? null : opts.online ? null : 'Go online to rename or delete cloud projects';
  return {
    rename: isOwner && opts.online,
    delete: isOwner && opts.online,
    deleteIsLocalOnly: false,
    detach: item.cached,
    upload: false,
    disabledHint: hint,
  };
}
