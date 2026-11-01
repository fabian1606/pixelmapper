import type { ActivityEntry, RestoreMarker } from '~/utils/sync/remote-api-snapshot-details';
import { absoluteTime } from '~/utils/sync/relative-time';

/**
 * Human-readable activity between two versions (version-history details):
 * `project_changes` rows aggregated per author and command type by the
 * server, turned into lines like "Ada · 3× Move fixture · 1× Change effect".
 */

// ── Labels ───────────────────────────────────────────────────────────────────

/**
 * Command / live-op type → label. Commands are registered in
 * `components/engine/commands/*` (`registerCommand`), persistent live-ops
 * in `composables/live-ops/*` (`registerLiveOp`, `persistent: true`).
 * Unknown types fall back to the raw type.
 */
export const COMMAND_LABELS: Readonly<Record<string, string>> = {
  // Scene
  AddFixtures: 'Add fixtures',
  DeleteNodes: 'Delete',
  GroupNodes: 'Group',
  UngroupNodes: 'Ungroup',
  RenameNode: 'Rename',
  MoveFixture: 'Move fixture',
  'fixture.drag': 'Move fixture',
  RotateFixture: 'Rotate fixture',
  UpdateDmx: 'Change DMX address',
  SetChannelValues: 'Change channels',
  'channel.update': 'Change channels',
  SetChannelRange: 'Change channel range',
  SetFixtureKindConfig: 'Change fixture kind',
  SetExtensionData: 'Change extension data',
  'color.override': 'Override color',
  // Effects
  SetModifiers: 'Change effects',
  'modifier.update': 'Change effect',
  'modifier.sync': 'Sync effects',
  // Presets
  SavePreset: 'Save preset',
  OverwritePreset: 'Overwrite preset',
  DeletePreset: 'Delete preset',
  UpdatePresetMetadata: 'Edit preset',
  SetActivePreset: 'Switch preset',
  'preset.set': 'Switch preset',
  // Engine
  'engine.bpm': 'Change BPM',
  'engine.speed': 'Change speed',
  'engine.master': 'Change master dimmer',
  'engine.clock': 'Reset clock',
  'engine.beatAlign': 'Tap beat',
  // Live pages
  'live.addPage': 'Add live page',
  'live.removePage': 'Remove live page',
  'live.updatePage': 'Edit live page',
  'live.addWidget': 'Add widget',
  'live.removeWidget': 'Remove widget',
  'live.moveWidget': 'Move widget',
  'live.batchMoveWidgets': 'Move widgets',
  'live.updateMapping': 'Change widget mapping',
  'live.groupWidgets': 'Group widgets',
  'live.ungroupWidgets': 'Ungroup widgets',
  'live.batchSetGroupIds': 'Group widgets',
  'live.addSection': 'Add section',
  'live.removeSection': 'Remove section',
  'live.updateSection': 'Edit section',
  'live.setSectionMembers': 'Change section members',
  'live.addController': 'Add controller',
  'live.removeController': 'Remove controller',
  'live.setControllerInstance': 'Assign controller',
  'live.updateChildMapping': 'Change controller mapping',
  // Server markers
  'restore-snapshot': 'Restore version',
};

/** Label of a command type (raw type when unknown). */
export function activityLabel(commandType: string): string {
  return COMMAND_LABELS[commandType] ?? commandType;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/** Fallback for changes whose author has no profile name. */
export const UNKNOWN_AUTHOR = 'Unknown author';

/** One author's activity: labels with counts, largest first. */
export interface AuthorActivity {
  author: string;
  total: number;
  items: { label: string; count: number }[];
}

/**
 * Groups rows per author (by user id, else name) and merges types that share
 * a label (e.g. `MoveFixture` + `fixture.drag`). Authors by total, desc.
 */
export function summarizeActivity(rows: readonly ActivityEntry[]): AuthorActivity[] {
  const authors = new Map<string, { author: string; counts: Map<string, number> }>();
  for (const row of rows) {
    if (!(row.count > 0)) continue;
    const key = row.userId ?? `name:${row.authorName ?? ''}`;
    let a = authors.get(key);
    if (!a) {
      a = { author: row.authorName || UNKNOWN_AUTHOR, counts: new Map() };
      authors.set(key, a);
    }
    const label = activityLabel(row.commandType);
    a.counts.set(label, (a.counts.get(label) ?? 0) + row.count);
  }
  return [...authors.values()]
    .map(({ author, counts }) => {
      const items = [...counts].map(([label, count]) => ({ label, count }))
        .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
      return { author, total: items.reduce((s, i) => s + i.count, 0), items };
    })
    .sort((x, y) => y.total - x.total || x.author.localeCompare(y.author));
}

/** "Ada · 3× Move fixture · 1× Change effect". */
export function formatAuthorActivity(a: AuthorActivity): string {
  return [a.author, ...a.items.map(i => `${i.count}× ${i.label}`)].join(' · ');
}

// ── Restores ─────────────────────────────────────────────────────────────────

/** "the version from <time>" / "change #N" / "an earlier version". */
export function restoredVersionText(r: Pick<RestoreMarker, 'sourceCreatedAt' | 'sourceSequence'>): string {
  const at = r.sourceCreatedAt ? Date.parse(r.sourceCreatedAt) : Number.NaN;
  if (Number.isFinite(at)) return `the version from ${absoluteTime(at)}`;
  if (r.sourceSequence !== null) return `the version at change #${r.sourceSequence}`;
  return 'an earlier version';
}

/** "Restored the version from … · Ada". */
export function formatRestore(r: RestoreMarker): string {
  return `Restored ${restoredVersionText(r)}${r.authorName ? ` · ${r.authorName}` : ''}`;
}

/** Source sequence from a `Restored from snapshot <seq>` label (migration 009), else null. */
export function restoredSequenceFromLabel(label: string | null): number | null {
  const m = label?.match(/^Restored from snapshot (\d+)$/);
  return m ? Number(m[1]) : null;
}
