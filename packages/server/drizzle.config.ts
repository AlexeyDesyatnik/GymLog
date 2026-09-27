import { defineConfig } from "drizzle-kit";

/** `npm run db:generate -w @gymlog/server` writes a migration for each change to the schema. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
