import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { HasHistoryRefusal, NameTakenRefusal, type Journal } from "./journal.ts";
import { freshJournal } from "./testing.ts";

/** A Workout on this date planned in this Plan notation. */
async function planned(journal: Journal, date: string, notation: string) {
  const workout = await journal.createWorkout(localDate(date));
  await journal.setPlan(workout.id, notation);
  return workout;
}

/** The Exercise catalog as Primary names, each with its Alternative names. */
async function catalog(journal: Journal) {
  return (await journal.listExercises()).map((e) => [e.primaryName, e.alternativeNames]);
}

test("the Exercise catalog lists every Exercise by Primary name, with its Alternative names and the number of Workouts using it", async () => {
  const journal = freshJournal();
  await planned(journal, "2026-09-21", "squat 100x5\nbench press 80x5");
  await planned(journal, "2026-09-24", "bench press 80x5\nбег 0x10");

  // Russian collation: Cyrillic names come before Latin ones.
  expect(await journal.listExercises()).toEqual([
    { id: expect.any(String), primaryName: "бег", alternativeNames: [], workoutCount: 1 },
    { id: expect.any(String), primaryName: "bench press", alternativeNames: [], workoutCount: 2 },
    { id: expect.any(String), primaryName: "squat", alternativeNames: [], workoutCount: 1 },
  ]);
});

/** The Exercise of this Primary name in the catalog. */
async function exerciseNamed(journal: Journal, primaryName: string) {
  const found = (await journal.listExercises()).find((e) => e.primaryName === primaryName);
  if (!found) throw new Error(`No Exercise named ${primaryName}`);
  return found;
}

/** The Primary names of the Workout's Entries. */
async function entryNames(journal: Journal, workoutId: string) {
  return (await journal.getWorkout(workoutId))!.entries.map((e) => e.exercise.primaryName);
}

test("renaming an Exercise changes its Primary name everywhere, and the old one stays as an Alternative name", async () => {
  const journal = freshJournal();
  const workout = await planned(journal, "2026-09-21", "bnech press 80x5");
  const { id } = await exerciseNamed(journal, "bnech press");

  await journal.renameExercise(id, "bench press");

  expect(await catalog(journal)).toEqual([["bench press", ["bnech press"]]]);
  expect(await entryNames(journal, workout.id)).toEqual(["bench press"]);
  expect((await journal.listWorkouts())[0]!.exerciseNames).toEqual(["bench press"]);
  const added = await journal.addEntry(workout.id, "BNECH PRESS");
  expect(added.exercise).toEqual({ id, primaryName: "bench press" });
});

test("renaming an Exercise to one of its Alternative names swaps the two", async () => {
  const journal = freshJournal();
  await planned(journal, "2026-09-21", "bench press 80x5");
  const { id } = await exerciseNamed(journal, "bench press");
  await journal.renameExercise(id, "жим лёжа");

  await journal.renameExercise(id, "Bench Press");

  expect(await catalog(journal)).toEqual([["Bench Press", ["жим лёжа"]]]);
});

test("giving an Exercise a name of another Exercise, in any case, is refused and changes nothing", async () => {
  const journal = freshJournal();
  await planned(journal, "2026-09-21", "bench press 80x5\nsquat 100x5");
  const bench = await exerciseNamed(journal, "bench press");
  await journal.renameExercise(bench.id, "жим лёжа");
  const squat = await exerciseNamed(journal, "squat");

  await expect(journal.renameExercise(squat.id, "Жим  Лёжа")).rejects.toThrow(NameTakenRefusal);
  await expect(journal.renameExercise(squat.id, " BENCH press")).rejects.toThrow(NameTakenRefusal);
  await expect(journal.addAlternativeName(squat.id, "Bench Press")).rejects.toThrow(NameTakenRefusal);

  expect(await catalog(journal)).toEqual([
    ["жим лёжа", ["bench press"]],
    ["squat", []],
  ]);
});

test("an Exercise is found by an Alternative name added to it, until the name is removed", async () => {
  const journal = freshJournal();
  const workout = await planned(journal, "2026-09-21", "bench press 80x5");
  const { id } = await exerciseNamed(journal, "bench press");

  await journal.addAlternativeName(id, " Жим лёжа ");
  await journal.addAlternativeName(id, "bench");
  expect(await catalog(journal)).toEqual([["bench press", ["Жим лёжа", "bench"]]]);
  expect((await journal.addEntry(workout.id, "жим ЛЁЖА")).exercise.id).toBe(id);
  expect((await journal.suggestExercises("жим", localDate("2026-09-28"))).map((e) => e.id)).toEqual([id]);

  await journal.removeAlternativeName(id, "жим лёжа");
  expect(await catalog(journal)).toEqual([["bench press", ["bench"]]]);
  expect((await journal.addEntry(workout.id, "жим лёжа")).exercise.primaryName).toBe("жим лёжа");
});

test("a Merge moves every Entry of the merged Exercise to the target, whose Primary name stays and which is found by all the names", async () => {
  const journal = freshJournal();
  const first = await planned(journal, "2026-09-21", "bench 80x5\nsquat 100x5");
  const second = await planned(journal, "2026-09-24", "Bench press 80x5");
  const target = await exerciseNamed(journal, "Bench press");
  await journal.addAlternativeName(target.id, "жим лёжа");
  const merged = await exerciseNamed(journal, "bench");
  await journal.addAlternativeName(merged.id, "benchpress");

  await journal.mergeExercises(merged.id, target.id);

  expect(await journal.listExercises()).toEqual([
    {
      id: target.id,
      primaryName: "Bench press",
      alternativeNames: ["жим лёжа", "bench", "benchpress"],
      workoutCount: 2,
    },
    { id: expect.any(String), primaryName: "squat", alternativeNames: [], workoutCount: 1 },
  ]);
  expect(await entryNames(journal, first.id)).toEqual(["Bench press", "squat"]);
  expect(await entryNames(journal, second.id)).toEqual(["Bench press"]);
  for (const name of ["bench", "BENCHPRESS", "Жим лёжа", "bench press"]) {
    expect((await journal.addEntry(second.id, name)).exercise.id).toBe(target.id);
  }
});

test("a Merge moves Entries of Finished Workouts too", async () => {
  const journal = freshJournal();
  const workout = await planned(journal, "2026-09-21", "bench 80x5");
  await journal.finishWorkout(workout.id);
  await planned(journal, "2026-09-24", "bench press 80x5");

  const merged = await exerciseNamed(journal, "bench");
  await journal.mergeExercises(merged.id, (await exerciseNamed(journal, "bench press")).id);

  expect(await entryNames(journal, workout.id)).toEqual(["bench press"]);
});

test("an Exercise with no history, its only Entry deleted, is deleted, and its names are free again", async () => {
  const journal = freshJournal();
  const workout = await planned(journal, "2026-09-21", "squat 100x5");
  // Added by mistake, then deleted.
  const entry = await journal.addEntry(workout.id, "bnech press");
  const typo = entry.exercise;
  await journal.addAlternativeName(typo.id, "bench");
  await journal.deleteEntry(entry.id);

  await journal.deleteExercise(typo.id);

  expect(await catalog(journal)).toEqual([["squat", []]]);
  expect(await journal.suggestExercises("b", localDate("2026-09-28"))).toEqual([]);
  expect((await journal.addEntry(workout.id, "bench")).exercise).not.toMatchObject({ id: typo.id });
});

test("an Exercise used only in deleted Workouts has no history and can be deleted", async () => {
  const journal = freshJournal();
  const workout = await planned(journal, "2026-09-21", "bench press 80x5");
  await journal.deleteWorkout(workout.id);

  await journal.deleteExercise((await exerciseNamed(journal, "bench press")).id);

  expect(await catalog(journal)).toEqual([]);
});

test("deleting an Exercise with history is refused, in a Finished Workout too, and changes nothing", async () => {
  const journal = freshJournal();
  const workout = await planned(journal, "2026-09-21", "bench press 80x5");
  await journal.finishWorkout(workout.id);
  const { id } = await exerciseNamed(journal, "bench press");

  await expect(journal.deleteExercise(id)).rejects.toThrow(HasHistoryRefusal);

  expect(await catalog(journal)).toEqual([["bench press", []]]);
  expect(await entryNames(journal, workout.id)).toEqual(["bench press"]);
});

test("an Exercise can't be merged into itself, nor given a blank name", async () => {
  const journal = freshJournal();
  await planned(journal, "2026-09-21", "bench press 80x5");
  const { id } = await exerciseNamed(journal, "bench press");

  await expect(journal.mergeExercises(id, id)).rejects.toThrow();
  await expect(journal.renameExercise(id, "  ")).rejects.toThrow();
  await expect(journal.addAlternativeName(id, "")).rejects.toThrow();

  expect(await catalog(journal)).toEqual([["bench press", []]]);
});

test("the Exercise catalog lists only the Exercises with a name in which the typed text starts a word, ignoring case", async () => {
  const journal = freshJournal();
  await planned(journal, "2026-09-21", "barbell row 60x8\nbench press 80x5\nclose-grip bench press 70x8");
  await journal.addAlternativeName((await exerciseNamed(journal, "barbell row")).id, "тяга штанги");

  const found = async (text: string) => (await journal.listExercises(text)).map((e) => e.primaryName);

  expect(await found("BENCH")).toEqual(["bench press", "close-grip bench press"]);
  expect(await found("штанги")).toEqual(["barbell row"]);
  expect(await found("ench")).toEqual([]);
});
