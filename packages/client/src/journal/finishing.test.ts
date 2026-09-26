import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import type { WorkoutWithEntries } from "./journal.ts";
import { freshJournal } from "./testing.ts";

async function journalWithWorkout() {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-26"));
  return { journal, workout };
}

test("a new Workout isn't Finished; once Finished, it reads as Finished in the list and on its own", async () => {
  const { journal, workout } = await journalWithWorkout();
  const other = await journal.createWorkout(localDate("2026-09-25"));
  const before = (await journal.getWorkout(workout.id))!.finished;

  await journal.finishWorkout(workout.id);

  expect(before).toBe(false);
  expect((await journal.getWorkout(workout.id))!.finished).toBe(true);
  expect((await journal.listWorkouts()).map((w) => [w.id, w.finished])).toEqual([
    [workout.id, true],
    [other.id, false],
  ]);
});

/** A Finished Workout with a Plan, one confirmed Set and an Entry added on the fly. */
async function finishedWorkout() {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "bench press 80x5x2");
  const planned = (await journal.getWorkout(workout.id))!.entries[0]!;
  const confirmed = await journal.confirmPlannedSet(planned.id);
  const onTheFly = await journal.addEntry(workout.id, "plank");
  await journal.addPerformedSet(onTheFly.id, { weight: null, reps: 60 });
  await journal.finishWorkout(workout.id);
  return { journal, workout, planned, confirmed, onTheFly };
}

type Finished = Awaited<ReturnType<typeof finishedWorkout>>;

test.each<[string, (f: Finished) => Promise<unknown>]>([
  ["changing its date", (f) => f.journal.changeWorkoutDate(f.workout.id, localDate("2026-09-27"))],
  ["deleting it", (f) => f.journal.deleteWorkout(f.workout.id)],
  ["finishing it again", (f) => f.journal.finishWorkout(f.workout.id)],
  ["setting the Plan", (f) => f.journal.setPlan(f.workout.id, "squat 100x5x3")],
  ["adding an Entry", (f) => f.journal.addEntry(f.workout.id, "squat")],
  ["deleting an Entry", (f) => f.journal.deleteEntry(f.onTheFly.id)],
  ["adding a Performed Set", (f) => f.journal.addPerformedSet(f.planned.id, { weight: 80, reps: 5 })],
  ["confirming a Planned Set", (f) => f.journal.confirmPlannedSet(f.planned.id)],
  ["editing a Performed Set", (f) => f.journal.editPerformedSet(f.confirmed.id, { weight: 82.5, reps: 5 })],
  ["deleting a Performed Set", (f) => f.journal.deletePerformedSet(f.confirmed.id)],
  ["setting RPE", (f) => f.journal.setRpe(f.confirmed.id, 8)],
  ["setting a Comment", (f) => f.journal.setComment(f.confirmed.id, "легко")],
])("a Finished Workout is read-only: %s is refused and changes nothing", async (_, operation) => {
  const finished = await finishedWorkout();
  const { journal, workout } = finished;
  const before = [await journal.getWorkout(workout.id), await journal.listWorkouts()];

  await expect(operation(finished)).rejects.toThrow();

  expect([await journal.getWorkout(workout.id), await journal.listWorkouts()]).toEqual(before);
});

test("undoing finishing makes the Workout changeable again, in the list and on its own", async () => {
  const { journal, workout, planned } = await finishedWorkout();

  await journal.undoFinishing(workout.id);
  await journal.confirmPlannedSet(planned.id);

  const read = (await journal.getWorkout(workout.id))!;
  expect([read.finished, read.entries[0]!.performedSets.length]).toEqual([false, 2]);
  expect((await journal.listWorkouts())[0]!.finished).toBe(false);
});

test("finishing can't be undone on a Workout that isn't Finished", async () => {
  const { journal, workout } = await journalWithWorkout();

  await expect(journal.undoFinishing(workout.id)).rejects.toThrow();
  expect((await journal.getWorkout(workout.id))!.finished).toBe(false);
});

/** Per Entry, whether each of its pairs is Not performed. */
function notPerformedOf(workout: WorkoutWithEntries) {
  return workout.entries.map((entry) => [entry.exercise.primaryName, entry.pairs.map((pair) => pair.notPerformed)]);
}

test("in a Finished Workout, Planned Sets with no paired Performed Set are Not performed", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "squat 100x5x2\nbench press 80x5x3\npull-up x8x2");
  const [squat, bench] = (await journal.getWorkout(workout.id))!.entries;
  await journal.confirmPlannedSet(squat!.id);
  await journal.confirmPlannedSet(squat!.id);
  await journal.confirmPlannedSet(bench!.id);
  await journal.addPerformedSet(bench!.id, { weight: 80, reps: 3 });
  const plank = await journal.addEntry(workout.id, "plank");
  await journal.addPerformedSet(plank.id, { weight: null, reps: 60 });

  await journal.finishWorkout(workout.id);

  expect(notPerformedOf((await journal.getWorkout(workout.id))!)).toEqual([
    ["squat", [false, false]],
    ["bench press", [false, false, true]],
    ["pull-up", [true, true]],
    ["plank", [false]],
  ]);
});

test("before finishing, nothing is Not performed", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "squat 100x5x2");

  expect(notPerformedOf((await journal.getWorkout(workout.id))!)).toEqual([["squat", [false, false]]]);
});

test("undoing finishing clears Not performed; recording the rest and finishing again leaves nothing Not performed", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "squat 100x5\nbench press 80x5");
  const [squat, bench] = (await journal.getWorkout(workout.id))!.entries;
  await journal.confirmPlannedSet(squat!.id);
  await journal.finishWorkout(workout.id);

  await journal.undoFinishing(workout.id);
  const undone = notPerformedOf((await journal.getWorkout(workout.id))!);
  await journal.confirmPlannedSet(bench!.id);
  await journal.finishWorkout(workout.id);

  expect(undone).toEqual([
    ["squat", [false]],
    ["bench press", [false]],
  ]);
  expect(notPerformedOf((await journal.getWorkout(workout.id))!)).toEqual([
    ["squat", [false]],
    ["bench press", [false]],
  ]);
});

test("finishing a Workout with a Plan and no Performed Sets makes all its Sets Not performed, and the Plan read-only", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "squat 100x5x2\nbench press 80x5");

  await journal.finishWorkout(workout.id);

  expect(notPerformedOf((await journal.getWorkout(workout.id))!)).toEqual([
    ["squat", [true, true]],
    ["bench press", [true]],
  ]);
  await expect(journal.setPlan(workout.id, "deadlift 140x5")).rejects.toThrow();
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("squat 100x5x2\nbench press 80x5");
});
