import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineNuxtConfig({
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

  modules: ['shadcn-nuxt', '@nuxtjs/color-mode', '@pinia/nuxt'],
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