import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { openJournal } from "./journal.ts";

let journalCount = 0;

function freshJournal() {
  let clock = 1_000;
  return openJournal({ name: `journal-test-${++journalCount}`, now: () => clock++ });
}

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
    { id: moved.id, date: "2026-09-25" },
    { id: other.id, date: "2026-09-22" },
  ]);
});

test("a deleted Workout is no longer listed", async () => {
  const journal = freshJournal();
  const kept = await journal.createWorkout(localDate("2026-09-20"));
  const deleted = await journal.createWorkout(localDate("2026-09-22"));

  await journal.deleteWorkout(deleted.id);

  expect(await journal.listWorkouts()).toEqual([{ id: kept.id, date: "2026-09-20" }]);
});

test("Workouts survive closing and reopening the Journal", async () => {
  const name = `journal-test-reopen-${++journalCount}`;
  const first = openJournal({ name });
  const kept = await first.createWorkout(localDate("2026-09-24"));
  const deleted = await first.createWorkout(localDate("2026-09-25"));
  await first.deleteWorkout(deleted.id);
  first.close();

  const reopened = openJournal({ name });

  expect(await reopened.listWorkouts()).toEqual([{ id: kept.id, date: "2026-09-24" }]);
});
