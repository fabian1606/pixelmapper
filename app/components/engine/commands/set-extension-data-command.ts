import type { ExtensionDataOwner, Json } from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { cloneJson } from '~/utils/kinds/kind-host';
import { findFixtureInTree } from '~/utils/engine/scene-tree';
import type { SceneNode } from '~/utils/engine/core/group';
import { type SerializableCommand, registerCommand } from './serializable-command';

/** Payload of `SetExtensionData`. */
export interface SetExtensionDataPayload {
  owner: ExtensionDataOwner;
  ownerId?: string | number;
  extensionId: string;
  key: string;
  /** Previous value (`undefined` = absent). */
  before?: Json;
  /** New value (`undefined` deletes the key). */
  after?: Json;
}

/** An `extensionData` map holder. */
type DataHolder = { extensionData?: Record<string, Record<string, unknown>> };

/**
 * Resolves the object holding `extensionData` for an owner: a fixture, the
 * project (engine store) or a live widget on any page. Null when missing.
 */
function holderOf(owner: ExtensionDataOwner, ownerId: string | number | undefined): DataHolder | null {
  const engineStore = useEngineStore();
  if (owner === 'project') return engineStore.projectExtension;
  // Walk the live tree (not the cached `flatFixtures`): in a batch the fixture
  // may have been added by an earlier command of the same step (plan M4.4).
  if (owner === 'fixture') {
    return ownerId === undefined ? null : (findFixtureInTree(engineStore.sceneNodes as SceneNode[], ownerId) as DataHolder | undefined) ?? null;
  }
  for (const page of useLiveModeStore().pages) {
    const w = page.widgets.find(x => x.id === ownerId);
    if (w) return w;
  }
  return null;
}

/** Reads one value. */
export function readExtensionData(owner: ExtensionDataOwner, ownerId: string | number | undefined, extensionId: string, key: string): Json | undefined {
  const v = holderOf(owner, ownerId)?.extensionData?.[extensionId]?.[key];
  return v === undefined ? undefined : cloneJson(v) as Json;
}

/**
 * Writes namespaced extension data (ADR §5.8): JSON at
 * `owner.extensionData[extensionId][key]`. Empty maps are removed so
 * `requires` bookkeeping sees when an extension leaves no data behind.
 */
export class SetExtensionDataCommand implements SerializableCommand {
  readonly commandType = 'SetExtensionData';
  readonly description: string;

  constructor(private readonly p: SetExtensionDataPayload) {
    this.description = `Update ${p.extensionId} data`;
  }

  execute() { this.write(this.p.after); }
  undo() { this.write(this.p.before); }

  toPayload() {
    return { ...this.p };
  }

  /** Sets or deletes the key. */
  private write(value: Json | undefined) {
    const holder = holderOf(this.p.owner, this.p.ownerId);
    if (!holder) return;
    const all = { ...(holder.extensionData ?? {}) };
    const mine = { ...(all[this.p.extensionId] ?? {}) };
    if (value === undefined) delete mine[this.p.key];
    else mine[this.p.key] = cloneJson(value);
    if (Object.keys(mine).length > 0) all[this.p.extensionId] = mine;
    else delete all[this.p.extensionId];
    holder.extensionData = Object.keys(all).length > 0 ? all : undefined;
  }
}

registerCommand('SetExtensionData', payload => new SetExtensionDataCommand(payload as SetExtensionDataPayload));
