/**
 * Registers the `neopixel-strip` extension with the host.
 */
import { registerExtension } from '@pixelmapper/extension-api';
import manifest from '../extension';

export default defineNuxtPlugin(() => {
  registerExtension(manifest);
});
