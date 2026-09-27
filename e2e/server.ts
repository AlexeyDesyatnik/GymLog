import { spawn } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { POSTGRES_IMAGE } from "../packages/server/src/testing/postgres.ts";

/** Where the end-to-end run's server listens; the app's dev server passes /api on to it. */
export const E2E_SERVER_PORT = 4176;

/**
 * Starts a clean PostgreSQL and the real server on it, with the test sign-in, for the whole
 * run; returns what stops them.
 */
export default async function startServer(): Promise<() => Promise<void>> {
  const database = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const server = spawn(process.execPath, ["packages/server/src/main.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: database.getConnectionUri(),
      NODE_ENV: "development",
      GYMLOG_TEST_SIGN_IN: "1",
      SERVER_PORT: String(E2E_SERVER_PORT),
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    server.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("GymLog server at")) resolve();
    });
    server.on("exit", (code) => reject(new Error(`The server stopped before it started, with code ${code}`)));
  });
  return async () => {
    server.kill();
    await database.stop();
  };
}
