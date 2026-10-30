/**
 * MCP bridge boot (plan M3): connects to `pixelmapper-mcp` at start when
 * *Settings → External agents* is enabled on this device. Host and tools
 * are built lazily, so a disabled bridge costs nothing.
 */
import { getAgentBridge } from '#platform';

export default defineNuxtPlugin({
  name: 'pm:agent-bridge',
  setup() {
    try {
      getAgentBridge().init();
    } catch (error) {
      console.error('[agent-bridge] start failed', error);
    }
  },
});
