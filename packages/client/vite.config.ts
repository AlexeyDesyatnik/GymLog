import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Listen on the local network so the app can be opened from a phone on the same Wi-Fi.
  server: { host: true },
  preview: { host: true },
});
