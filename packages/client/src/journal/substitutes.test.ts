import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import type { Journal, WorkoutWithEntries } from "./journal.ts";
import { freshJournal } from "./testing.ts";

/** A Workout planned as bench press then squat. */
async function plannedWorkout() {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-26"));
  await journal.setPlan(workout.id, "bench press 80x5x3\nsquat 100x5x3");
  const [bench, squat] = (await journal.getWorkout(workout.id))!.entries;
  return { journal, workout, bench: bench!, squat: squat! };
}

test("a Substitute of another Exercise comes right after the Entry it replaces and starts with no Sets", async () => {
  const { journal, workout, bench } = await plannedWorkout();

  const substitute = await journal.substituteEntry(bench.id, "dumbbell press");

  const read = (await journal.getWorkout(workout.id))!;
  expect(read.entries.map((e) => [e.exercise.primaryName, e.plannedSets.length, e.performedSets.length])).toEqual([
    ["bench press", 3, 0],
    ["dumbbell press", 0, 0],
    ["squat", 3, 0],
  ]);
  expect(read.entries[1]).toEqual(substitute);
  expect(read.entries[1]!.nextSet).toBeNull();
  expect([read.entries[0]!.replacedBy?.primaryName, read.entries[1]!.replaces?.primaryName]).toEqual([
    "dumbbell press",
    "bench press",
  ]);
});

type Planned = Awaited<ReturnType<typeof plannedWorkout>>;

test.each<[string, (p: Planned) => Promise<unknown>]>([
  [
    "an Entry with Performed Sets",
    async (p) => {
      await p.journal.confirmPlannedSet(p.bench.id);
      return p.journal.substituteEntry(p.bench.id, "dumbbell press");
    },
  ],
  [
    "an Entry added on the fly",
    async (p) => {
      const plank = await p.journal.addEntry(p.workout.id, "plank");
      return p.journal.substituteEntry(plank.id, "side plank");
    },
  ],
  [
    "a Substitute",
    async (p) => {
      const substitute = await p.journal.substituteEntry(p.bench.id, "dumbbell press");
      return p.journal.substituteEntry(substitute.id, "push-up");
    },
  ],
  [
    "an Entry already replaced",
    async (p) => {
      await p.journal.substituteEntry(p.bench.id, "dumbbell press");
      return p.journal.substituteEntry(p.bench.id, "push-up");
    },
  ],
  ["an Entry, by its own Exercise", (p) => p.journal.substituteEntry(p.bench.id, "Bench Press")],
])("substituting is refused for %s", async (_, substitute) => {
  const planned = await plannedWorkout();

  await expect(substitute(planned)).rejects.toThrow();
});

/** Per Entry, whether each of its pairs is replaced and whether it is Not performed. */
function statesOf(workout: WorkoutWithEntries) {
  return workout.entries.map((entry) => [
    entry.exercise.primaryName,
    entry.pairs.map((pair) => (pair.replaced ? "replaced" : pair.notPerformed ? "not performed" : "open")),
  ]);
}

test("the replaced Entry's Planned Sets are replaced before finishing, and stay replaced rather than Not performed once Finished", async () => {
  const { journal, workout, bench, squat } = await plannedWorkout();
  const substitute = await journal.substituteEntry(bench.id, "dumbbell press");
  await journal.addPerformedSet(substitute.id, { weight: 30, reps: 10 });
  await journal.confirmPlannedSet(squat.id);

  const before = statesOf((await journal.getWorkout(workout.id))!);
  await journal.finishWorkout(workout.id);

  expect(before).toEqual([
    ["bench press", ["replaced", "replaced", "replaced"]],
    ["dumbbell press", ["open"]],
    ["squat", ["open", "open", "open"]],
  ]);
  expect(statesOf((await journal.getWorkout(workout.id))!)).toEqual([
    ["bench press", ["replaced", "replaced", "replaced"]],
    ["dumbbell press", ["open"]],
    ["squat", ["open", "not performed", "not performed"]],
  ]);
});

test.each<[string, (journal: Journal, entryId: string) => Promise<unknown>]>([
  ["confirming a Planned Set", (journal, entryId) => journal.confirmPlannedSet(entryId)],
  ["adding a Performed Set", (journal, entryId) => journal.addPerformedSet(entryId, { weight: 80, reps: 5 })],
])("a replaced Entry takes no Sets: %s is refused", async (_, record) => {
  const { journal, workout, bench } = await plannedWorkout();
  await journal.substituteEntry(bench.id, "dumbbell press");
  const before = await journal.getWorkout(workout.id);

  await expect(record(journal, bench.id)).rejects.toThrow();

  expect(await journal.getWorkout(workout.id)).toEqual(before);
});

test("the Plan is unchanged by a Substitute and its Sets, and can't be edited while the Substitute stands", async () => {
  const { journal, workout, bench } = await plannedWorkout();
  const substitute = await journal.substituteEntry(bench.id, "dumbbell press");
  const withSubstitute = (await journal.getWorkout(workout.id))!;
  await journal.addPerformedSet(substitute.id, { weight: 30, reps: 10 });

  await expect(journal.setPlan(workout.id, "squat 100x5x3")).rejects.toThrow();

  expect([withSubstitute.planNotation, withSubstitute.planLocked]).toEqual(["bench press 80x5x3\nsquat 100x5x3", true]);
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("bench press 80x5x3\nsquat 100x5x3");
});

test("deleting the Substitute undoes the substitution: the Entry is no longer replaced and takes Sets again", async () => {
  const { journal, workout, bench } = await plannedWorkout();
  const substitute = await journal.substituteEntry(bench.id, "dumbbell press");

  await journal.deleteEntry(substitute.id);
  await journal.confirmPlannedSet(bench.id);

  const read = (await journal.getWorkout(workout.id))!;
  expect(read.entries.map((e) => e.exercise.primaryName)).toEqual(["bench press", "squat"]);
  expect(read.entries[0]!.replacedBy).toBeNull();
  expect(statesOf(read)[0]).toEqual(["bench press", ["open", "open", "open"]]);
  expect(read.entries[0]!.performedSets.length).toBe(1);
});

test("in the list of Workouts, a replaced Entry's Exercise gives way to its Substitute's", async () => {
  const { journal, bench } = await plannedWorkout();

  await journal.substituteEntry(bench.id, "dumbbell press");

  expect((await journal.listWorkouts())[0]!.exerciseNames).toEqual(["dumbbell press", "squat"]);
});

/** Plans bench press on this date and replaces it with a Substitute of this name. */
async function substituteBenchPress(journal: Journal, date: string, substituteName: string) {
  const workout = await journal.createWorkout(localDate(date));
  await journal.setPlan(workout.id, "bench press 80x5x3");
  const bench = (await journal.getWorkout(workout.id))!.entries[0]!;
  await journal.substituteEntry(bench.id, substituteName);
  return workout;
}

test("Exercises used before as a Substitute for this Exercise are suggested first, most recently used first", async () => {
  const journal = freshJournal();
  await substituteBenchPress(journal, "2026-09-14", "dumbbell press");
  await substituteBenchPress(journal, "2026-09-17", "push-up");
  const deleted = await substituteBenchPress(journal, "2026-09-19", "machine press");
  await journal.deleteWorkout(deleted.id);
  const legDay = await journal.createWorkout(localDate("2026-09-20"));
  await journal.setPlan(legDay.id, "squat 100x5x3");
  await journal.substituteEntry((await journal.getWorkout(legDay.id))!.entries[0]!.id, "leg press");
  const today = await journal.createWorkout(localDate("2026-09-26"));
  await journal.setPlan(today.id, "bench press 80x5x3");
  const bench = (await journal.getWorkout(today.id))!.entries[0]!;

  const suggested = (await journal.suggestSubstitutes(bench.id, "")).map((e) => e.primaryName);

  expect(suggested.slice(0, 2)).toEqual(["push-up", "dumbbell press"]);
  expect(new Set(suggested.slice(2))).toEqual(new Set(["machine press", "squat", "leg press"]));
});

test("Substitute suggestions match the typed text in any case, and never offer the Entry's own Exercise", async () => {
  const journal = freshJournal();
  await substituteBenchPress(journal, "2026-09-14", "Dumbbell Press");
  const workout = await journal.createWorkout(localDate("2026-09-26"));
  await journal.setPlan(workout.id, "bench press 80x5x3\nleg press 150x10x3\npush-up x15x3");
  const bench = (await journal.getWorkout(workout.id))!.entries[0]!;

  const suggested = await journal.suggestSubstitutes(bench.id, "PRESS");

  expect(suggested.map((e) => e.primaryName)).toEqual(["Dumbbell Press", "leg press"]);
});

test("only a planned Entry with no Performed Sets, not yet replaced, in a Workout not Finished can be substituted", async () => {
  const { journal, workout, bench, squat } = await plannedWorkout();
  const substitute = await journal.substituteEntry(squat.id, "leg press");
  await journal.addEntry(workout.id, "plank");
  const substitutable = async () =>
    (await journal.getWorkout(workout.id))!.entries.map((e) => [e.exercise.primaryName, e.substitutable]);

  const before = await substitutable();
  await journal.confirmPlannedSet(bench.id);
  const recorded = await substitutable();

  expect(before).toEqual([
    ["bench press", true],
    ["squat", false],
    ["leg press", false],
    ["plank", false],
  ]);
  expect(substitute.substitutable).toBe(false);
  expect(recorded[0]).toEqual(["bench press", false]);
});

test("no Entry of a Finished Workout can be substituted", async () => {
  const { journal, workout } = await plannedWorkout();

  await journal.finishWorkout(workout.id);

  expect((await journal.getWorkout(workout.id))!.entries.map((e) => e.substitutable)).toEqual([false, false]);
});
