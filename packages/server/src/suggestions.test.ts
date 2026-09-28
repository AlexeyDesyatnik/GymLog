import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { startTestServer } from "./testing/devices.ts";

const TODAY = localDate("2026-09-28");

/**
 * The same user's phone and computer, each of which planned paused bench press while offline, so
 * each made an Exercise of that name before they synced.
 */
async function samePlanOnTwoDevicesOffline() {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signUp("alexey");
  await computer.signIn("alexey");
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  phone.goOffline();
  computer.goOffline();
  const workouts = [];
  for (const [device, date] of [
    [phone, "2026-09-21"],
    [computer, "2026-09-24"],
  ] as const) {
    const workout = await device.journal.createWorkout(localDate(date));
    await device.journal.setPlan(workout.id, "paused bench press 70x5x3");
    workouts.push(workout);
  }
  phone.goOnline();
  computer.goOnline();
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  await phone.journal.sync.now();
  return { phone, workouts };
}

test("an Exercise made on two devices before they synced is suggested once by its name", async () => {
  const { phone } = await samePlanOnTwoDevicesOffline();

  const suggested = await phone.journal.suggestExercises("paus", TODAY);

  expect(suggested.map((e) => e.primaryName)).toEqual(["paused bench press"]);
});

test("a Substitute is never suggested under the name of the Exercise it would replace", async () => {
  const { phone, workouts } = await samePlanOnTwoDevicesOffline();
  const [entry] = (await phone.journal.getWorkout(workouts[0]!.id))!.entries;

  const suggested = await phone.journal.suggestSubstitutes(entry!.id, "paus", TODAY);

  expect(suggested).toEqual([]);
});
