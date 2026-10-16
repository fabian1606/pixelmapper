import type { Command } from '../composables/use-history'
import { migrateModifiersDeep } from '~/utils/persistence/migrations/v3-distribution'
import type { SceneNode } from '~/utils/engine/core/group'
import type { Fixture } from '~/utils/engine/core/fixture'
import type { ModifierInstance } from '~/utils/engine/types'
import type { Preset } from '~/utils/engine/preset-types'

/**
 * Extended Command that can be persisted to Supabase project_changes.
 */
export interface SerializableCommand extends Command {
  /** Unique string key matching the DB command_type column. */
  readonly commandType: string
  /** Returns a plain JSON-serializable payload representing this command. */
  toPayload(): object
}

export function isSerializable(cmd: Command): cmd is SerializableCommand {
  return 'commandType' in cmd && 'toPayload' in cmd
}

// ─── Registry ─────────────────────────────────────────────────────────────────
// Maps commandType → a factory that recreates the command from its payload
// and the live engine state (needed to look up Fixture/Effect instances by ID).

export interface ReplayContext {
  sceneNodes: SceneNode[]
  flatFixtures: Fixture[]
  modifiers: ModifierInstance[]
  savedPresets: Preset[]
  setSavedPresets: (p: Preset[]) => void
  getSelectedPresetId: () => string | null
  setSelectedPresetId: (id: string | null) => void
}

type CommandFactory = (payload: any, ctx: ReplayContext) => Command

const registry = new Map<string, CommandFactory>()

export function registerCommand(type: string, factory: CommandFactory) {
  registry.set(type, factory)
}

export function commandFromPayload(
  commandType: string,
  payload: any,
  ctx: ReplayContext,
): Command | null {
  const factory = registry.get(commandType)
  if (!factory) return null
  // Payloads recorded before schema 3 carry v2 modifier instances (plan M3.8).
  return factory(migrateModifiersDeep(payload), ctx)
}
