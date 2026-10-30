/**
 * Fixture patching (plan M4, API 1.3).
 *
 * Read-only helpers and hooks around a fixture's DMX patch — its start
 * address (and so its universe) and the mode of its definition:
 *
 * - `findFreeAddressSpan` / `listFixtures` — free address search,
 * - `onBeforeFixtureChange` — guard address/universe/mode changes the user
 *   makes in the core UI (confirm or deny them),
 * - `onFixturePatchChange` — observe patch changes from any source (local
 *   edits, undo/redo, collaborators),
 * - `findFixtureDefinitionByRdm` — find a fixture definition (custom fixtures,
 *   then the Open Fixture Library) by RDM manufacturer and model ID,
 * - `saveCustomFixtureDefinition` — store a generated definition as a custom
 *   fixture of the user (API 1.4).
 *
 * Writes go through commands: `commands.addFixtures`,
 * `commands.setStartAddress`, `commands.setFixtureMode`, `commands.batch`.
 */
import type { FixtureId, Json } from './model';
import type { FixtureSummary } from './scopes';
import { getHostApi } from './host';

// ── Definitions ─────────────────────────────────

/**
 * Key of a fixture definition: an Open Fixture Library fixture
 * `'<manufacturer>/<fixture>'` (e.g. `'cameo/flat-pro-18'`) or a custom
 * fixture of the user `'custom/<id>'`.
 */
export type FixtureDefinitionKey = string;

/** The definition and mode a fixture was created from (see `FixtureView.source`). */
export interface FixtureSourceRef {
  /** Definition key. */
  key: FixtureDefinitionKey;
  /** 0-based index into the definition's modes. */
  modeIndex: number;
}

/** One mode of a definition found by `findFixtureDefinitionByRdm`. */
export interface RdmDefinitionMode {
  /** 0-based mode index (`AddFixtureItem.modeIndex`, `commands.setFixtureMode`). */
  index: number;
  /** Mode name from the definition. */
  name: string;
  /**
   * Number of channels the core creates for the mode. Unused (`null`) slots
   * of an OFL mode are not counted, so this can be lower than the DMX
   * footprint a device reports.
   */
  channelCount: number;
  /** 1-based RDM personality of the mode, when the definition declares one. */
  rdmPersonalityIndex?: number;
}

/** A fixture definition found by RDM IDs. */
export interface RdmDefinitionMatch {
  /** Definition key to pass to `commands.addFixtures`. */
  key: FixtureDefinitionKey;
  /** Custom fixture of the user or Open Fixture Library fixture. */
  source: 'custom' | 'ofl';
  /** Definition name. */
  name: string;
  /** Manufacturer display name (`''` for custom fixtures). */
  manufacturer: string;
  /** All modes, in definition order. */
  modes: RdmDefinitionMode[];
  /**
   * RDM personality (1-based) → 0-based mode index. Only modes that declare
   * `rdmPersonalityIndex` appear; when several declare the same personality
   * the first one wins.
   */
  modeByPersonality: Record<number, number>;
}

/**
 * Finds the fixture definition of a device by its RDM manufacturer ID and
 * device model ID (both 0–0xFFFF): the user's custom fixtures first, then the
 * Open Fixture Library (manufacturer `rdmId`, fixture `rdm.modelId`).
 * Resolves `null` when nothing matches, the IDs are invalid or the library
 * is unreachable.
 */
export function findFixtureDefinitionByRdm(manufacturerId: number, modelId: number): Promise<RdmDefinitionMatch | null> {
  return getHostApi().findFixtureDefinitionByRdm(manufacturerId, modelId);
}

/**
 * Stores a fixture definition in Open Fixture Library JSON format as a NEW
 * custom fixture of the user (API 1.4) — e.g. one generated from a device's
 * RDM slot descriptions — so the user can edit it in the custom fixture
 * editor. Never replaces an existing custom fixture: a name already in use
 * gets a numeric suffix. Validated like the editor's OFL import (`name`,
 * non-empty `modes` with `channels`, `availableChannels` and/or
 * `templateChannels`); every mode must build.
 *
 * Set `rdm.modelId`, `pixelmapper.rdmManufacturerId` and the modes'
 * `rdmPersonalityIndex` so `findFixtureDefinitionByRdm` finds the definition
 * next time. Resolves the key `'custom/<id>'` for `commands.addFixtures`
 * (async since API 1.7: custom fixtures are synced user records).
 *
 * @throws (rejects) Error when the definition is invalid.
 *
 * @example
 * const key = await saveCustomFixtureDefinition({
 *   name: 'Acme Bar (RDM)', categories: ['Pixel Bar'],
 *   rdm: { modelId: 1 }, pixelmapper: { rdmManufacturerId: 0x7ff0 },
 *   availableChannels: { Dimmer: { capability: { type: 'Intensity' } } },
 *   modes: [{ name: '1 ch', rdmPersonalityIndex: 1, channels: ['Dimmer'] }],
 * });
 */
export function saveCustomFixtureDefinition(definition: Json): Promise<FixtureDefinitionKey> {
  return getHostApi().saveCustomFixtureDefinition(definition);
}

// ── Addressing ──────────────────────────────────

/** Anything that occupies DMX channels (e.g. a `FixtureSummary`). */
export interface AddressOccupant {
  /** Fixture id, matched by `FindFreeAddressOptions.ignore`. */
  id?: FixtureId;
  /** 1-based absolute start address. */
  startAddress: number;
  /** Number of channels from `startAddress`. */
  channelCount: number;
}

/** Options of `findFreeAddressSpan`. */
export interface FindFreeAddressOptions {
  /** Occupants to skip, e.g. the fixtures being re-addressed. */
  ignore?: readonly FixtureId[];
  /**
   * 1-based universe the whole span must lie in. Without it the search runs
   * over the absolute address space (like the add dialog) and the span may
   * cross a universe boundary.
   */
  universe?: number;
}

/**
 * First absolute start address (1-based) of a gap of `footprint * count`
 * channels not used by `fixtures` — the same search the add-fixture dialog
 * uses. Returns `null` only when `options.universe` is given and the span
 * does not fit into that universe.
 *
 * @example
 * // Free address for one 12-channel device in universe 2, ignoring itself.
 * const start = findFreeAddressSpan(listFixtures(), 12, 1, { universe: 2, ignore: [fixtureId] });
 */
export function findFreeAddressSpan(
  fixtures: readonly AddressOccupant[],
  footprint: number,
  count: number,
  options?: FindFreeAddressOptions,
): number | null {
  return getHostApi().findFreeAddressSpan(fixtures, footprint, count, options);
}

/**
 * Snapshot of all fixtures of the project in scene order (like the
 * `project` scope's `fixtures`, usable outside components).
 */
export function listFixtures(): FixtureSummary[] {
  return getHostApi().listFixtures();
}

// ── Patch state ─────────────────────────────────

/** The patch of a fixture at one moment. */
export interface FixturePatchState {
  /** 1-based absolute start address. */
  startAddress: number;
  /** 1-based universe (derived from `startAddress`). */
  universe: number;
  /** 1-based address inside the universe (derived from `startAddress`). */
  localAddress: number;
  /** Number of channels. */
  channelCount: number;
  /** 0-based mode index; `undefined` for fixtures without a known definition. */
  modeIndex?: number;
}

// ── Change guard ────────────────────────────────

/** A patch change the user is about to make in the core UI. */
export interface FixtureChangeRequest {
  fixtureId: FixtureId;
  /** Patch now. */
  before: FixturePatchState;
  /** Patch after the change. */
  after: FixturePatchState;
}

/**
 * Answer of a guard:
 * - `allow` — no objection (returning nothing means the same),
 * - `confirm` — the core asks the user with `message`; the change happens only if they confirm,
 * - `deny` — the change does not happen; `message` is shown to the user.
 */
export type FixtureChangeVerdict =
  | { action: 'allow' }
  | {
      action: 'confirm';
      /** Explanation shown in the confirm dialog. */
      message: string;
      /** Dialog title (default "Change fixture patch?"). */
      title?: string;
      /** Label of the confirm button (default "Change anyway"). */
      confirmLabel?: string;
    }
  | { action: 'deny'; message?: string };

/** A guard; may be async. Exceptions count as `allow` (logged). */
export type FixtureChangeGuard = (
  change: FixtureChangeRequest,
) => FixtureChangeVerdict | void | Promise<FixtureChangeVerdict | void>;

/**
 * Registers a guard evaluated before the core UI changes a fixture's start
 * address, universe or mode (inspector fields, address grid drag, Mode
 * select). All guards run; any `deny` wins, otherwise all `confirm` messages
 * are shown in one core confirm dialog.
 *
 * Guards never block commands run programmatically (`ctx.run`, extension
 * code), undo/redo, collaborator changes or replays. Returns the
 * unregister function.
 *
 * @example
 * onBeforeFixtureChange((change) => {
 *   if (change.before.universe !== change.after.universe && isLinked(change.fixtureId)) {
 *     return { action: 'confirm', message: 'This fixture is bound to a physical output port.' };
 *   }
 * });
 */
export function onBeforeFixtureChange(guard: FixtureChangeGuard): () => void {
  return getHostApi().onBeforeFixtureChange(guard);
}

// ── Change observation ──────────────────────────

/**
 * How a patch change reached the model: a command executed in this app
 * (`local`, by the user or an extension), undo, redo, or a collaborator's
 * change (`remote`).
 */
export type FixturePatchChangeOrigin = 'local' | 'undo' | 'redo' | 'remote';

/** One observed patch change. */
export interface FixturePatchChange {
  fixtureId: FixtureId;
  /** Patch before; `null` when the fixture appeared (added, undo of a delete). */
  before: FixturePatchState | null;
  /** Patch after; `null` when the fixture disappeared (deleted, undo of an add). */
  after: FixturePatchState | null;
  origin: FixturePatchChangeOrigin;
  /**
   * Id of the extension whose `ctx.run` / `api.run` executed the change
   * (`local` origin only); `undefined` for the core UI.
   */
  initiator?: string;
}

/** Options of `onFixturePatchChange`. */
export interface FixturePatchObserverOptions {
  /**
   * Fixtures to observe: a list, or a function returning the current list
   * (evaluated per change). Default: all fixtures.
   */
  fixtureIds?: readonly FixtureId[] | (() => Iterable<FixtureId>);
}

/**
 * Subscribes to patch changes (start address, universe, channel count, mode)
 * of fixtures, whatever caused them: local commands, undo/redo and
 * collaborator changes. Loading a project is not a change. The callback
 * gets all changes of one history step together, asynchronously (a
 * microtask after the step), so it may run commands. Returns the
 * unsubscribe function.
 */
export function onFixturePatchChange(
  callback: (changes: FixturePatchChange[]) => void,
  options?: FixturePatchObserverOptions,
): () => void {
  return getHostApi().onFixturePatchChange(callback, options);
}
