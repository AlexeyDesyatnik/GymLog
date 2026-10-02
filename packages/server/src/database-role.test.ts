import { expect, onTestFinished, test } from "vitest";
import pg from "pg";
import { localDate } from "@gymlog/shared";
import { startTestServer } from "./testing/devices.ts";

/** Connects to a database as the server does; closed when the test ends. */
async function connect(databaseUrl: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

test("a database the server used as the superuser keeps its Users and Workouts once handed to the app's role, and sync goes on", async () => {
  const server = await startTestServer({ connectAs: "superuser" });
  const phone = server.device();
  await phone.signUp("alexey");
  const planned = await phone.journal.createWorkout(localDate("2026-09-28"));
  await phone.journal.setPlan(planned.id, "squat 100x5x3");
  await phone.journal.sync.now();

  await server.handDatabaseToApp();
  const computer = server.device();
  await computer.signIn("alexey");
  const added = await computer.journal.createWorkout(localDate("2026-09-30"));
  await computer.journal.sync.now();

  const laptop = server.device();
  await laptop.signIn("alexey");
  expect((await laptop.journal.getWorkout(planned.id))?.planNotation).toBe("squat 100x5x3");
  expect((await laptop.journal.listWorkouts()).map((w) => w.id).sort()).toEqual([planned.id, added.id].sort());
});

test("the server's database role can't run programs or read files on the database server", async () => {
  const server = await startTestServer();
  const database = await connect(server.databaseUrl);

  await expect(database.query("COPY (SELECT 1) TO PROGRAM 'true'")).rejects.toThrow(/permission denied/);
  await expect(database.query("SELECT pg_read_file('/etc/passwd')")).rejects.toThrow(/permission denied/);
});
