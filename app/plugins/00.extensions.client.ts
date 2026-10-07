/**
 * Extension host boot (ADR §5.9, steps 1–2).
 *
 * 1. Install the shared globals (`vue`, `pinia`, extension API).
 * 2. Register first-party layer extensions. Their `plugins/register.ts`
 *    call `registerExtension` from the API package; calls that ran before
 *    this plugin were queued and are drained here.
 * 3. (plan P6.6) Load cached installed bundles.
 * Project loading happens afterwards in the project layout.
 */
import { installSharedGlobals } from '~/utils/extensions/shared-globals';

export default defineNuxtPlugin({
  name: 'pm:extension-host',
  enforce: 'pre',
  setup() {
    installSharedGlobals();
  },
});
