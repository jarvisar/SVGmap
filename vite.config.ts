import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const DAY = 24 * 60 * 60;

export default defineConfig({
  // Relative asset URLs so the build works under any GitHub Pages path.
  base: './',
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the user clicks Reload (see UpdateNotice) so a
      // deploy never reloads the page in the middle of a render.
      registerType: 'prompt',
      // Already matched by globPatterns below.
      includeManifestIcons: false,
      manifest: {
        id: './',
        name: 'SVGmap',
        short_name: 'SVGmap',
        description: 'Make SVG maps of any city from OpenStreetMap data for laser engraving, pen plotters and print.',
        theme_color: '#36383d',
        background_color: '#e4e4e4',
        display: 'standalone',
        categories: ['design', 'utilities'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          { src: 'preview.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide', label: 'Map of downtown Chicago' },
        ],
      },
      workbox: {
        // The app plus the title fonts and sample routes, so it opens and draws titles offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,ttf,json,gpx}'],
        globIgnores: ['preview.png'],
        // Control the first visit right away so its tiles get cached too. Updates
        // still wait for the prompt.
        clientsClaim: true,
        runtimeCaching: [
          {
            // The style and TileJSON point at the latest tile build, so try the network first.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/(styles\/[^/]+|planet)$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'openfreemap-style',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 10 },
            },
          },
          {
            // Tile and sprite URLs include the build version and glyphs never change,
            // so a cached copy is always good. Maps that were generated before can be
            // generated again offline. Only viewing an area doesn't do it, the map view
            // stops a zoom level or two short of the zoom 14 tiles a render reads.
            // City center tiles are 200 to 500 KB each, so keep the count low.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'openfreemap-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // The about page is plain HTML so crawlers can read it without running the app.
    rolldownOptions: {
      input: { main: 'index.html', about: 'about.html' },
    },
    sourcemap: true,
    // MapLibre alone is about 1 MB.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
