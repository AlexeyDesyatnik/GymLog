import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { startTestServer } from "./testing/devices.ts";

test("a Merge of the Exercise two devices each made before they synced reaches both, as one Exercise with its history", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signUp("alexey");
  await computer.signIn("alexey");
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
  const paused = async (device: typeof phone) =>
    (await device.journal.listExercises()).filter((e) => e.primaryName === "paused bench press");
  const [kept, merged] = await paused(phone);

  await phone.journal.mergeExercises(merged!.id, kept!.id);
  await phone.journal.sync.now();
  await computer.journal.sync.now();

  expect(await paused(computer)).toEqual([
    { id: kept!.id, primaryName: "paused bench press", alternativeNames: [], workoutCount: 2 },
  ]);
  for (const workout of workouts) {
    const entries = (await computer.journal.getWorkout(workout.id))!.entries;
    expect(entries.map((e) => e.exercise)).toEqual([{ id: kept!.id, primaryName: "paused bench press" }]);
  }
});

test("an Entry recorded offline of an Exercise merged meanwhile on another device ends up on the Exercise it was merged into", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signUp("alexey");
  await computer.signIn("alexey");
  const first = await phone.journal.createWorkout(localDate("2026-09-21"));
  await phone.journal.setPlan(first.id, "bench 80x5");
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  const exercises = await computer.journal.listExercises();
  const bench = exercises.find((e) => e.primaryName === "bench")!;
  const benchPress = exercises.find((e) => e.primaryName === "Bench press")!;

  phone.goOffline();
  const second = await phone.journal.createWorkout(localDate("2026-09-24"));
  await phone.journal.setPlan(second.id, "bench 82.5x5");
  await computer.journal.mergeExercises(bench.id, benchPress.id);
  await computer.journal.sync.now();
  phone.goOnline();
  await phone.journal.sync.now();
  await computer.journal.sync.now();

  for (const device of [phone, computer]) {
    const entries = (await device.journal.getWorkout(second.id))!.entries;
    expect(entries.map((e) => e.exercise)).toEqual([{ id: benchPress.id, primaryName: "Bench press" }]);
    const catalog = await device.journal.listExercises();
    expect(catalog.find((e) => e.id === benchPress.id)).toMatchObject({ workoutCount: 2 });
    expect(catalog.map((e) => e.primaryName)).not.toContain("bench");
  }
});
