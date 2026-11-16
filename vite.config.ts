import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

// GitHub Pages serves the app under /<repo>/; local dev and tests keep the root path.
export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH || '/',
  plugins: [
    // npm run dev:lan (mode "lan") serves a self-signed HTTPS certificate so tablets on the Wi-Fi can
    // log in: PIN hashing (crypto.subtle), Bluetooth printing and offline mode need a secure context.
    ...(mode === 'lan' ? [basicSsl()] : []),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Kedai Rakdjat POS',
        short_name: 'Rakdjat POS',
        description: 'Kasir offline-first Kedai Rakdjat',
        theme_color: '#8a000a',
        background_color: '#f8f9fb',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.png', sizes: '1024x1024', type: 'image/png' },
        ],
      },
      workbox: {
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  server: { host: true },
}));
