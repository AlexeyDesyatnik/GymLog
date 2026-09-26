import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import type { Journal } from "./journal.ts";
import { freshJournal } from "./testing.ts";

/** A Workout planned with these lines. */
async function plannedWorkout(plan: string) {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-26"));
  await journal.setPlan(workout.id, plan);
  const entries = (await journal.getWorkout(workout.id))!.entries;
  return { journal, workout, entries };
}

/** Per Entry: its id, Exercise name, Planned Sets as [weight, reps] and Performed Sets as [weight, reps]. */
async function entriesOf(journal: Journal, workoutId: string) {
  return (await journal.getWorkout(workoutId))!.entries.map((e) => ({
    id: e.id,
    name: e.exercise.primaryName,
    planned: e.plannedSets.map((s) => [s.weight, s.reps]),
    performed: e.performedSets.map((s) => [s.weight, s.reps]),
  }));
}

test("a line matching a planned Entry of the same Exercise keeps the Entry and its Performed Sets, and replaces its Planned Sets", async () => {
  const { journal, workout, entries } = await plannedWorkout("squat 100x5x3");
  const squat = entries[0]!;
  await journal.confirmPlannedSet(squat.id);
  await journal.addPerformedSet(squat.id, { weight: 100, reps: 4 });

  await journal.setPlan(workout.id, "squat 110x5x2 90x8");

  expect(await entriesOf(journal, workout.id)).toEqual([
    {
      id: squat.id,
      name: "squat",
      planned: [
        [110, 5],
        [110, 5],
        [90, 8],
      ],
      performed: [
        [100, 5],
        [100, 4],
      ],
    },
  ]);
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("squat 110x5x2 90x8");
});

test("lines of the same Exercise match its planned Entries in order, whatever lines come between", async () => {
  const { journal, workout, entries } = await plannedWorkout("bench press 80x5\nsquat 100x5\nbench press 60x10");
  const [heavy, squat, light] = entries;
  await journal.confirmPlannedSet(light!.id);

  await journal.setPlan(workout.id, "squat 110x5\nbench press 85x5\ndeadlift 140x5\nbench press 65x10");

  expect((await entriesOf(journal, workout.id)).map((e) => [e.id, e.name, e.planned, e.performed])).toEqual([
    [squat!.id, "squat", [[110, 5]], []],
    [heavy!.id, "bench press", [[85, 5]], []],
    [expect.any(String), "deadlift", [[140, 5]], []],
    [light!.id, "bench press", [[65, 10]], [[60, 10]]],
  ]);
});

test("an Entry whose line is removed stays without Planned Sets if it has Performed Sets, and is removed if it has none", async () => {
  const { journal, workout, entries } = await plannedWorkout("squat 100x5x3\nbench press 80x5x3\npull-up x8x3");
  const [squat, bench] = entries;
  await journal.confirmPlannedSet(squat!.id);
  await journal.addPerformedSet(squat!.id, { weight: 100, reps: 4 });

  await journal.setPlan(workout.id, "bench press 80x5x3");

  expect((await entriesOf(journal, workout.id)).map((e) => [e.id, e.name, e.planned.length, e.performed])).toEqual([
    [bench!.id, "bench press", 3, []],
    [
      squat!.id,
      "squat",
      0,
      [
        [100, 5],
        [100, 4],
      ],
    ],
  ]);
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("bench press 80x5x3");
});

/** Per Entry: Exercise name, the Exercise it replaces and the Exercise replacing it. */
async function substitutionsOf(journal: Journal, workoutId: string) {
  return (await journal.getWorkout(workoutId))!.entries.map((e) => [
    e.exercise.primaryName,
    e.replaces?.primaryName ?? null,
    e.replacedBy?.primaryName ?? null,
  ]);
}

test("a Substitute of a matched Entry keeps replacing it, right after it, and stays out of the Plan notation", async () => {
  const { journal, workout, entries } = await plannedWorkout("bench press 80x5x3\nsquat 100x5x3");
  const substitute = await journal.substituteEntry(entries[0]!.id, "dumbbell press");
  await journal.addPerformedSet(substitute.id, { weight: 30, reps: 10 });

  await journal.setPlan(workout.id, "deadlift 140x5\nbench press 85x5x3\nsquat 100x5x3");

  expect(await substitutionsOf(journal, workout.id)).toEqual([
    ["deadlift", null, null],
    ["bench press", null, "dumbbell press"],
    ["dumbbell press", "bench press", null],
    ["squat", null, null],
  ]);
  const read = (await journal.getWorkout(workout.id))!;
  expect(read.entries[2]!.performedSets.map((s) => [s.weight, s.reps])).toEqual([[30, 10]]);
  expect(read.planNotation).toBe("deadlift 140x5\nbench press 85x5x3\nsquat 100x5x3");
});

test("a Substitute whose replaced Entry's line is removed becomes an ordinary Entry, after the Plan", async () => {
  const { journal, workout, entries } = await plannedWorkout("bench press 80x5x3\nsquat 100x5x3");
  const substitute = await journal.substituteEntry(entries[0]!.id, "dumbbell press");
  await journal.addPerformedSet(substitute.id, { weight: 30, reps: 10 });

  await journal.setPlan(workout.id, "squat 100x5x3");

  expect(await substitutionsOf(journal, workout.id)).toEqual([
    ["squat", null, null],
    ["dumbbell press", null, null],
  ]);
  const read = (await journal.getWorkout(workout.id))!;
  expect(read.entries[1]!.performedSets.map((s) => [s.weight, s.reps])).toEqual([[30, 10]]);
  expect(read.planNotation).toBe("squat 100x5x3");
  expect((await journal.listWorkouts())[0]!.exerciseNames).toEqual(["squat", "dumbbell press"]);
});

test("an Entry added on the fly never matches a line of its Exercise and stays after the Plan", async () => {
  const { journal, workout } = await plannedWorkout("squat 100x5x3");
  const plank = await journal.addEntry(workout.id, "plank");
  await journal.addPerformedSet(plank.id, { weight: null, reps: 60 });

  await journal.setPlan(workout.id, "squat 100x5x3\nplank x60x2");

  const read = await entriesOf(journal, workout.id);
  expect(read.map((e) => [e.name, e.planned.length, e.performed.length])).toEqual([
    ["squat", 3, 0],
    ["plank", 2, 0],
    ["plank", 0, 1],
  ]);
  expect(read[2]!.id).toBe(plank.id);
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("squat 100x5x3\nplank x60x2");
});

test("re-editing keeps each Performed Set whole, with its RPE and Comment, and the new Plan's Rep ranges and Target RPE", async () => {
  const { journal, workout, entries } = await plannedWorkout("bicep curl 15x12x3");
  const curl = entries[0]!;
  const done = await journal.confirmPlannedSet(curl.id);
  await journal.setRpe(done.id, 8);
  await journal.setComment(done.id, "elbow twinge");

  await journal.setPlan(workout.id, "bicep curl 12,5x10-12x2@8");

  const read = (await journal.getWorkout(workout.id))!.entries[0]!;
  expect(read.performedSets).toEqual([{ id: done.id, weight: 15, reps: 12, rpe: 8, comment: "elbow twinge" }]);
  expect(read.plannedSets.map((s) => [s.weight, s.reps, s.maxReps, s.targetRpe])).toEqual([
    [12.5, 10, 12, 8],
    [12.5, 10, 12, null],
  ]);
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("bicep curl 12,5x10-12x2@8");
});

test("Performed Sets pair by order with the new Planned Sets; those beyond them have no pair", async () => {
  const { journal, workout, entries } = await plannedWorkout("squat 100x5x3");
  const squat = entries[0]!;
  await journal.confirmPlannedSet(squat.id);
  await journal.confirmPlannedSet(squat.id);

  await journal.setPlan(workout.id, "squat 100x5");

  const pairs = (await journal.getWorkout(workout.id))!.entries[0]!.pairs;
  expect(pairs.map((p) => [p.planned?.reps ?? null, p.performed?.reps ?? null])).toEqual([
    [5, 5],
    [null, 5],
  ]);
});

test("a Finished Workout with recorded Sets refuses Plan edits and keeps its Plan", async () => {
  const { journal, workout, entries } = await plannedWorkout("squat 100x5x3");
  await journal.confirmPlannedSet(entries[0]!.id);
  await journal.finishWorkout(workout.id);

  await expect(journal.setPlan(workout.id, "squat 110x5x3")).rejects.toThrow();

  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("squat 100x5x3");
});
