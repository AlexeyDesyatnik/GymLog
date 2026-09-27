import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The GymLog server run by `npm run dev`, or the end-to-end run's own one on SERVER_PORT; the
 * app reaches it through Vite, as one site.
 */
const api = { "/api": `http://127.0.0.1:${process.env.SERVER_PORT ?? 3000}` };

export default defineConfig({
  plugins: [react()],
  // Listen on the local network so the app can be opened from a phone on the same Wi-Fi.
  // A free port picked by the preview tool, when another dev server holds the default one.
  server: { host: true, port: process.env.PORT ? Number(process.env.PORT) : undefined, proxy: api },
  preview: { host: true, proxy: api },
});
