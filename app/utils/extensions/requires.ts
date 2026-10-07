/**
 * Project dependency bookkeeping (plan P5.5, ADR D20 / §5.8).
 *
 * `project.requires` lists the extensions a project cannot be opened
 * without. Rules:
 *  - executing a command owned by extension E (`E/<name>`), or
 *    `SetFixtureKindConfig` / `AddFixtures` for a kind of E, adds E
 *    (unless the kind sets `requiredWhenUsed: false`);
 *  - the list is recomputed from the current state: E stays while a fixture
 *    uses one of its required kinds or any `extensionData[E]` exists
 *    (fixture, project or live widget);
 *  - when E leaves the list the host writes a snapshot immediately, so the
 *    change log after it contains no E commands.
 *
 * Everything here is pure; the engine store wires it to commands and
 * snapshot writes.
 */

/** One required extension. */
export interface ProjectRequirement {
  id: string;
  /** Semver range, `^major.minor` of the version in use when added. */
  version: string;
}

/** Host lookups. */
export interface RequiresSources {
  /** Registered extension ids → versions. */
  extensionVersion(id: string): string | undefined;
  /** Owner of a kind and whether using it creates a dependency. */
  kindOwner(kindId: string): { extensionId: string; required: boolean } | undefined;
}

/** State the recomputation inspects. */
export interface RequiresState {
  /** Kind ids of all fixtures (undefined for non-kind fixtures). */
  fixtureKinds: (string | undefined)[];
  /** Extension ids with data on fixtures, the project or live widgets. */
  extensionDataOwners: Iterable<string>;
}

/** `^major.minor` of a semver version. */
export function versionRange(version: string): string {
  const [major = '0', minor = '0'] = version.split('.');
  return `^${major}.${minor}`;
}

/** Extension owning a namespaced command type (`ext/name`), if registered. */
export function commandOwner(commandType: string, src: RequiresSources): string | undefined {
  const i = commandType.indexOf('/');
  if (i <= 0) return undefined;
  const id = commandType.slice(0, i);
  return src.extensionVersion(id) ? id : undefined;
}

/**
 * Extensions a just-executed command makes the project depend on.
 * `kindOfFixture` resolves the kind id of an existing fixture.
 */
export function requirementsOfCommand(
  commandType: string,
  payload: unknown,
  src: RequiresSources,
  kindOfFixture: (fixtureId: string | number) => string | undefined,
): string[] {
  const out = new Set<string>();
  const owner = commandOwner(commandType, src);
  if (owner) out.add(owner);

  const addKind = (kindId: string | undefined) => {
    const k = kindId ? src.kindOwner(kindId) : undefined;
    if (k?.required) out.add(k.extensionId);
  };
  const p = payload as Record<string, unknown> | null;
  if (commandType === 'SetFixtureKindConfig' && p) addKind(kindOfFixture(p.fixtureId as string | number));
  if (commandType === 'AddFixtures' && p && Array.isArray(p.nodes)) {
    const visit = (n: { _type?: string; kind?: { id?: string }; children?: unknown[] }) => {
      if (n._type === 'group') (n.children ?? []).forEach(c => visit(c as typeof n));
      else addKind(n.kind?.id);
    };
    p.nodes.forEach(n => visit(n as Parameters<typeof visit>[0]));
  }
  return [...out];
}

/** Extensions the current state still uses. */
export function requirementsOfState(state: RequiresState, src: RequiresSources): Set<string> {
  const used = new Set<string>();
  for (const kindId of state.fixtureKinds) {
    const k = kindId ? src.kindOwner(kindId) : undefined;
    if (k?.required) used.add(k.extensionId);
  }
  for (const id of state.extensionDataOwners) used.add(id);
  return used;
}

/** Adds extensions (keeps existing ranges; unknown versions are skipped). */
export function addRequirements(current: readonly ProjectRequirement[], ids: Iterable<string>, src: RequiresSources): ProjectRequirement[] {
  const next = [...current];
  for (const id of ids) {
    if (next.some(r => r.id === id)) continue;
    const version = src.extensionVersion(id);
    if (version) next.push({ id, version: versionRange(version) });
  }
  return next;
}

/**
 * Recomputes the list against the state: keeps entries still in use, adds
 * newly used ones. Returns the removed ids (→ write a snapshot now).
 */
export function recomputeRequirements(
  current: readonly ProjectRequirement[],
  state: RequiresState,
  src: RequiresSources,
): { next: ProjectRequirement[]; removed: string[] } {
  const used = requirementsOfState(state, src);
  const kept = current.filter(r => used.has(r.id));
  const removed = current.filter(r => !used.has(r.id)).map(r => r.id);
  return { next: addRequirements(kept, used, src), removed };
}

/** Collects extension ids that own data in `extensionData` maps. */
export function extensionDataOwners(maps: Iterable<Record<string, Record<string, unknown>> | undefined>): Set<string> {
  const out = new Set<string>();
  for (const m of maps) {
    if (!m) continue;
    for (const [id, data] of Object.entries(m)) if (data && Object.keys(data).length > 0) out.add(id);
  }
  return out;
}

// ── Open gate (ADR §5.10) ────────────────────────

/** A requirement the installed extensions do not satisfy. */
export interface MissingRequirement {
  id: string;
  /** Required range. */
  version: string;
  /** Installed version when present but incompatible. */
  installed?: string;
}

/**
 * Requirements of a project about to open: the snapshot's `requires` plus
 * owners of namespaced commands in the change-log tail (`ext/name`) — a
 * missing extension's commands cannot be resolved via the registry, so the
 * prefix itself is the extension id.
 */
export function requirementsToOpen(snapshotRequires: readonly ProjectRequirement[], tailCommandTypes: readonly string[]): ProjectRequirement[] {
  const out = [...snapshotRequires];
  for (const type of tailCommandTypes) {
    const i = type.indexOf('/');
    if (i <= 0) continue;
    const id = type.slice(0, i);
    if (!out.some(r => r.id === id)) out.push({ id, version: '*' });
  }
  return out;
}

/** Requirements not satisfied by the registered extensions. */
export function missingRequirements(
  required: readonly ProjectRequirement[],
  installedVersion: (id: string) => string | undefined,
  satisfies: (version: string, range: string) => boolean,
): MissingRequirement[] {
  const out: MissingRequirement[] = [];
  for (const r of required) {
    const v = installedVersion(r.id);
    if (!v) out.push({ id: r.id, version: r.version });
    else if (!satisfies(v, r.version)) out.push({ id: r.id, version: r.version, installed: v });
  }
  return out;
}
