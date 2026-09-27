import { expect, test, vi } from "vitest";
import { localDate } from "@gymlog/shared";
import { storeFromBeforeSync, uniqueJournalName } from "@gymlog/client/testing";
import { pullAs, pushAs, startTestServer, type Device } from "./testing/devices.ts";

test("a Workout planned on one device appears on the user's other device", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signIn("alexey");
  await computer.signIn("alexey");

  const workout = await computer.journal.createWorkout(localDate("2026-09-27"));
  await computer.journal.setPlan(workout.id, "squat 100x5x3\nbench press 80x5");
  await computer.journal.sync.now();
  await phone.journal.sync.now();

  const arrived = await phone.journal.getWorkout(workout.id);
  expect(arrived).toMatchObject({ date: "2026-09-27", finished: false, planNotation: "squat 100x5x3\nbench press 80x5" });
});

test("records made on a device before anyone signed in are sent as the records of the user who signs in there", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const workout = await phone.journal.createWorkout(localDate("2026-09-20"));
  const entry = await phone.journal.addEntry(workout.id, "pull-up");
  await phone.journal.addPerformedSet(entry.id, { weight: null, reps: 8 });
  await phone.journal.sync.now();
  expect(phone.journal.sync.state()).toEqual({ status: "signedOut" });

  await phone.signIn("alexey");
  const computer = server.device();
  await computer.signIn("alexey");

  const arrived = await computer.journal.getWorkout(workout.id);
  expect(arrived?.entries.map((e) => [e.exercise.primaryName, e.performedSets.map((s) => s.reps)])).toEqual([
    ["pull-up", [8]],
  ]);
});

test("records kept on a device from before sync existed are sent once a user signs in there", async () => {
  const server = await startTestServer();
  const store = uniqueJournalName();
  const workoutId = await storeFromBeforeSync(store);
  const phone = server.device(store);

  await phone.signIn("alexey");
  const computer = server.device();
  await computer.signIn("alexey");

  const arrived = await computer.journal.getWorkout(workoutId);
  expect(arrived).toMatchObject({ date: "2026-09-01", finished: false, planNotation: "squat 100x5" });
});

test("records sent again change nothing on the server", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signIn("alexey");
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.setPlan(workout.id, "squat 100x5x3");
  await phone.journal.sync.now();
  const { records, cursor } = await pullAs(phone, server.url);

  const { answer } = await pushAs(phone, server.url, records);

  expect(answer.refused).toEqual([]);
  expect((await pullAs(phone, server.url, cursor)).records).toEqual([]);
  expect((await pullAs(phone, server.url)).records).toHaveLength(records.length);
});

test("a change whose answer from the server was lost is sent again, and reaches the other device once", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signIn("alexey");
  await computer.signIn("alexey");
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  const entry = await phone.journal.addEntry(workout.id, "squat");
  await phone.journal.addPerformedSet(entry.id, { weight: 100, reps: 5 });

  await phone.journal.sync.now();
  phone.loseNextAnswer();
  await expect(phone.journal.sync.now()).rejects.toThrow("the answer was lost");
  await phone.journal.sync.now();
  await computer.journal.sync.now();

  expect((await computer.journal.listWorkouts()).map((w) => w.id)).toEqual([workout.id]);
  const arrived = await computer.journal.getWorkout(workout.id);
  expect(arrived?.entries.map((e) => e.performedSets.map((s) => [s.weight, s.reps]))).toEqual([[[100, 5]]]);
});

/** Syncs the device until the check passes, as its periodic sync would; fails if it doesn't within the time. */
function eventually(device: Device, check: () => Promise<void>, timeout: number): Promise<void> {
  return vi.waitFor(
    async () => {
      await device.journal.sync.now();
      await check();
    },
    { timeout, interval: 100 },
  );
}

test("a change is sent by itself shortly after it is made", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signIn("alexey");
  await computer.signIn("alexey");

  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));

  // Sooner than the phone's periodic sync.
  await eventually(computer, async () => expect((await computer.journal.listWorkouts()).map((w) => w.id)).toEqual([workout.id]), 3_000);
});

test("changes not sent when the app was closed are sent by themselves when it opens again", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signIn("alexey");
  await computer.signIn("alexey");
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));

  phone.reopen();

  await eventually(computer, async () => expect((await computer.journal.listWorkouts()).map((w) => w.id)).toEqual([workout.id]), 3_000);
});

test("a device hears when records from another device arrive, and only then", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signIn("alexey");
  await computer.signIn("alexey");
  let arrivals = 0;
  phone.journal.sync.onRecordsArrived(() => arrivals++);

  await computer.journal.createWorkout(localDate("2026-09-27"));
  await computer.journal.sync.now();
  await phone.journal.sync.now();
  await phone.journal.createWorkout(localDate("2026-09-28"));
  await phone.journal.sync.now();
  await phone.journal.sync.now();

  expect(arrivals).toBe(1);
});
