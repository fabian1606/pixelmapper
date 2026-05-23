import type { Preset, PresetType, OverwriteTarget } from '~/utils/engine/preset-types';
import { type SerializableCommand, registerCommand } from './serializable-command';

interface MetadataPatch {
  name?: string;
  /** undefined = don't touch; null = delete the property */
  color?: string | null;
  type?: PresetType;
  /** undefined = don't touch; null = delete the property */
  overwriteTarget?: OverwriteTarget | null;
}

export class UpdatePresetMetadataCommand implements SerializableCommand {
  readonly commandType = 'UpdatePresetMetadata';
  readonly description = 'Update Preset Metadata';

  constructor(
    private presetId: string,
    private before: MetadataPatch,
    private after: MetadataPatch,
    private getSavedPresets: () => Preset[],
    private setSavedPresets: (presets: Preset[]) => void,
  ) {}

  toPayload() {
    return { presetId: this.presetId, before: this.before, after: this.after };
  }

  execute() { this.applyPatch(this.after); }
  undo()    { this.applyPatch(this.before); }

  private applyPatch(patch: MetadataPatch) {
    const presets = [...this.getSavedPresets()];
    const p = presets.find(x => x.id === this.presetId);
    if (!p) return;
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.color !== undefined) {
      if (patch.color !== null) p.color = patch.color;
      else delete p.color;
    }
    if (patch.type !== undefined) p.type = patch.type;
    if (patch.overwriteTarget !== undefined) {
      if (patch.overwriteTarget !== null) p.overwriteTarget = patch.overwriteTarget;
      else p.overwriteTarget = undefined;
    }
    this.setSavedPresets(presets);
  }
}

registerCommand('UpdatePresetMetadata', (payload, ctx) => {
  return new UpdatePresetMetadataCommand(
    payload.presetId,
    payload.before,
    payload.after,
    () => ctx.savedPresets,
    ctx.setSavedPresets,
  );
});
