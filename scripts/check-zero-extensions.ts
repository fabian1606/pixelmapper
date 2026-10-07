/**
 * Zero-extension check (ADR D17, plan P6.9): the core must build and work
 * without any extension. Builds the app with `PM_NO_EXTENSIONS=1`
 * (`extends: []`) and runs the zero-extension smoke test (project without
 * kinds, OFL fixture, built-in modifier, real engine render).
 *
 * Usage: bun run scripts/check-zero-extensions.ts [--skip-build]
 */
import { $ } from 'bun';

const skipBuild = process.argv.includes('--skip-build');
const env = { ...process.env, PM_NO_EXTENSIONS: '1', SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://localhost', SUPABASE_KEY: process.env.SUPABASE_KEY ?? 'zero-extension-check' };

if (!skipBuild) {
  console.log('▶ building without extensions …');
  await $`bun run build:plugins`.env(env);
  await $`bunx nuxt build`.env(env).quiet();
  console.log('✓ build without extensions');
}
console.log('▶ smoke test …');
await $`bunx vitest run app/zero-extensions.smoke.test.ts`.env(env);
console.log('✓ zero-extension check passed');
