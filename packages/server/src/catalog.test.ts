import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { pushAs, startTestServer, userIdOf, type Device } from "./testing/devices.ts";

/** The user's phone and computer, both signed in and synced, then both offline. */
async function phoneAndComputerOffline() {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signUp("alexey");
  await computer.signIn("alexey");
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  phone.goOffline();
  computer.goOffline();
  return { server, phone, computer };
}

/** Both devices back online and synced, each hearing the other's changes. */
async function bothSynced(phone: Device, computer: Device) {
  phone.goOnline();
  computer.goOnline();
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  await phone.journal.sync.now();
}

test("an Exercise two devices each made of one name before they synced becomes one, with both Workouts' Entries", async () => {
  const { phone, computer } = await phoneAndComputerOffline();
  const workouts = [];
  for (const [device, date] of [
    [phone, "2026-09-21"],
    [computer, "2026-09-24"],
  ] as const) {
    const workout = await device.journal.createWorkout(localDate(date));
    await device.journal.setPlan(workout.id, "paused bench press 70x5x3");
    workouts.push(workout);
  }

  await bothSynced(phone, computer);

  for (const device of [phone, computer]) {
    const paused = await device.journal.listExercises("paused bench press");
    expect(paused).toEqual([expect.objectContaining({ primaryName: "paused bench press", workoutCount: 2 })]);
    for (const workout of workouts) {
      const entries = (await device.journal.getWorkout(workout.id))!.entries;
      expect(entries.map((e) => e.exercise)).toEqual([{ id: paused[0]!.id, primaryName: "paused bench press" }]);
    }
  }
  const [onPhone] = await phone.journal.listExercises("paused bench press");
  const [onComputer] = await computer.journal.listExercises("paused bench press");
  expect(onPhone!.id).toBe(onComputer!.id);
});

test("Exercises of one name already in the catalog become one, the same one on each device", async () => {
  const server = await startTestServer();
  // A device on a version of the app that kept such Exercises apart, and synced them as they were.
  const olderApp = server.device();
  await olderApp.signUp("alexey");
  olderApp.journal.close();
  const ownerId = await userIdOf(olderApp, server.url);
  const ids = ["3", "1", "2"].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  const [highest, lowest, middle] = ids;
  const record = { ownerId, updatedAt: 5_000, deleted: false };
  await pushAs(olderApp, server.url, [
    { ...record, type: "exercise", id: highest, primaryName: "ring dips", alternativeNames: [], nameKeys: ["ring dips"] },
    { ...record, type: "exercise", id: lowest, primaryName: "Ring dips", alternativeNames: [], nameKeys: ["ring dips"] },
    {
      ...record,
      type: "exercise",
      id: middle,
      primaryName: "отжимания на кольцах",
      alternativeNames: ["ring dips"],
      nameKeys: ["отжимания на кольцах", "ring dips"],
    },
    ...ids.flatMap((exerciseId, i) => {
      const workoutId = crypto.randomUUID();
      return [
        { ...record, type: "workout", id: workoutId, date: `2026-09-2${i}`, createdAt: 5_000, finished: true },
        { ...record, type: "entry", id: crypto.randomUUID(), workoutId, exerciseId, position: 0 },
      ];
    }),
  ]);
  const phone = server.device();
  const computer = server.device();

  await Promise.all([phone.signIn("alexey"), computer.signIn("alexey")]);
  await phone.journal.sync.now();
  await computer.journal.sync.now();

  for (const device of [phone, computer]) {
    expect(await device.journal.listExercises("ring dips")).toEqual([
      { id: lowest, primaryName: "Ring dips", alternativeNames: ["отжимания на кольцах"], workoutCount: 3 },
    ]);
  }
});

test("a Merge of an Exercise made on another device reaches both, as one Exercise with its history", async () => {
  const { phone, computer } = await phoneAndComputerOffline();
  const workouts = [];
  for (const [device, date, plan] of [
    [phone, "2026-09-21", "paused bench press 70x5x3"],
    [computer, "2026-09-24", "paused bench 70x5x3"],
  ] as const) {
    const workout = await device.journal.createWorkout(localDate(date));
    await device.journal.setPlan(workout.id, plan);
    workouts.push(workout);
  }
  await bothSynced(phone, computer);
  const [paused, pausedPress] = await phone.journal.listExercises("paused");

  await phone.journal.mergeExercises(paused!.id, pausedPress!.id);
  await phone.journal.sync.now();
  await computer.journal.sync.now();

  expect(await computer.journal.listExercises("paused")).toEqual([
    { id: pausedPress!.id, primaryName: "paused bench press", alternativeNames: ["paused bench"], workoutCount: 2 },
  ]);
  for (const workout of workouts) {
    const entries = (await computer.journal.getWorkout(workout.id))!.entries;
    expect(entries.map((e) => e.exercise)).toEqual([{ id: pausedPress!.id, primaryName: "paused bench press" }]);
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
