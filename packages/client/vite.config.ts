import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The GymLog server run by `npm run dev`, or the end-to-end run's own one on SERVER_PORT; the
 * app reaches it through Vite, as one site.
 */
const api = { "/api": `http://127.0.0.1:${process.env.SERVER_PORT ?? 3000}` };

export default defineConfig({
  plugins: [
    react(),
    // An installable app that opens and records with no connection (ADR 0001): the service worker
    // keeps the whole app, and only /api goes to the network.
    VitePWA({
      // A new version installs in the background and waits until every copy of the app is closed:
      // it opens the next time the app is started. No prompt, and never a reload mid-Workout.
      registerType: "prompt",
      injectRegister: "script",
      // public/ is precached by globPatterns already.
      includeManifestIcons: false,
      manifest: {
        name: "GymLog",
        short_name: "GymLog",
        description: "Дневник силовых тренировок",
        lang: "ru",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // The light theme's ground (src/ui/styles.css), as in index.html.
        background_color: "#f3f4f1",
        theme_color: "#f3f4f1",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  // Listen on the local network so the app can be opened from a phone on the same Wi-Fi.
  // A free port picked by the preview tool, when another dev server holds the default one.
  server: { host: true, port: process.env.PORT ? Number(process.env.PORT) : undefined, proxy: api },
  preview: { host: true, proxy: api },
});
