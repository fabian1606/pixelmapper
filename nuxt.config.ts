import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { buildOflBundle } from './scripts/tauri/ofl-bundle';

/**
 * First-party extensions included as Nuxt layers: the distribution set
 * (ADR §5.9 as amended by A12: color-picker, pan-tilt, connector-artnet).
 * Catalog extensions are bundled by `scripts/build-extensions.ts` and
 * installed on demand at runtime (Extensions page); in dev they are also
 * layered for HMR unless PM_CATALOG_LAYERS=0. The dev-only `_debug-slots`
 * extension labels every slot (PM_DEBUG_SLOTS=1).
 */
const FIRST_PARTY_EXTENSIONS: string[] = [
  './extensions/color-picker',
  './extensions/pan-tilt',
  './extensions/connector-artnet',
];
const CATALOG_EXTENSIONS: string[] = [
  './extensions/neopixel-strip',
  './extensions/connector-esp',
  './extensions/controller-akai-apc-mini-mk2',
];
const CATALOG_AS_LAYERS = process.env.NODE_ENV !== 'production' && process.env.PM_CATALOG_LAYERS !== '0';
const DEBUG_SLOTS = process.env.PM_DEBUG_SLOTS === '1' && process.env.NODE_ENV !== 'production';
/** Zero-extension build (ADR D17 check, plan P6.9): the core alone must build and run. */
const NO_EXTENSIONS = process.env.PM_NO_EXTENSIONS === '1';
/**
 * Platform implementation behind `#platform` (ADR 0003 D3): the Tauri CLI
 * sets `TAURI_ENV_PLATFORM` while it drives the build, everything else is
 * the web platform. Web bundles therefore never contain Tauri code.
 */
const IS_TAURI = !!process.env.TAURI_ENV_PLATFORM;
const PLATFORM_DIR = IS_TAURI ? 'tauri' : 'web';

/**
 * Extra public dir of desktop builds (gitignored): the offline OFL library
 * (ADR 0004 D18) is written here and served at `/ofl/`. Web builds never
 * see it and keep using the Nitro route `/api/fixtures`.
 */
const TAURI_PUBLIC_DIR = fileURLToPath(new URL('./.tauri-public', import.meta.url));

/** Inline module (Tauri only): builds the OFL bundle before Nitro starts. */
async function bundleOflForTauri(): Promise<void> {
  const src = fileURLToPath(new URL('./ofl-data/fixtures', import.meta.url));
  const stats = await buildOflBundle(src, TAURI_PUBLIC_DIR);
  if (!stats) console.warn('[ofl-bundle] ofl-data/fixtures missing — the desktop fixture library will be empty (run ./scripts/setup-ofl.sh)');
  else console.info(`[ofl-bundle] ${stats.fixtures} fixtures bundled for the desktop app`);
}

export default defineNuxtConfig({
  // The desktop app loads static files from disk: build it as an SPA
  // (`bun run generate` → `.output/public`, see src-tauri/tauri.conf.json).
  ssr: !IS_TAURI,
  alias: {
    '#platform': fileURLToPath(new URL(`./app/platform/${PLATFORM_DIR}/index.ts`, import.meta.url)),
  },
  // Separate build dir for QA builds next to a running dev server (`.nuxt` is shared otherwise).
  ...(process.env.PM_BUILD_DIR ? { buildDir: process.env.PM_BUILD_DIR } : {}),
  extends: NO_EXTENSIONS ? [] : [
    ...FIRST_PARTY_EXTENSIONS,
    ...(CATALOG_AS_LAYERS ? CATALOG_EXTENSIONS : []),
    ...(DEBUG_SLOTS ? ['./extensions/_debug-slots'] : []),
  ],

  typescript: {
    tsConfig: {
      compilerOptions: {
        types: ['w3c-web-serial'],
      },
    },
  },
  devtools: {
    enabled: false // or false to disable
  },

  css: ['~/assets/css/tailwind.css'],

  runtimeConfig: {
    public: {
      aiBackendUrl: process.env.NUXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:4000',
    }
  },

  vite: {
    plugins: [
      wasm(),
      topLevelAwait(),
      //@ts-ignore
      tailwindcss(),
    ],
    build: {
      target: 'esnext', // required for top-level await support
    },
    optimizeDeps: {
      exclude: ['rs-engine-canvas', 'rs-engine-core'],
      // Pre-bundle deps the scanner only finds while the page loads. Otherwise a
      // cold dev start re-optimizes mid-load and reloads; WKWebView (Tauri) can
      // end up with two Vue module graphs (`currentRenderingInstance.ce` error).
      include: [
        '@vueuse/core',
        'class-variance-authority',
        'clsx',
        'fflate',
        'lucide-vue-next',
        'reka-ui',
        'semver',
        'tailwind-merge',
        ...(IS_TAURI ? ['@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/api/window'] : []),
      ],
    },
    server: {
      watch: {
        ignored: ['!**/node_modules/rs-engine-canvas/**', '!**/node_modules/rs-engine-core/**'],
      },
    },
  },

  modules: [
    'shadcn-nuxt',
    '@nuxtjs/color-mode',
    '@pinia/nuxt',
    '@nuxtjs/supabase',
    ...(IS_TAURI ? [bundleOflForTauri] : []),
  ],

  supabase: {
    // SSR cookies are `Secure`; WebKit (Tauri) drops Secure cookies on
    // http://localhost and the app origin is tauri://localhost in release
    // builds. The desktop app renders client-side only, so it keeps the
    // session in localStorage instead.
    useSsrCookies: !IS_TAURI,
    // The desktop app boots without an account (ADR 0004 D3): the module's
    // global login redirect is off there and `auth.global.ts` decides per
    // route via `getAccountPolicy()`. The web app keeps mandatory login.
    redirect: !IS_TAURI,
    redirectOptions: {
      login: '/auth/login',
      callback: '/auth/confirm',
      exclude: ['/auth/*', '/share/*'],
    },
  },
  colorMode: {
    classSuffix: '',
    preference: 'dark',
  },
  nitro: {
    serverAssets: [
      {
        baseName: 'ofl-fixtures',
        dir: '../ofl-data/fixtures'
      }
    ],
    // Desktop only: static OFL bundle next to the SPA (see TAURI_PUBLIC_DIR).
    ...(IS_TAURI ? { publicAssets: [{ dir: TAURI_PUBLIC_DIR }] } : {}),
  }
})