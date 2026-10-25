/**
 * The chosen firmware file of the update dialog: reads the `.hex` text and
 * asks the bridge for its trailer (`imageInfo`), which the preview and the
 * eligibility check use. Only the latest choice counts.
 */
import { shallowRef } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { FirmwareImageInfo } from '../bridge/protocol-model';
import { describeFlashError } from './firmware-errors';

/** Larger files cannot be tube images (and exceed the bridge's 4 MiB message limit). */
export const MAX_FIRMWARE_FILE_BYTES = 1024 * 1024;

/** What `chooseFile` needs of a `File`. */
export interface FirmwareFile {
  name: string;
  size: number;
  text(): Promise<string>;
}

/**
 * File state. `onChange` runs whenever another file is chosen or the file
 * is cleared (the dialog resets its selection).
 */
export function useFirmwareImage(backend: ArtNetBackend, onChange?: () => void) {
  const fileName = shallowRef<string | null>(null);
  /** Content of a valid image (sent with `flash`). */
  const hex = shallowRef<string | null>(null);
  const image = shallowRef<FirmwareImageInfo | null>(null);
  const imageError = shallowRef<string | null>(null);
  const loadingImage = shallowRef(false);
  let seq = 0;

  /** Reads a `.hex` file and asks the bridge for its trailer. */
  async function chooseFile(file: FirmwareFile): Promise<void> {
    const mine = ++seq;
    fileName.value = file.name;
    hex.value = image.value = imageError.value = null;
    onChange?.();
    if (file.size > MAX_FIRMWARE_FILE_BYTES) {
      imageError.value = 'The file is too large for a tube firmware image';
      return;
    }
    loadingImage.value = true;
    try {
      const text = await file.text();
      const info = await backend.request('imageInfo', { hex: text });
      if (mine !== seq) return;
      hex.value = text;
      image.value = info;
    }
    catch (err) {
      if (mine !== seq) return;
      const { message, detail } = describeFlashError(err);
      imageError.value = detail ? `${message}: ${detail}` : message;
    }
    finally {
      if (mine === seq) loadingImage.value = false;
    }
  }

  /** Forgets the chosen file. */
  function clearFile(): void {
    seq++;
    fileName.value = hex.value = image.value = imageError.value = null;
    loadingImage.value = false;
    onChange?.();
  }

  return { fileName, hex, image, imageError, loadingImage, chooseFile, clearFile };
}
