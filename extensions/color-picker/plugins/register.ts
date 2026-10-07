/**
 * Registers the `color-picker` extension with the host.
 */
import { registerExtension } from '@pixelmapper/extension-api';
import manifest from '../extension';

export default defineNuxtPlugin(() => {
  registerExtension(manifest);
});
