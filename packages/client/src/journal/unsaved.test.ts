import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { ChangeNotSaved, openJournal } from "./journal.ts";
import { freshJournal, newerCopyUpgrading, storeStateBecomes, uniqueJournalName } from "./testing.ts";

test("a change the store can't carry out is not saved, and says why", async () => {
  const name = uniqueJournalName();
  const journal = openJournal({ name });
  await storeStateBecomes(journal, "ready");
  const newer = await newerCopyUpgrading(name);

  const change = journal.createWorkout(localDate("2026-09-27"));

  await expect(change).rejects.toBeInstanceOf(ChangeNotSaved);
  await expect(change).rejects.toHaveProperty("cause.name", "DatabaseClosedError");
  newer.close();
});

test("a change the Journal refuses is not saved either, and says why", async () => {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-27"));
  await journal.addEntry(workout.id, "squat");
  await journal.finishWorkout(workout.id);

  const change = journal.addEntry(workout.id, "deadlift");

  await expect(change).rejects.toBeInstanceOf(ChangeNotSaved);
  await expect(change).rejects.toHaveProperty("cause", expect.any(RangeError));
});

test("reading from a store that can't be used fails with the store's own reason", async () => {
  const name = uniqueJournalName();
  const journal = openJournal({ name });
  await storeStateBecomes(journal, "ready");
  const newer = await newerCopyUpgrading(name);

  await expect(journal.listWorkouts()).rejects.toHaveProperty("name", "DatabaseClosedError");
  newer.close();
});
