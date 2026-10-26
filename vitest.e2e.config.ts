import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/** Resolves a path relative to the repository root. */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vitest configuration of the opt-in end-to-end tests (`*.e2e.test.ts`).
 *
 * They start external processes — e.g. `bun run test:e2e:artnet` runs the
 * Art-Net plugin against the real `pmnet-bridge` and `pmnet sim` of the
 * hardware repo (`PIXELMAPPER_HARDWARE_DIR`) — so they are excluded from
 * `bun run test` and run one file at a time with long timeouts. Same path
 * aliases as `vitest.config.ts`. The Node environment keeps Node's own
 * WebSocket (it can send an `Origin` header; happy-dom would replace it).
 */
export default defineConfig({
  plugins: [vue()],
  // Nuxt's dev flag (dev-only diagnostics), as in the unit test config.
  define: { 'import.meta.dev': 'true' },
  resolve: {
    alias: {
      '~~': r('./'),
      '@@': r('./'),
      '~': r('./app'),
      '@': r('./app'),
      '#platform': r('./app/platform/web/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['extensions/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**'],
    // Building the binaries, discovery and a firmware flash take a while.
    testTimeout: 120_000,
    hookTimeout: 660_000,
    fileParallelism: false,
  },
});
