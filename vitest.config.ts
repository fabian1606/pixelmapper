import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/** Resolves a path relative to the repository root. */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vitest configuration.
 *
 * Mirrors the Nuxt path aliases (`~`, `@` → `app/`, `~~`/`@@` → repo root)
 * so unit tests can import app code without booting Nuxt. Component tests
 * run in `happy-dom`; pure logic tests can opt into `node` per file via
 * `// @vitest-environment node`.
 */
export default defineConfig({
  plugins: [vue()],
  // Nuxt's dev flag (dev-only diagnostics such as the rendered-slot catalog).
  define: { 'import.meta.dev': 'true' },
  resolve: {
    alias: {
      '~~': r('./'),
      '@@': r('./'),
      '~': r('./app'),
      '@': r('./app'),
      // Tests always run against the web platform (ADR 0003 D3).
      '#platform': r('./app/platform/web/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: [
      'app/**/*.test.ts',
      'packages/**/*.test.ts',
      'extensions/**/*.test.ts',
      'scripts/**/*.test.ts',
      'plugins/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'ofl-data/**'],
  },
});
