// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'Admin · wireredblue',
      htmlAttrs: { lang: 'fr' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
    },
  },
  // Valeurs lues au démarrage depuis les variables NUXT_* (voir .env.example)
  runtimeConfig: {
    domain: 'wireredblue.xyz',
    allowedOrigin: 'https://admin.wireredblue.xyz',
    dynamicDir: '/data/traefik-dynamic',
    flagsDir: '/data/flags',
    stateFile: '/data/state/sites.json',
    public: {
      domain: 'wireredblue.xyz',
    },
  },
})
