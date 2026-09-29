import { spawn } from "node:child_process";
import { createOwnerInvite, openDatabase } from "../packages/server/src/users.ts";
import { startTestPostgres } from "../packages/server/src/testing/postgres.ts";

/** Where the end-to-end run's server listens; the app's dev server passes /api on to it. */
export const E2E_SERVER_PORT = 4176;

/**
 * Starts a clean PostgreSQL and the real server on it for the whole run, and makes the owner's
 * first Invite as the server command does, for the tests' owner (see signIn.ts); returns what
 * stops them.
 */
export default async function startServer(): Promise<() => Promise<void>> {
  const postgres = await startTestPostgres();
  const server = spawn(process.execPath, ["packages/server/src/main.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: postgres.url,
      NODE_ENV: "development",
      SERVER_PORT: String(E2E_SERVER_PORT),
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    server.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("GymLog server at")) resolve();
    });
    server.on("exit", (code) => reject(new Error(`The server stopped before it started, with code ${code}`)));
  });
  const database = await openDatabase(postgres.url);
  process.env.GYMLOG_E2E_OWNER_INVITE = await createOwnerInvite(database.db);
  await database.close();
  return async () => {
    server.kill();
    await postgres.stop();
  };
}
