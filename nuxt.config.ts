import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  css: ['~/assets/css/tailwind.css'],

  vite: {
    plugins: [
      //@ts-ignore
      tailwindcss(),
    ],
  },

  modules: ['shadcn-nuxt', '@nuxtjs/color-mode'],
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