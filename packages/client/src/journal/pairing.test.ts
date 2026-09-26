import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import type { Entry } from "./journal.ts";
import { freshJournal } from "./testing.ts";

/** A Workout whose Plan has one Entry, read back with its Performed Sets. */
async function plannedEntry(notation: string) {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-26"));
  await journal.setPlan(workout.id, notation);
  const read = async () => (await journal.getWorkout(workout.id))!.entries[0]!;
  const entry = await read();
  return { journal, workout, entry, read };
}

test("confirming a Planned Set records a Performed Set with its weight and reps, and no RPE or Comment", async () => {
  const { journal, entry, read } = await plannedEntry("bench press 80x5x3");

  await journal.confirmPlannedSet(entry.id);

  expect((await read()).performedSets.map(({ id: _, ...set }) => set)).toEqual([
    { weight: 80, reps: 5, rpe: null, comment: null },
  ]);
});

/** Each pair as [planned weight × reps, performed weight × reps], null where a side is missing. */
function pairsOf(entry: Entry) {
  return entry.pairs.map(({ planned, performed }) => [
    planned && [planned.weight, planned.reps],
    performed && [performed.weight, performed.reps],
  ]);
}

test("confirming pairs with the next unpaired Planned Set, and the rest wait unpaired", async () => {
  const { journal, entry, read } = await plannedEntry("bench press 80x5 70x8x2");

  await journal.confirmPlannedSet(entry.id);
  await journal.confirmPlannedSet(entry.id);

  expect(pairsOf(await read())).toEqual([
    [
      [80, 5],
      [80, 5],
    ],
    [
      [70, 8],
      [70, 8],
    ],
    [[70, 8], null],
  ]);
});

test("a Performed Set added without confirming pairs by order too", async () => {
  const { journal, entry, read } = await plannedEntry("bench press 80x5x2");

  await journal.confirmPlannedSet(entry.id);
  await journal.addPerformedSet(entry.id, { weight: 80, reps: 4 });

  expect(pairsOf(await read())).toEqual([
    [
      [80, 5],
      [80, 5],
    ],
    [
      [80, 5],
      [80, 4],
    ],
  ]);
});

test("editing a confirmed Performed Set never changes the Plan", async () => {
  const { journal, workout, entry, read } = await plannedEntry("bench press 80x5x2");
  const confirmed = await journal.confirmPlannedSet(entry.id);

  await journal.editPerformedSet(confirmed.id, { weight: 82.5, reps: 3 });

  expect(pairsOf(await read())[0]).toEqual([
    [80, 5],
    [82.5, 3],
  ]);
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("bench press 80x5x2");
});

test("Sets beyond the planned count have no pair, and then there is nothing left to confirm", async () => {
  const { journal, entry, read } = await plannedEntry("bench press 80x5");
  await journal.confirmPlannedSet(entry.id);

  await journal.addPerformedSet(entry.id, { weight: 60, reps: 10 });

  expect(pairsOf(await read())).toEqual([
    [
      [80, 5],
      [80, 5],
    ],
    [null, [60, 10]],
  ]);
  await expect(journal.confirmPlannedSet(entry.id)).rejects.toThrow();
});

test("an Entry without a Plan has only unpaired Performed Sets", async () => {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-26"));
  const entry = await journal.addEntry(workout.id, "pull-up");
  await journal.addPerformedSet(entry.id, { weight: null, reps: 8 });

  const [read] = (await journal.getWorkout(workout.id))!.entries;

  expect(pairsOf(read!)).toEqual([[null, [null, 8]]]);
  await expect(journal.confirmPlannedSet(entry.id)).rejects.toThrow();
});

test("deleting a confirmed Set leaves a Planned Set unpaired again, since pairing is by order", async () => {
  const { journal, entry, read } = await plannedEntry("bench press 80x5 70x8");
  const first = await journal.confirmPlannedSet(entry.id);
  await journal.confirmPlannedSet(entry.id);

  await journal.deletePerformedSet(first.id);

  expect(pairsOf(await read())).toEqual([
    [
      [80, 5],
      [70, 8],
    ],
    [[70, 8], null],
  ]);
});
