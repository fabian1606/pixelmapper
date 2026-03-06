import type { Command } from '../composables/use-history';
import type { Preset, PresetCategory } from '~/utils/engine/preset-types';
import type { Ref } from 'vue';

/**
 * Undoable command for creating a preset.
 * Undo removes the preset from the saved list; redo re-adds it.
 */
export class SavePresetCommand implements Command {
  description: string;

  constructor(
    private preset: Preset,
    private getSavedPresets: () => Preset[],
    private setSavedPresets: (presets: Preset[]) => void,
    private getSelectedId: () => string | null,
    private setSelectedId: (id: string | null) => void
  ) {
    this.description = `Save Preset "${preset.name}"`;
  }

  execute() {
    const presets = [...this.getSavedPresets()];
    if (!presets.find((p) => p.id === this.preset.id)) {
      presets.push(this.preset);
      this.setSavedPresets(presets);
    }
    this.setSelectedId(this.preset.id);
  }

  undo() {
    const presets = [...this.getSavedPresets()];
    const idx = presets.findIndex((p) => p.id === this.preset.id);
    if (idx !== -1) {
      presets.splice(idx, 1);
      this.setSavedPresets(presets);
    }
    if (this.getSelectedId() === this.preset.id) {
      this.setSelectedId(null);
    }
  }
}

/**
 * Undoable command for deleting a preset.
 * Records the preset's position so undo can restore it in the same slot.
 */
export class DeletePresetCommand implements Command {
  description: string;
  private deletedIndex: number = -1;

  constructor(
    private preset: Preset,
    private getSavedPresets: () => Preset[],
    private setSavedPresets: (presets: Preset[]) => void,
    private getSelectedId: () => string | null,
    private setSelectedId: (id: string | null) => void
  ) {
    this.description = `Delete Preset "${preset.name}"`;
  }

  execute() {
    const presets = [...this.getSavedPresets()];
    this.deletedIndex = presets.findIndex((p) => p.id === this.preset.id);
    if (this.deletedIndex !== -1) {
      presets.splice(this.deletedIndex, 1);
      this.setSavedPresets(presets);
    }
    if (this.getSelectedId() === this.preset.id) {
      this.setSelectedId(null);
    }
  }

  undo() {
    const presets = [...this.getSavedPresets()];
    const insertAt = Math.min(this.deletedIndex !== -1 ? this.deletedIndex : presets.length, presets.length);
    presets.splice(insertAt, 0, this.preset);
    this.setSavedPresets(presets);
    this.setSelectedId(this.preset.id);
  }
}

/**
 * Undoable command for overwriting a preset.
 * Saves the old categories before overwriting to allow undoing.
 */
export class OverwritePresetCommand implements Command {
  description: string;
  private readonly oldCategories: PresetCategory[];
  private readonly newCategories: PresetCategory[];

  constructor(
    private presetId: string,
    private presetName: string,
    private oldCats: PresetCategory[],
    private newCats: PresetCategory[],
    private getSavedPresets: () => Preset[],
    private setSavedPresets: (presets: Preset[]) => void
  ) {
    this.description = `Overwrite Preset "${presetName}"`;
    // Deep clone to ensure no references are mutually updated
    this.oldCategories = JSON.parse(JSON.stringify(oldCats));
    this.newCategories = JSON.parse(JSON.stringify(newCats));
  }

  execute() {
    const presets = [...this.getSavedPresets()];
    const preset = presets.find((p) => p.id === this.presetId);
    if (preset) {
      preset.categories = JSON.parse(JSON.stringify(this.newCategories));
      this.setSavedPresets(presets);
    }
  }

  undo() {
    const presets = [...this.getSavedPresets()];
    const preset = presets.find((p) => p.id === this.presetId);
    if (preset) {
      preset.categories = JSON.parse(JSON.stringify(this.oldCategories));
      this.setSavedPresets(presets);
    }
  }
}
