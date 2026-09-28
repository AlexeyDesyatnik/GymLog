import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import type { Journal } from "./journal.ts";
import { freshJournal } from "./testing.ts";

/** A Workout on this date planned in this Plan notation. */
async function planned(journal: Journal, date: string, notation: string) {
  const workout = await journal.createWorkout(localDate(date));
  await journal.setPlan(workout.id, notation);
  return (await journal.getWorkout(workout.id))!;
}

/** The numbers filled in for this Exercise in the Plan of a new Workout on this date. */
async function prefillOn(journal: Journal, exerciseId: string, date = "2026-09-28") {
  const workout = await journal.createWorkout(localDate(date));
  return journal.prefillNumbers(workout.id, exerciseId);
}

test("numbers come from the Planned Sets of the most recent Workout by date whose Plan has the Exercise, collapsed into groups", async () => {
  const journal = freshJournal();
  const first = await planned(journal, "2026-09-10", "bench press 80x5x3");
  await planned(journal, "2026-09-20", "bench press 85x5@8 85x5 85x5 70x10-12 70x10-12");
  // Recorded last, but dated before the Workout above.
  await planned(journal, "2026-09-15", "bench press 60x5");

  expect(await prefillOn(journal, first.entries[0]!.exercise.id)).toBe("85x5x3@8 70x10-12x2");
});

test("only Workouts before the one being planned count: not its own Plan, nor Workouts planned for after it", async () => {
  const journal = freshJournal();
  const lastTime = await planned(journal, "2026-09-21", "bench press 80x5x3");
  const benchId = lastTime.entries[0]!.exercise.id;
  const planning = await planned(journal, "2026-09-28", "bench press 85x5x3");
  await planned(journal, "2026-10-05", "bench press 90x5x3");

  expect(await journal.prefillNumbers(planning.id, benchId)).toBe("80x5x3");
});

test("only consecutive Planned Sets of the same weight and reps collapse, bodyweight ones too", async () => {
  const journal = freshJournal();
  const [dip, pullUp] = (await planned(journal, "2026-09-21", "dip 20x8 20x8 20x6 20x8\npull-up x8x3")).entries;

  expect(await prefillOn(journal, dip!.exercise.id)).toBe("20x8x2 20x6 20x8");
  expect(await prefillOn(journal, pullUp!.exercise.id)).toBe("x8x3");
});

/** A Workout on this date with an Entry of face pull added on the fly, and these Sets performed in it. */
async function performed(journal: Journal, date: string, sets: [number | null, number][]) {
  const workout = await journal.createWorkout(localDate(date));
  const entry = await journal.addEntry(workout.id, "face pull");
  const recorded = [];
  for (const [weight, reps] of sets) recorded.push(await journal.addPerformedSet(entry.id, { weight, reps }));
  return { entry, recorded };
}

test("for an Exercise never planned, numbers come from its most recent Performed Sets, collapsed, without RPE", async () => {
  const journal = freshJournal();
  const { entry } = await performed(journal, "2026-09-10", [[20, 15], [20, 15]]);
  const { recorded } = await performed(journal, "2026-09-20", [[25, 12], [25, 12], [25, 10], [22.5, 12]]);
  await journal.setRpe(recorded[0]!.id, 8);
  await journal.setComment(recorded[1]!.id, "left shoulder");
  // Recorded later, but dated before the Workout above.
  await performed(journal, "2026-09-15", [[15, 15]]);
  // Nothing performed yet.
  await performed(journal, "2026-09-25", []);

  expect(await prefillOn(journal, entry.exercise.id)).toBe("25x12x2 25x10 22,5x12");
});

test("a Plan that has the Exercise wins over Sets of it performed later outside a Plan, and deleted Workouts don't count", async () => {
  const journal = freshJournal();
  await planned(journal, "2026-09-10", "face pull 20x15x3");
  await performed(journal, "2026-09-20", [[25, 12]]);
  const deleted = await planned(journal, "2026-09-25", "face pull 30x10x3");
  await journal.deleteWorkout(deleted.id);

  expect(await prefillOn(journal, deleted.entries[0]!.exercise.id)).toBe("20x15x3");
});

test("nothing is filled in for an Exercise with no Sets planned or performed", async () => {
  const journal = freshJournal();
  const { entry } = await performed(journal, "2026-09-20", []);

  expect(await prefillOn(journal, entry.exercise.id)).toBeNull();
});

test("a Performed Set whose first repetition failed is left out, since a Plan can't hold no Reps", async () => {
  const journal = freshJournal();
  const { entry } = await performed(journal, "2026-09-20", [[40, 0], [30, 12], [30, 12]]);

  expect(await prefillOn(journal, entry.exercise.id)).toBe("30x12x2");
});
