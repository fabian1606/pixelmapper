/**
 * Registers the core operation catalog (ADR 0002 §4.2) at boot, before the
 * agent bridge (`08.agent-bridge.client.ts`) can announce tools that run
 * operations. Idempotent (HMR re-runs skip already registered ids).
 */
import { registerCoreOperations } from '~/utils/operations';

export default defineNuxtPlugin(() => {
  try {
    registerCoreOperations();
  }
  catch (err) {
    console.error('[operations] registering the core catalog failed:', err);
  }
});
