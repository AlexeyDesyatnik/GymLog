import { expect, test } from "vitest";
import { localDate, RPE_BELOW_5 } from "@gymlog/shared";
import { freshJournal } from "./testing.ts";

async function journalWithWorkout() {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-24"));
  return { journal, workout };
}

test("adding an Entry with an unknown name creates the Exercise", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.addEntry(workout.id, "Bench Press");

  const detail = await journal.getWorkout(workout.id);
  expect(detail?.entries.map((e) => e.exercise.primaryName)).toEqual(["Bench Press"]);
});

test("Exercise names are unique ignoring case and spaces: a matching name reuses the Exercise in a new Entry", async () => {
  const { journal, workout } = await journalWithWorkout();

  const first = await journal.addEntry(workout.id, "bench press");
  const second = await journal.addEntry(workout.id, "  BENCH   Press ");

  expect(second.exercise).toEqual(first.exercise);
  expect(second.id).not.toBe(first.id);
});

test("an Exercise created in one Workout is found from another", async () => {
  const journal = freshJournal();
  const monday = await journal.createWorkout(localDate("2026-09-21"));
  const thursday = await journal.createWorkout(localDate("2026-09-24"));

  const created = await journal.addEntry(monday.id, "Жим лёжа");
  const found = await journal.addEntry(thursday.id, "жим ЛЁЖА");

  expect(found.exercise).toEqual({ id: created.exercise.id, primaryName: "Жим лёжа" });
});

test("Entries are listed in the order they were added", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.addEntry(workout.id, "squat");
  await journal.addEntry(workout.id, "bench press");
  await journal.addEntry(workout.id, "squat");

  const detail = await journal.getWorkout(workout.id);
  expect(detail?.entries.map((e) => e.exercise.primaryName)).toEqual(["squat", "bench press", "squat"]);
});

test("an Entry needs an Exercise name", async () => {
  const { journal, workout } = await journalWithWorkout();

  await expect(journal.addEntry(workout.id, "   ")).rejects.toThrow();
});

async function journalWithEntry() {
  const { journal, workout } = await journalWithWorkout();
  const entry = await journal.addEntry(workout.id, "bench press");
  const performedSets = async () => (await journal.getWorkout(workout.id))!.entries[0]!.performedSets;
  return { journal, workout, entry, performedSets };
}

test("Performed Sets are recorded in order, with no RPE or Comment", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();

  await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });
  await journal.addPerformedSet(entry.id, { weight: 82.5, reps: 4 });

  expect((await performedSets()).map(({ id: _, ...set }) => set)).toEqual([
    { weight: 80, reps: 5, rpe: null, comment: null },
    { weight: 82.5, reps: 4, rpe: null, comment: null },
  ]);
});

test("a bodyweight Set has no weight, and a Set may have 0 reps", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();

  await journal.addPerformedSet(entry.id, { weight: null, reps: 8 });
  await journal.addPerformedSet(entry.id, { weight: 100, reps: 0 });

  expect((await performedSets()).map((s) => [s.weight, s.reps])).toEqual([
    [null, 8],
    [100, 0],
  ]);
});

test.each([
  { weight: 80, reps: -1 },
  { weight: 80, reps: 2.5 },
  { weight: -5, reps: 5 },
  { weight: Number.NaN, reps: 5 },
])("a Performed Set with weight $weight and reps $reps is refused", async (values) => {
  const { journal, entry, performedSets } = await journalWithEntry();

  await expect(journal.addPerformedSet(entry.id, values)).rejects.toThrow();
  expect(await performedSets()).toEqual([]);
});

test("editing a Performed Set changes its weight and reps and keeps its place", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();
  const first = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });
  await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });

  await journal.editPerformedSet(first.id, { weight: 82.5, reps: 3 });

  expect((await performedSets()).map((s) => [s.weight, s.reps])).toEqual([
    [82.5, 3],
    [80, 5],
  ]);
});

test("an edit with invalid values is refused and leaves the Set unchanged", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();
  const set = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });

  await expect(journal.editPerformedSet(set.id, { weight: 80, reps: -2 })).rejects.toThrow();
  expect((await performedSets()).map((s) => [s.weight, s.reps])).toEqual([[80, 5]]);
});

test("RPE can be set on a Performed Set and cleared again", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();
  const set = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });

  await journal.setRpe(set.id, 8.5);
  const withRpe = (await performedSets())[0]!.rpe;
  await journal.setRpe(set.id, null);

  expect([withRpe, (await performedSets())[0]!.rpe]).toEqual([8.5, null]);
});

test.each([5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10])("RPE %s is on the scale and accepted", async (rpe) => {
  const { journal, entry, performedSets } = await journalWithEntry();
  const set = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });

  await journal.setRpe(set.id, rpe);

  expect((await performedSets())[0]!.rpe).toBe(rpe);
});

test("RPE below 5 is accepted and reads back as below 5", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();
  const set = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });

  await journal.setRpe(set.id, RPE_BELOW_5);

  expect((await performedSets())[0]!.rpe).toBe(RPE_BELOW_5);
});

test.each([1, 3, 4.5, 5.5, 6.5, 10.5, 0.5, 7.3, Number.NaN])("RPE %s is off the scale and refused", async (rpe) => {
  const { journal, entry, performedSets } = await journalWithEntry();
  const set = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });

  await expect(journal.setRpe(set.id, rpe)).rejects.toThrow();
  expect((await performedSets())[0]!.rpe).toBeNull();
});

test("a Comment can be set on a Performed Set, and blank text clears it", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();
  const set = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });

  await journal.setComment(set.id, "  кольнуло в плече ");
  const withComment = (await performedSets())[0]!.comment;
  await journal.setComment(set.id, "   ");

  expect([withComment, (await performedSets())[0]!.comment]).toEqual(["кольнуло в плече", null]);
});

test("only the last Performed Set of an Entry can be deleted, so the Sets before it never re-pair", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();
  await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });
  const middle = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });
  await journal.addPerformedSet(entry.id, { weight: 70, reps: 8 });

  await expect(journal.deletePerformedSet(middle.id)).rejects.toThrow();
  expect(await performedSets()).toHaveLength(3);
});

test("once the last Performed Set is deleted, the one before it is last and can be deleted too", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();
  await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });
  const second = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });
  const third = await journal.addPerformedSet(entry.id, { weight: 70, reps: 8 });

  await journal.deletePerformedSet(third.id);
  await journal.deletePerformedSet(second.id);

  expect((await performedSets()).map((s) => [s.weight, s.reps])).toEqual([[80, 5]]);
});

test("a Planned Set can't be deleted on its own; editing the Plan notation changes it", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "bench press 80x5x2");
  const planned = (await journal.getWorkout(workout.id))!.entries[0]!.plannedSets[0]!;

  await expect(journal.deletePerformedSet(planned.id)).rejects.toThrow();
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("bench press 80x5x2");
});

test("deleting an Entry removes it with its Performed Sets, from the Workout and the list of Workouts", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.addEntry(workout.id, "squat");
  const typo = await journal.addEntry(workout.id, "bnech press");
  await journal.addPerformedSet(typo.id, { weight: 80, reps: 5 });

  await journal.deleteEntry(typo.id);

  expect((await journal.getWorkout(workout.id))!.entries.map((e) => e.exercise.primaryName)).toEqual(["squat"]);
  expect((await journal.listWorkouts())[0]!.exerciseNames).toEqual(["squat"]);
});

test("an Entry with Planned Sets can't be deleted; editing the Plan notation removes it", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "bench press 80x5x2");
  const planned = (await journal.getWorkout(workout.id))!.entries[0]!;

  await expect(journal.deleteEntry(planned.id)).rejects.toThrow();
  expect((await journal.getWorkout(workout.id))!.entries.map((e) => e.id)).toEqual([planned.id]);
});

test("nothing can be added to a deleted Workout", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.deleteWorkout(workout.id);

  await expect(journal.addEntry(workout.id, "squat")).rejects.toThrow();
  await expect(journal.setPlan(workout.id, "squat 100x5")).rejects.toThrow();
});

test("a deleted Entry and its Sets can't be recorded into or changed", async () => {
  const { journal, workout } = await journalWithWorkout();
  const typo = await journal.addEntry(workout.id, "bnech press");
  const set = await journal.addPerformedSet(typo.id, { weight: 80, reps: 5 });
  await journal.deleteEntry(typo.id);

  await expect(journal.addPerformedSet(typo.id, { weight: 80, reps: 5 })).rejects.toThrow();
  await expect(journal.editPerformedSet(set.id, { weight: 82.5, reps: 5 })).rejects.toThrow();
  await expect(journal.setComment(set.id, "опечатка")).rejects.toThrow();
});

test("a deleted Performed Set can't be edited or commented", async () => {
  const { journal, entry, performedSets } = await journalWithEntry();
  const set = await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });
  await journal.deletePerformedSet(set.id);

  await expect(journal.editPerformedSet(set.id, { weight: 82.5, reps: 5 })).rejects.toThrow();
  await expect(journal.setComment(set.id, "лишний")).rejects.toThrow();
  expect(await performedSets()).toEqual([]);
});

test("a Planned Set can't be edited or commented as if performed; editing the Plan notation changes it", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "bench press 80x5");
  const planned = (await journal.getWorkout(workout.id))!.entries[0]!.plannedSets[0]!;

  await expect(journal.editPerformedSet(planned.id, { weight: 90, reps: 5 })).rejects.toThrow();
  await expect(journal.setComment(planned.id, "тяжело")).rejects.toThrow();
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("bench press 80x5");
});
