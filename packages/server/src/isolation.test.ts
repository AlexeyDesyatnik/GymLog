import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { pullAs, pushAs, startTestServer, userIdOf } from "./testing/devices.ts";

test("a user's records never reach another user's device", async () => {
  const server = await startTestServer();
  const alexeysPhone = server.device();
  await alexeysPhone.signUp("alexey");
  const workout = await alexeysPhone.journal.createWorkout(localDate("2026-09-27"));
  await alexeysPhone.journal.setPlan(workout.id, "squat 100x5x3");
  await alexeysPhone.journal.sync.now();

  const mariasPhone = server.device();
  await mariasPhone.signUp("maria");
  const mariasId = await userIdOf(mariasPhone, server.url);

  expect(await mariasPhone.journal.listWorkouts()).toEqual([]);
  // Only her own records, her Starter list among them.
  const pulled = await pullAs(mariasPhone, server.url);
  expect(pulled.status).toBe(200);
  expect(pulled.records.filter((r) => r.ownerId !== mariasId)).toEqual([]);
});

/** A Workout record as a device sends it. */
function workoutRecord(fields: { id: string; ownerId: string; date: string }) {
  return { type: "workout", updatedAt: 5_000, deleted: false, createdAt: 5_000, finished: false, ...fields };
}

test("a record sent as another user's is refused, and never reaches that user", async () => {
  const server = await startTestServer();
  const alexeysPhone = server.device();
  await alexeysPhone.signUp("alexey");
  const alexeysId = await userIdOf(alexeysPhone, server.url);
  const mariasPhone = server.device();
  await mariasPhone.signUp("maria");

  const id = crypto.randomUUID();
  const { answer } = await pushAs(mariasPhone, server.url, [
    workoutRecord({ id, ownerId: alexeysId, date: "2026-09-27" }),
  ]);
  await alexeysPhone.journal.sync.now();

  expect(answer.refused.map((r) => r.id)).toEqual([id]);
  expect(await alexeysPhone.journal.listWorkouts()).toEqual([]);
});

test("another user's record can't be changed by sending a record with its id", async () => {
  const server = await startTestServer();
  const alexeysPhone = server.device();
  await alexeysPhone.signUp("alexey");
  const workout = await alexeysPhone.journal.createWorkout(localDate("2026-09-27"));
  await alexeysPhone.journal.sync.now();
  const mariasPhone = server.device();
  await mariasPhone.signUp("maria");
  const mariasId = await userIdOf(mariasPhone, server.url);
  const { cursor } = await pullAs(mariasPhone, server.url);

  const { answer } = await pushAs(mariasPhone, server.url, [
    workoutRecord({ id: workout.id, ownerId: mariasId, date: "2026-01-01" }),
  ]);
  const alexeysComputer = server.device();
  await alexeysComputer.signIn("alexey");

  expect(answer.refused.map((r) => r.id)).toEqual([workout.id]);
  expect((await alexeysComputer.journal.getWorkout(workout.id))?.date).toBe("2026-09-27");
  expect((await pullAs(mariasPhone, server.url, cursor)).records).toEqual([]);
});

test("a device nobody is signed in on can neither read nor send records", async () => {
  const server = await startTestServer();
  const alexeysPhone = server.device();
  await alexeysPhone.signUp("alexey");
  await alexeysPhone.journal.createWorkout(localDate("2026-09-27"));
  await alexeysPhone.journal.sync.now();
  const alexeysId = await userIdOf(alexeysPhone, server.url);
  const stranger = server.device();

  const pushed = await pushAs(stranger, server.url, [
    workoutRecord({ id: crypto.randomUUID(), ownerId: alexeysId, date: "2026-01-01" }),
  ]);
  const pulled = await pullAs(stranger, server.url);
  const alexeysComputer = server.device();
  await alexeysComputer.signIn("alexey");

  expect([pushed.status, pulled.status]).toEqual([401, 401]);
  expect(pulled.records).toEqual([]);
  expect((await alexeysComputer.journal.listWorkouts()).map((w) => w.date)).toEqual(["2026-09-27"]);
});

test("a device holding one user's records never sends them as the records of another user signed in there", async () => {
  const server = await startTestServer();
  const sharedComputer = server.device();
  await sharedComputer.signUp("alexey");
  await sharedComputer.journal.createWorkout(localDate("2026-09-27"));

  await sharedComputer.signUp("maria");
  const mariasPhone = server.device();
  await mariasPhone.signIn("maria");

  expect(sharedComputer.journal.sync.state()).toEqual({ status: "otherUser" });
  expect(await mariasPhone.journal.listWorkouts()).toEqual([]);
});
