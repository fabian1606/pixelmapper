/**
 * Result types of the version-history diff (`diffSnapshots`): what changed
 * between two serialized projects (`ProjectSnapshot`), grouped by kind.
 */

/** An entity by id with a display name (falls back to the id). */
export interface EntityRef {
  id: string;
  name: string;
}

/** An entity present in both versions with changed fields. */
export interface EntityChange extends EntityRef {
  /** Changed fields in human terms ("position", "color", …), deduplicated. */
  fields: string[];
  /** Old name when the entity was renamed. */
  previousName?: string;
}

/** Added / removed / changed entities of one kind. */
export interface KindDiff {
  added: EntityRef[];
  removed: EntityRef[];
  changed: EntityChange[];
  /** The relative order of entities present in both versions changed. */
  reordered: boolean;
}

/** A changed project-level setting; `from`/`to` only for readable scalars. */
export interface SettingChange {
  label: string;
  from?: string;
  to?: string;
}

/** Everything that changed from an older to a newer snapshot. */
export interface SnapshotDiff {
  fixtures: KindDiff;
  groups: KindDiff;
  modifiers: KindDiff;
  presets: KindDiff;
  livePages: KindDiff;
  settings: SettingChange[];
  /** True when nothing changed. */
  empty: boolean;
}

/** Hooks for names the snapshot does not carry. */
export interface DiffOptions {
  /** Display name of a modifier instance (e.g. from its plugin manifest). */
  modifierName?: (modifier: Record<string, unknown>) => string | undefined;
}
