/**
 * Extension registry (ADR §5.1).
 *
 * Single place where every extension — first-party Nuxt layers and runtime
 * bundles alike — ends up. Validates manifests at registration and exposes
 * contributions by kind. Contributions are stable after boot; `registryVersion`
 * lets reactive consumers (slot index, replaceables) rebuild when it changes.
 */
import { shallowRef } from 'vue';
import semver from 'semver';
import {
  API_VERSION,
  type ExtensionContributions,
  type ExtensionManifest,
} from '@pixelmapper/extension-api';

/** How an extension reached the registry. */
export type ExtensionSource = 'layer' | 'bundle' | 'test';

/** A validated, registered extension. */
export interface RegisteredExtension {
  manifest: ExtensionManifest;
  source: ExtensionSource;
  /** Monotonic registration order (used for stable sorting). */
  order: number;
}

/** Contribution kinds, i.e. the keys of `ExtensionContributions`. */
export type ContributionKind = keyof ExtensionContributions;

/** Element type of one contribution list. */
export type ContributionOf<K extends ContributionKind> = NonNullable<ExtensionContributions[K]>[number];

/** A contribution tagged with its owning extension. */
export interface OwnedContribution<K extends ContributionKind> {
  extensionId: string;
  contribution: ContributionOf<K>;
}

/** Thrown when a manifest fails validation. `errors` holds readable reasons. */
export class ExtensionValidationError extends Error {
  constructor(
    readonly extensionId: string,
    readonly errors: string[],
  ) {
    super(`Extension "${extensionId}" rejected:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ExtensionValidationError';
  }
}

// ── State ───────────────────────────────────────

const extensions = new Map<string, RegisteredExtension>();
let orderCounter = 0;

/** Bumped on every (un)registration so computed indexes can rebuild. */
export const registryVersion = shallowRef(0);

/** kebab-case: lowercase letters/digits separated by single dashes. */
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Same as kebab, but leading `_` allowed for dev-only extensions (`_debug-slots`). */
const EXTENSION_ID_RE = /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── Validation ──────────────────────────────────

/**
 * Validates a manifest against the API rules and the already registered
 * extensions. Returns a list of readable error messages (empty = valid).
 */
export function validateManifest(
  manifest: ExtensionManifest,
  registered: ReadonlyMap<string, RegisteredExtension> = extensions,
): string[] {
  const errors: string[] = [];
  const id = manifest?.id;

  if (typeof id !== 'string' || !EXTENSION_ID_RE.test(id)) {
    errors.push(`id "${String(id)}" must be kebab-case (e.g. "color-picker")`);
  }
  else if (registered.has(id)) {
    errors.push(`an extension with id "${id}" is already registered`);
  }

  if (!semver.valid(manifest?.version)) {
    errors.push(`version "${String(manifest?.version)}" is not valid semver (e.g. "1.0.0")`);
  }

  if (!semver.validRange(manifest?.apiVersion)) {
    errors.push(`apiVersion "${String(manifest?.apiVersion)}" is not a valid semver range (e.g. "^1.0.0")`);
  }
  else if (!semver.satisfies(API_VERSION, manifest.apiVersion)) {
    errors.push(
      `apiVersion "${manifest.apiVersion}" is incompatible with the host extension API ${API_VERSION}`,
    );
  }

  if (!manifest?.displayName) errors.push('displayName is required');
  if (!manifest?.description) errors.push('description is required (read by humans and AI)');

  const c = manifest?.contributes ?? {};

  // Commands must be namespaced with the owning extension id.
  for (const cmd of c.commands ?? []) {
    const [ns, name, ...rest] = String(cmd.type).split('/');
    if (ns !== id || !name || rest.length > 0) {
      errors.push(`command type "${cmd.type}" must be namespaced as "${id}/<name>"`);
    }
  }

  // No duplicate replacement within the same extension.
  const replaced = new Set<string>();
  for (const r of c.replaces ?? []) {
    if (replaced.has(r.replaces)) errors.push(`replaces "${r.replaces}" more than once`);
    replaced.add(r.replaces);
  }

  // Fixture kind ids are unique across all extensions.
  const otherKindIds = new Set(
    [...registered.values()].flatMap(e => (e.manifest.contributes?.fixtureKinds ?? []).map(k => k.id)),
  );
  const ownKindIds = new Set<string>();
  for (const k of c.fixtureKinds ?? []) {
    if (!KEBAB_RE.test(k.id)) errors.push(`fixture kind id "${k.id}" must be kebab-case`);
    if (otherKindIds.has(k.id) || ownKindIds.has(k.id)) errors.push(`fixture kind id "${k.id}" is already registered`);
    if (!semver.valid(k.version)) errors.push(`fixture kind "${k.id}" version "${k.version}" is not valid semver`);
    ownKindIds.add(k.id);
  }

  // Connector types are unique across all extensions.
  const otherConnectorTypes = new Set(
    [...registered.values()].flatMap(e => (e.manifest.contributes?.connectors ?? []).map(k => k.type)),
  );
  for (const conn of c.connectors ?? []) {
    if (otherConnectorTypes.has(conn.type)) errors.push(`connector type "${conn.type}" is already registered`);
  }

  // Extension live widget types are namespaced.
  for (const w of c.liveWidgets ?? []) {
    if (!w.type.startsWith(`${id}/`)) errors.push(`live widget type "${w.type}" must be namespaced as "${id}/<name>"`);
  }

  // Curve shape ids are namespaced.
  for (const s of c.curveShapes ?? []) {
    if (!String(s.id).startsWith(`${id}/`)) errors.push(`curve shape id "${s.id}" must be namespaced as "${id}/<name>"`);
  }

  // Slot contributions need something to render.
  for (const s of c.slots ?? []) {
    if (!s.slot) errors.push('slot contribution without "slot"');
    if (!s.component && !s.menuItem) errors.push(`slot contribution "${s.slot}" needs a component or menuItem`);
  }

  return errors;
}

// ── Registration ────────────────────────────────

/**
 * Validates and registers an extension. Throws `ExtensionValidationError`
 * with readable reasons when the manifest is invalid.
 */
export function registerExtension(
  manifest: ExtensionManifest,
  source: ExtensionSource = 'layer',
): RegisteredExtension {
  const errors = validateManifest(manifest);
  if (errors.length > 0) throw new ExtensionValidationError(String(manifest?.id), errors);

  const entry: RegisteredExtension = { manifest, source, order: orderCounter++ };
  extensions.set(manifest.id, entry);
  registryVersion.value++;
  for (const hook of registeredHooks) {
    try {
      hook(entry);
    }
    catch (err) {
      console.error(`[extensions] post-registration hook failed for "${manifest.id}":`, err);
    }
  }
  return entry;
}

/** Called after every successful registration (host: commands, activate). */
const registeredHooks = new Set<(entry: RegisteredExtension) => void>();

/** Adds a post-registration hook; returns a disposer. */
export function onExtensionRegistered(hook: (entry: RegisteredExtension) => void): () => void {
  registeredHooks.add(hook);
  return () => registeredHooks.delete(hook);
}

/** Removes an extension (tests / dev hot reload). */
export function unregisterExtension(id: string): void {
  if (extensions.delete(id)) registryVersion.value++;
}

/** Clears the registry. Test helper. */
export function resetRegistry(): void {
  extensions.clear();
  orderCounter = 0;
  registryVersion.value++;
}

// ── Queries ─────────────────────────────────────

/** All registered extensions, sorted by id. */
export function getExtensions(): RegisteredExtension[] {
  return [...extensions.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

/** One registered extension, if present. */
export function getExtension(id: string): RegisteredExtension | undefined {
  return extensions.get(id);
}

/**
 * All contributions of one kind across extensions, tagged with their owner.
 * Ordered by extension id, then declaration order.
 */
export function getContributions<K extends ContributionKind>(kind: K): OwnedContribution<K>[] {
  const out: OwnedContribution<K>[] = [];
  for (const ext of getExtensions()) {
    const list = (ext.manifest.contributes?.[kind] ?? []) as ContributionOf<K>[];
    for (const contribution of list) out.push({ extensionId: ext.manifest.id, contribution });
  }
  return out;
}
