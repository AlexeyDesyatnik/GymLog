import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Listen on the local network so the app can be opened from a phone on the same Wi-Fi.
  // A free port picked by the preview tool, when another dev server holds the default one.
  server: { host: true, port: process.env.PORT ? Number(process.env.PORT) : undefined },
  preview: { host: true },
});
