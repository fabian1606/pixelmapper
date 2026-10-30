/**
 * Shared add path for new fixtures (plan M4.1, decision D16).
 *
 * Used by the add-fixture dialog (`useWorkspaceOperations.handleAddOflFixtures`)
 * and the extension API (`commands.addFixtures`, `commands.addFixture`):
 * ids and addresses, placement (centre + diagonal cascade), one
 * `AddFixturesCommand`, and the selection afterwards.
 */
import type { Fixture } from './core/fixture';
import type { SceneNode } from './core/group';
import { assignIdsAndAddresses } from './addressing';
import { AddFixturesCommand } from '~/components/engine/commands/add-fixture-command';

/** Normalized world position of the first added fixture. */
const PLACEMENT_ORIGIN = { x: 0.5, y: 0.5 };
/** Diagonal offset between consecutively added fixtures. */
const PLACEMENT_STEP = 0.02;

/** Options of `placeNewFixtures`. */
export interface PlaceFixturesOptions {
  /**
   * Explicit absolute start addresses, index-aligned with the fixtures.
   * Missing entries are appended after the highest used address.
   */
  startAddresses?: readonly (number | undefined)[];
}

/**
 * Prepares new fixtures for the scene: assigns ids and start addresses and
 * cascades their positions from the centre so several fixtures do not
 * overlap (kind geometry is relative to `fixturePosition`, so this works for
 * every fixture).
 */
export function placeNewFixtures(fixtures: Fixture[], existing: readonly Fixture[], options: PlaceFixturesOptions = {}): void {
  assignIdsAndAddresses(fixtures, existing, options.startAddresses);
  fixtures.forEach((f, i) => {
    f.fixturePosition = { x: PLACEMENT_ORIGIN.x + i * PLACEMENT_STEP, y: PLACEMENT_ORIGIN.y + i * PLACEMENT_STEP };
  });
}

/** Places new fixtures and returns the one command that adds them. */
export function createAddFixturesCommand(
  sceneNodes: SceneNode[],
  fixtures: Fixture[],
  existing: readonly Fixture[],
  options: PlaceFixturesOptions = {},
): AddFixturesCommand {
  placeNewFixtures(fixtures, existing, options);
  return new AddFixturesCommand(sceneNodes, fixtures);
}

/** Selection after adding: the current selection plus the new fixtures. */
export function selectionWithAdded(selected: ReadonlySet<string | number>, fixtures: readonly Fixture[]): Set<string | number> {
  const next = new Set(selected);
  for (const f of fixtures) next.add(f.id);
  return next;
}
