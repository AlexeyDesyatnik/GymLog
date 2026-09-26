import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import type { Entry } from "./journal.ts";
import { freshJournal } from "./testing.ts";

async function journalWithWorkout() {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-26"));
  return { journal, workout };
}

test("a Rep range group plans its Sets for that range, and reads back with a hyphen", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "bicep curl 15x10-12x3");

  const read = (await journal.getWorkout(workout.id))!;
  expect(read.entries[0]!.plannedSets.map((s) => [s.weight, s.reps, s.maxReps])).toEqual([
    [15, 10, 12],
    [15, 10, 12],
    [15, 10, 12],
  ]);
  expect(read.planNotation).toBe("bicep curl 15x10-12x3");
});

test.each([
  ["bicep curl 15x10–12x3", "bicep curl 15x10-12x3"],
  ["bicep curl 15x10—12x3", "bicep curl 15x10-12x3"],
  ["bicep curl 15 x 10-12 x 3", "bicep curl 15x10-12x3"],
  ["bicep curl 15х10-12", "bicep curl 15x10-12"],
  ["squat 100x8-10x3@8", "squat 100x8-10x3@8"],
  ["pull-up x8-12x3", "pull-up x8-12x3"],
  ["bicep curl 15x10-12 15x10-12x2", "bicep curl 15x10-12x3"],
  ["bicep curl 15x10-12 15x10x2", "bicep curl 15x10-12 15x10x2"],
])("a Rep range typed as %j reads back as %j", async (typed, readBack) => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, typed);

  expect((await journal.getWorkout(workout.id))!.planNotation).toBe(readBack);
});

test.each(["bicep curl 15x12-10x3", "bicep curl 15x10-10x3"])(
  "%j has a Rep range that doesn't rise and isn't understood",
  async (line) => {
    const { journal, workout } = await journalWithWorkout();

    const [reading] = await journal.setPlan(workout.id, line);

    expect(reading).toEqual({ ok: false, problem: "bad-rep-range" });
    expect((await journal.getWorkout(workout.id))!.entries).toEqual([]);
  },
);

test("a Rep range from 0 isn't understood, like any Planned Set of 0 reps", async () => {
  const { journal, workout } = await journalWithWorkout();

  const [reading] = await journal.setPlan(workout.id, "bicep curl 15x0-12x3");

  expect(reading).toEqual({ ok: false, problem: "zero-reps-or-sets" });
});

/** A Workout whose Plan has one Entry, read back with its Sets. */
async function plannedEntry(notation: string) {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, notation);
  const read = async () => (await journal.getWorkout(workout.id))!.entries[0]!;
  return { journal, entry: await read(), read };
}

test("a Planned Set with a Rep range can't be Confirmed: the Reps done are recorded as a Performed Set", async () => {
  const { journal, entry, read } = await plannedEntry("bicep curl 15x10-12x3");

  await expect(journal.confirmPlannedSet(entry.id)).rejects.toThrow();
  await journal.addPerformedSet(entry.id, { weight: 15, reps: 11 });

  expect((await read()).performedSets.map((s) => [s.weight, s.reps])).toEqual([[15, 11]]);
});

/** The numbers the next Performed Set starts from, as [weight, reps]. */
async function nextSetValues(read: () => Promise<Entry>) {
  const { nextSet } = await read();
  return nextSet && [nextSet.weight, nextSet.reps];
}

test("the first Set of a Rep range group starts from the planned weight and no reps", async () => {
  const { read } = await plannedEntry("bicep curl 15x10-12x3");

  expect(await nextSetValues(read)).toEqual([15, null]);
});

test("a later Set of the same Rep range group starts from the reps of the Set before it", async () => {
  const { journal, entry, read } = await plannedEntry("bicep curl 15x10-12x3");

  await journal.addPerformedSet(entry.id, { weight: 15, reps: 11 });

  expect(await nextSetValues(read)).toEqual([15, 11]);
});

test("a changed weight carries into the rest of a Rep range group, with the reps of the Set before", async () => {
  const { journal, entry, read } = await plannedEntry("bicep curl 15x10-12x3");

  await journal.addPerformedSet(entry.id, { weight: 17.5, reps: 10 });

  expect(await nextSetValues(read)).toEqual([17.5, 10]);
});

test("the first Set of the next Rep range group starts from no reps again", async () => {
  const { journal, entry, read } = await plannedEntry("bicep curl 15x10-12 12,5x12-15");

  await journal.addPerformedSet(entry.id, { weight: 15, reps: 11 });

  expect(await nextSetValues(read)).toEqual([12.5, null]);
});

test("a Rep range group after a single-count group starts from no reps", async () => {
  const { journal, entry, read } = await plannedEntry("bicep curl 15x10 15x10-12");

  await journal.addPerformedSet(entry.id, { weight: 15, reps: 10 });

  expect(await nextSetValues(read)).toEqual([15, null]);
});

test("a Performed Set at the planned weight with Reps within the Rep range is done as planned", async () => {
  const { journal, entry, read } = await plannedEntry("bicep curl 15x10-12x4");

  await journal.addPerformedSet(entry.id, { weight: 15, reps: 10 });
  await journal.addPerformedSet(entry.id, { weight: 15, reps: 12 });
  await journal.addPerformedSet(entry.id, { weight: 15, reps: 9 });
  await journal.addPerformedSet(entry.id, { weight: 17.5, reps: 11 });

  expect((await read()).pairs.map((pair) => pair.asPlanned)).toEqual([true, true, false, false]);
});

test("with one planned count, only that count at the planned weight is done as planned", async () => {
  const { journal, entry, read } = await plannedEntry("bench press 80x5x3");

  await journal.confirmPlannedSet(entry.id);
  await journal.addPerformedSet(entry.id, { weight: 80, reps: 6 });

  expect((await read()).pairs.map((pair) => pair.asPlanned)).toEqual([true, false, false]);
});
