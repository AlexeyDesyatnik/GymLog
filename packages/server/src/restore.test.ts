import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { startTestServer, type Device } from "./testing/devices.ts";

/** The same user signed in on a phone and a computer, both synced. */
async function phoneAndComputer() {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signUp("alexey");
  await computer.signIn("alexey");
  return { server, phone, computer };
}

/** The dates of the Workouts on the device, in order. */
async function workoutDatesOn(device: Device) {
  return (await device.journal.listWorkouts()).map((w) => w.date).sort();
}

test("records both devices sent after the dump are on the server again after a restore, and each device gets the other's", async () => {
  const { server, phone, computer } = await phoneAndComputer();
  await phone.journal.createWorkout(localDate("2026-09-01"));
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  const dump = await server.dump();

  const onPhone = await phone.journal.createWorkout(localDate("2026-09-02"));
  await phone.journal.setPlan(onPhone.id, "squat 100x5x3");
  await phone.journal.sync.now();
  const onComputer = await computer.journal.createWorkout(localDate("2026-09-03"));
  await computer.journal.setPlan(onComputer.id, "zercher squat 80x5");
  await computer.journal.sync.now();
  await server.restore(dump);

  await phone.journal.sync.now();
  await computer.journal.sync.now();
  await phone.journal.sync.now();

  const laptop = server.device();
  await laptop.signIn("alexey");
  for (const device of [phone, computer, laptop]) {
    expect(await workoutDatesOn(device)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect((await device.journal.getWorkout(onPhone.id))?.planNotation).toBe("squat 100x5x3");
    expect((await device.journal.getWorkout(onComputer.id))?.planNotation).toBe("zercher squat 80x5");
  }
  expect(phone.journal.sync.state()).toEqual({ status: "synced", owner: false });
});

test("a record made after a restore reaches a device that had pulled records the restored server never got", async () => {
  const { server, phone, computer } = await phoneAndComputer();
  await computer.journal.createWorkout(localDate("2026-09-01"));
  await computer.journal.sync.now();
  await phone.journal.sync.now();
  const dump = await server.dump();
  // The Workout, its Exercises, Entries and Sets: the phone pulls them back and its cursor moves past them.
  const beforeRestore = await phone.journal.createWorkout(localDate("2026-09-02"));
  await phone.journal.setPlan(beforeRestore.id, "squat 100x5x3\nzercher squat 80x5x3");
  await phone.journal.sync.now();
  await server.restore(dump);

  await computer.journal.sync.now();
  await computer.journal.createWorkout(localDate("2026-09-03"));
  await computer.journal.sync.now();
  await phone.journal.sync.now();

  expect(await workoutDatesOn(phone)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("after a restore, a record deleted after the dump stays deleted, and of two changes made after it the later one stays, even when the earlier one is sent last", async () => {
  const { server, phone, computer } = await phoneAndComputer();
  const deleted = await phone.journal.createWorkout(localDate("2026-09-01"));
  const moved = await phone.journal.createWorkout(localDate("2026-09-05"));
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  const dump = await server.dump();
  await phone.journal.deleteWorkout(deleted.id);
  await phone.journal.changeWorkoutDate(moved.id, localDate("2026-09-06"));
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  await computer.journal.changeWorkoutDate(moved.id, localDate("2026-09-07"));
  await computer.journal.sync.now();
  await server.restore(dump);

  // The computer sends the later change first; the phone, which never saw it, then sends the earlier one.
  await computer.journal.sync.now();
  await phone.journal.sync.now();
  await computer.journal.sync.now();

  const laptop = server.device();
  await laptop.signIn("alexey");
  for (const device of [phone, computer, laptop]) {
    expect(await workoutDatesOn(device)).toEqual(["2026-09-07"]);
  }
});

test("without a restore, a device never sends again the records it has sent, a deploy of the server included", async () => {
  const { server, phone, computer } = await phoneAndComputer();
  const workout = await phone.journal.createWorkout(localDate("2026-09-01"));
  await phone.journal.setPlan(workout.id, "squat 100x5x3");
  await phone.journal.sync.now();
  const sent = phone.recordsPushed();

  await phone.journal.sync.now();
  await server.handDatabaseToApp();
  await phone.journal.sync.now();
  await phone.journal.sync.now();
  await computer.journal.sync.now();

  expect(phone.recordsPushed()).toBe(sent);
  expect((await computer.journal.getWorkout(workout.id))?.planNotation).toBe("squat 100x5x3");
});
