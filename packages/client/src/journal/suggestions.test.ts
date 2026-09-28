import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import type { Journal } from "./journal.ts";
import { freshJournal } from "./testing.ts";

const TODAY = localDate("2026-09-28");

/** A Workout on this date planned in this Plan notation. */
async function planned(journal: Journal, date: string, notation: string) {
  const workout = await journal.createWorkout(localDate(date));
  await journal.setPlan(workout.id, notation);
  return workout;
}

/** The Primary names of the Exercises suggested for this text today. */
async function suggested(journal: Journal, text: string) {
  return (await journal.suggestExercises(text, TODAY)).map((e) => e.primaryName);
}

test("Exercises used in Workouts within the last three months come first, by number of such Workouts", async () => {
  const journal = freshJournal();
  await planned(journal, "2026-09-01", "deadlift 140x3\nsquat 100x5");
  await planned(journal, "2026-09-08", "squat 100x5\nbench press 80x5");
  await planned(journal, "2026-09-15", "squat 100x5\nbench press 80x5");
  await planned(journal, "2026-09-22", "squat 100x5");

  expect(await suggested(journal, "")).toEqual(["squat", "bench press", "deadlift"]);
});

test("among Exercises used in as many recent Workouts, the one used most recently comes first, whenever it was recorded", async () => {
  const journal = freshJournal();
  // Recorded after the others, but dated before them.
  await planned(journal, "2026-09-20", "squat 100x5");
  await planned(journal, "2026-09-10", "bench press 80x5");
  await planned(journal, "2026-09-25", "deadlift 140x3");
  await planned(journal, "2026-09-12", "overhead press 50x5");
  // Two Workouts on one date: the one created later is the later use.
  await planned(journal, "2026-09-12", "pull-up x8");

  expect(await suggested(journal, "")).toEqual(["deadlift", "squat", "pull-up", "overhead press", "bench press"]);
});

test("Exercises used only before the last three months come after the recent ones, most recently used first, however often", async () => {
  const journal = freshJournal();
  for (const date of ["2026-01-12", "2026-02-09", "2026-03-16", "2026-04-13", "2026-05-11"]) {
    await planned(journal, date, "squat 100x5");
  }
  await planned(journal, "2026-06-27", "deadlift 140x3");
  // Three months before today, to the day: still recent.
  await planned(journal, "2026-06-28", "bench press 80x5");

  expect(await suggested(journal, "")).toEqual(["bench press", "deadlift", "squat"]);
});

test("Exercises matching the text in any case come ranked, and those never used, or used only in what was deleted, come last by name", async () => {
  const journal = freshJournal();
  await planned(journal, "2026-01-12", "hack squat 120x8");
  await planned(journal, "2026-09-01", "squat 100x5\nbench press 80x5");
  const deleted = await planned(journal, "2026-09-20", "zercher squat 100x5");
  await journal.deleteWorkout(deleted.id);
  const replanned = await planned(journal, "2026-09-21", "box squat 80x5\nyoke squat 100x5");
  await journal.setPlan(replanned.id, "bench press 80x5");

  expect(await suggested(journal, "SQUAT")).toEqual(["squat", "hack squat", "box squat", "yoke squat", "zercher squat"]);
});
