import { expect, test, vi } from "vitest";
import { localDate } from "@gymlog/shared";
import { pullAs, startTestServer, type Device } from "./testing/devices.ts";

/** The same user signed in on a phone and a computer. */
async function phoneAndComputer() {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signIn("alexey");
  await computer.signIn("alexey");
  return { server, phone, computer };
}

/** Each Entry's Performed Sets of the Workout on the device, as [weight, reps]. */
async function performedSetsOn(device: Device, workoutId: string) {
  return (await device.journal.getWorkout(workoutId))?.entries.map((e) =>
    e.performedSets.map((s) => [s.weight, s.reps]),
  );
}

test("Sets recorded offline stay on the device when the app is closed, and reach the other device by themselves once the connection is back", async () => {
  const { phone, computer } = await phoneAndComputer();
  phone.goOffline();
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.setPlan(workout.id, "squat 100x5x3");
  const [squat] = (await phone.journal.getWorkout(workout.id))!.entries;
  await phone.journal.confirmPlannedSet(squat!.id);
  await phone.journal.confirmPlannedSet(squat!.id);
  await expect(phone.journal.sync.now()).rejects.toThrow("offline");

  const reopened = phone.reopen();
  expect(await performedSetsOn(reopened, workout.id)).toEqual([
    [
      [100, 5],
      [100, 5],
    ],
  ]);
  reopened.goOnline();

  // Sooner than the phone's periodic sync.
  await vi.waitFor(
    async () => {
      await computer.journal.sync.now();
      expect(await performedSetsOn(computer, workout.id)).toEqual([
        [
          [100, 5],
          [100, 5],
        ],
      ]);
    },
    { timeout: 3_000, interval: 100 },
  );
});

test("a push cut off midway by the connection dropping is sent again once it is back, and the other device gets each record once", async () => {
  const { server, phone, computer } = await phoneAndComputer();
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  // The Workout, the Exercise, the Entry and 300 Sets: more records than one request carries.
  await phone.journal.setPlan(workout.id, "squat 100x5x300");

  phone.dropConnectionMidPush();
  await expect(phone.journal.sync.now()).rejects.toThrow("the connection dropped");
  const beforeTheResend = await pullAs(computer, server.url);
  phone.goOnline();
  await phone.journal.sync.now();
  const afterTheResend = await pullAs(computer, server.url, beforeTheResend.cursor);

  // Part of the push reached the server before the connection dropped.
  expect(beforeTheResend.records.length).toBeGreaterThan(0);
  expect(beforeTheResend.records.length).toBeLessThan(303);
  // Sending that part again brings the other device only the rest, nothing twice.
  const ids = [...beforeTheResend.records, ...afterTheResend.records].map((r) => r.id);
  expect(ids).toHaveLength(303);
  expect(new Set(ids).size).toBe(303);
  await computer.journal.sync.now();
  const arrived = await computer.journal.getWorkout(workout.id);
  expect(arrived?.planNotation).toBe("squat 100x5x300");
});

test("a request left without an answer is given up, and the next sync sends the change", async () => {
  const { phone, computer } = await phoneAndComputer();
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));

  phone.stallNextRequest();
  await expect(phone.journal.sync.now()).rejects.toThrow("timeout");
  await phone.journal.sync.now();
  await computer.journal.sync.now();

  expect((await computer.journal.listWorkouts()).map((w) => w.id)).toEqual([workout.id]);
});

test("Sets recorded after the sign-in expired stay on the device, and reach the other device once the user signs in again", async () => {
  const { phone, computer } = await phoneAndComputer();
  phone.expireSession();
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  const entry = await phone.journal.addEntry(workout.id, "squat");
  await phone.journal.addPerformedSet(entry.id, { weight: 100, reps: 5 });
  await phone.journal.sync.now();
  expect(phone.journal.sync.state()).toEqual({ status: "signedOut" });
  expect(await performedSetsOn(phone, workout.id)).toEqual([[[100, 5]]]);

  await phone.signIn("alexey");
  await computer.journal.sync.now();

  expect(await performedSetsOn(computer, workout.id)).toEqual([[[100, 5]]]);
});
