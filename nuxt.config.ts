import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

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

export default defineNuxtConfig({
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
    },
    server: {
      watch: {
        ignored: ['!**/node_modules/rs-engine-canvas/**', '!**/node_modules/rs-engine-core/**'],
      },
    },
  },

  modules: ['shadcn-nuxt', '@nuxtjs/color-mode', '@pinia/nuxt', '@nuxtjs/supabase'],

  supabase: {
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
    ]
  }
})