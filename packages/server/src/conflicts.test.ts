import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { pullAs, pushAs, startTestServer, type Device } from "./testing/devices.ts";

/**
 * The same user on a phone and a computer, both holding a Workout of 27 September with an
 * Entry of squat recorded on the phone as one Performed Set of 100x5, then both taken offline.
 */
async function phoneAndComputerOffline() {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signIn("alexey");
  await computer.signIn("alexey");
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  const entry = await phone.journal.addEntry(workout.id, "squat");
  const set = await phone.journal.addPerformedSet(entry.id, { weight: 100, reps: 5 });
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  phone.goOffline();
  computer.goOffline();
  return { phone, computer, workout, entry, set };
}

/** Brings the devices online one by one in this order, each syncing, then syncs the first again to take the rest. */
async function bringOnlineInOrder(...devices: Device[]) {
  for (const device of devices) {
    device.goOnline();
    await device.journal.sync.now();
  }
  await devices[0]!.journal.sync.now();
}

/** Each device's Performed Sets of the Workout, as [weight, reps] per Entry. */
async function performedSetsOn(devices: Device[], workoutId: string) {
  return Promise.all(
    devices.map(async (device) =>
      (await device.journal.getWorkout(workoutId))?.entries.map((e) => e.performedSets.map((s) => [s.weight, s.reps])),
    ),
  );
}

test.each(["first", "last"] as const)(
  "when the same Set was changed on two devices, the later change wins on both, having reached the server %s",
  async (order) => {
    const { phone, computer, workout, set } = await phoneAndComputerOffline();
    phone.setClock(5_000);
    await phone.journal.editPerformedSet(set.id, { weight: 105, reps: 5 });
    computer.setClock(6_000);
    await computer.journal.editPerformedSet(set.id, { weight: 110, reps: 5 });

    await bringOnlineInOrder(...(order === "first" ? [computer, phone] : [phone, computer]));

    expect(await performedSetsOn([phone, computer], workout.id)).toEqual([[[[110, 5]]], [[[110, 5]]]]);
  },
);

test("when the same Set was changed on two devices at the same time, the change the server received first wins on both", async () => {
  const { phone, computer, workout, set } = await phoneAndComputerOffline();
  phone.setClock(5_000);
  await phone.journal.editPerformedSet(set.id, { weight: 105, reps: 5 });
  computer.setClock(5_000);
  await computer.journal.editPerformedSet(set.id, { weight: 110, reps: 5 });

  await bringOnlineInOrder(phone, computer);

  expect(await performedSetsOn([phone, computer], workout.id)).toEqual([[[[105, 5]]], [[[105, 5]]]]);
});

/** Whether each device still has the Workout, in its list and on its own. */
async function hasWorkoutOn(devices: Device[], workoutId: string) {
  return Promise.all(
    devices.map(async (device) => {
      const listed = (await device.journal.listWorkouts()).some((w) => w.id === workoutId);
      return listed || (await device.journal.getWorkout(workoutId)) !== undefined;
    }),
  );
}

test.each(["first", "last"] as const)(
  "a Workout deleted on one device and changed later on another stays deleted on both, the change having reached the server %s",
  async (order) => {
    const { phone, computer, workout } = await phoneAndComputerOffline();
    phone.setClock(5_000);
    await phone.journal.deleteWorkout(workout.id);
    computer.setClock(6_000);
    await computer.journal.changeWorkoutDate(workout.id, localDate("2026-09-28"));

    await bringOnlineInOrder(...(order === "first" ? [computer, phone] : [phone, computer]));

    expect(await hasWorkoutOn([phone, computer], workout.id)).toEqual([false, false]);
  },
);

test("a deleted Workout isn't brought back by its records sent again as they were before the delete", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signIn("alexey");
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.setPlan(workout.id, "squat 100x5x3");
  await phone.journal.sync.now();
  const { records: beforeTheDelete } = await pullAs(phone, server.url);
  await phone.journal.deleteWorkout(workout.id);
  await phone.journal.sync.now();

  const { answer } = await pushAs(phone, server.url, beforeTheDelete);
  const computer = server.device();
  await computer.signIn("alexey");

  expect(answer.refused).toEqual([]);
  expect(await hasWorkoutOn([computer], workout.id)).toEqual([false]);
});

test.each(["first", "last"] as const)(
  "a deleted Workout's Sets stay hidden on both devices after an edit to them on another, the edit having reached the server %s",
  async (order) => {
    const { phone, computer, workout, entry, set } = await phoneAndComputerOffline();
    phone.setClock(5_000);
    await phone.journal.deleteWorkout(workout.id);
    computer.setClock(6_000);
    await computer.journal.editPerformedSet(set.id, { weight: 110, reps: 5 });
    await computer.journal.addPerformedSet(entry.id, { weight: 100, reps: 5 });

    await bringOnlineInOrder(...(order === "first" ? [computer, phone] : [phone, computer]));

    expect(await hasWorkoutOn([phone, computer], workout.id)).toEqual([false, false]);
  },
);

test.each(["first", "last"] as const)(
  "a deleted Entry's Sets stay hidden on both devices after an edit to them on another, the edit having reached the server %s",
  async (order) => {
    const { phone, computer, workout, entry, set } = await phoneAndComputerOffline();
    phone.setClock(5_000);
    await phone.journal.deleteEntry(entry.id);
    computer.setClock(6_000);
    await computer.journal.editPerformedSet(set.id, { weight: 110, reps: 5 });
    await computer.journal.addPerformedSet(entry.id, { weight: 100, reps: 5 });

    await bringOnlineInOrder(...(order === "first" ? [computer, phone] : [phone, computer]));

    expect(await performedSetsOn([phone, computer], workout.id)).toEqual([[], []]);
  },
);

test("a Workout Finished on one device and undone on another is not Finished on both, even with the other's clock behind", async () => {
  const { phone, computer, workout } = await phoneAndComputerOffline();
  phone.goOnline();
  computer.goOnline();
  phone.setClock(10_000);
  computer.setClock(2_000);

  await phone.journal.finishWorkout(workout.id);
  await phone.journal.sync.now();
  await computer.journal.sync.now();
  await computer.journal.undoFinishing(workout.id);
  await computer.journal.sync.now();
  await phone.journal.sync.now();

  const finished = [phone, computer].map(async (device) => (await device.journal.getWorkout(workout.id))?.finished);
  expect(await Promise.all(finished)).toEqual([false, false]);
});
