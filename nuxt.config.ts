import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { fileURLToPath } from 'node:url';

/**
 * First-party extensions included as Nuxt layers (ADR §5.9 distribution set,
 * amended by A12: color-picker, pan-tilt, connector-artnet). The dev-only `_debug-slots`
 * extension labels every slot; enable it with PM_DEBUG_SLOTS=1 in dev.
 */
const FIRST_PARTY_EXTENSIONS: string[] = [
  './extensions/color-picker',
  './extensions/pan-tilt',
  './extensions/connector-artnet',
  // Catalog extensions (ADR §5.9); layers until the runtime loader (P6.5/P6.6) installs them on demand.
  './extensions/neopixel-strip',
  './extensions/connector-esp',
];
const DEBUG_SLOTS = process.env.PM_DEBUG_SLOTS === '1' && process.env.NODE_ENV !== 'production';

export default defineNuxtConfig({
  extends: [
    ...FIRST_PARTY_EXTENSIONS,
    ...(DEBUG_SLOTS ? ['./extensions/_debug-slots'] : []),
  ],

  typescript: {
    tsConfig: {
      compilerOptions: {
        types: ['w3c-web-serial'],
      },
      include: ['../controllers/**/*.ts'],
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
    resolve: {
      alias: {
        '~controllers': fileURLToPath(new URL('./controllers', import.meta.url)),
      },
    },
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