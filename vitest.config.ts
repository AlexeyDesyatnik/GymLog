import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // The Journal module (seam 1) and the shared code, on an in-memory IndexedDB.
        test: {
          name: "client",
          include: ["packages/client/src/**/*.test.ts", "packages/shared/src/**/*.test.ts"],
          setupFiles: ["fake-indexeddb/auto"],
        },
      },
      {
        // Sync end to end (seam 2): Journals, the real server and a real PostgreSQL in Docker.
        test: {
          name: "sync",
          include: ["packages/server/src/**/*.test.ts"],
          setupFiles: ["fake-indexeddb/auto"],
          globalSetup: ["packages/server/src/testing/postgres.ts"],
          // Starting PostgreSQL the first time may pull its image.
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
