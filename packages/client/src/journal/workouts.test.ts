import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { openJournal } from "./journal.ts";
import { freshJournal, uniqueJournalName } from "./testing.ts";

test("a created Workout is listed with its date", async () => {
  const journal = freshJournal();

  await journal.createWorkout(localDate("2026-09-24"));

  const workouts = await journal.listWorkouts();
  expect(workouts.map((w) => w.date)).toEqual(["2026-09-24"]);
});

test("Workouts are listed newest date first", async () => {
  const journal = freshJournal();

  await journal.createWorkout(localDate("2026-09-20"));
  await journal.createWorkout(localDate("2026-09-24"));
  await journal.createWorkout(localDate("2026-09-22"));

  const workouts = await journal.listWorkouts();
  expect(workouts.map((w) => w.date)).toEqual(["2026-09-24", "2026-09-22", "2026-09-20"]);
});

test("several Workouts on one date are all listed, the later-created one first", async () => {
  const journal = freshJournal();

  const earlier = await journal.createWorkout(localDate("2026-09-24"));
  const previousDay = await journal.createWorkout(localDate("2026-09-23"));
  const later = await journal.createWorkout(localDate("2026-09-24"));

  const workouts = await journal.listWorkouts();
  expect(workouts.map((w) => w.id)).toEqual([later.id, earlier.id, previousDay.id]);
});

test("changing a Workout's date reschedules it", async () => {
  const journal = freshJournal();
  const moved = await journal.createWorkout(localDate("2026-09-20"));
  const other = await journal.createWorkout(localDate("2026-09-22"));

  await journal.changeWorkoutDate(moved.id, localDate("2026-09-25"));

  expect(await journal.listWorkouts()).toEqual([
    { id: moved.id, date: "2026-09-25", exerciseNames: [], finished: false },
    { id: other.id, date: "2026-09-22", exerciseNames: [], finished: false },
  ]);
});

test("a deleted Workout is no longer listed", async () => {
  const journal = freshJournal();
  const kept = await journal.createWorkout(localDate("2026-09-20"));
  const deleted = await journal.createWorkout(localDate("2026-09-22"));

  await journal.deleteWorkout(deleted.id);

  expect(await journal.listWorkouts()).toEqual([{ id: kept.id, date: "2026-09-20", exerciseNames: [], finished: false }]);
});

test("Workouts survive closing and reopening the Journal", async () => {
  const name = uniqueJournalName();
  const first = openJournal({ name });
  const kept = await first.createWorkout(localDate("2026-09-24"));
  const deleted = await first.createWorkout(localDate("2026-09-25"));
  await first.deleteWorkout(deleted.id);
  first.close();

  const reopened = openJournal({ name });

  expect(await reopened.listWorkouts()).toEqual([{ id: kept.id, date: "2026-09-24", exerciseNames: [], finished: false }]);
});

test("a listed Workout names the Exercises of its Plan, in Plan order", async () => {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-24"));

  await journal.setPlan(workout.id, "squat 100x5x3\nbench press 80x5x3\npull-up 0x8x3");

  const [listed] = await journal.listWorkouts();
  expect(listed!.exerciseNames).toEqual(["squat", "bench press", "pull-up"]);
});

test("an Exercise with several Entries is named once, where it first appears", async () => {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-24"));

  await journal.addEntry(workout.id, "bench press");
  await journal.addEntry(workout.id, "squat");
  await journal.addEntry(workout.id, "Bench Press");

  const [listed] = await journal.listWorkouts();
  expect(listed!.exerciseNames).toEqual(["bench press", "squat"]);
});

test("Exercises of a replaced Plan are no longer named", async () => {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-24"));
  await journal.setPlan(workout.id, "squat 100x5x3\nbench press 80x5x3");

  await journal.setPlan(workout.id, "deadlift 140x5x1\nbench press 80x5x3");

  const [listed] = await journal.listWorkouts();
  expect(listed!.exerciseNames).toEqual(["deadlift", "bench press"]);
});

test("each listed Workout names only its own Exercises, and one without Entries names none", async () => {
  const journal = freshJournal();
  const planned = await journal.createWorkout(localDate("2026-09-22"));
  await journal.setPlan(planned.id, "squat 100x5x3");
  const improvised = await journal.createWorkout(localDate("2026-09-23"));
  const entry = await journal.addEntry(improvised.id, "pull-up");
  await journal.addPerformedSet(entry.id, { weight: null, reps: 8 });
  await journal.addPerformedSet(entry.id, { weight: null, reps: 7 });
  const empty = await journal.createWorkout(localDate("2026-09-24"));

  const listed = await journal.listWorkouts();
  expect(listed.map((w) => [w.id, w.exerciseNames])).toEqual([
    [empty.id, []],
    [improvised.id, ["pull-up"]],
    [planned.id, ["squat"]],
  ]);
});

test("Exercises added outside the Plan are named after the planned ones", async () => {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-24"));
  await journal.addEntry(workout.id, "plank");

  await journal.setPlan(workout.id, "squat 100x5x3");

  const [listed] = await journal.listWorkouts();
  expect(listed!.exerciseNames).toEqual(["squat", "plank"]);
});
