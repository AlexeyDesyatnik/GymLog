import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { isRefusal, openJournal } from "./journal.ts";
import { freshJournal, newerCopyUpgrading, storeStateBecomes, uniqueJournalName } from "./testing.ts";

/** What the promise rejected with. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("The call was carried out, not refused");
}

test("a change the Journal won't carry out is refused, whether the Workout forbids it or the numbers are wrong", async () => {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-27"));
  const entry = await journal.addEntry(workout.id, "bench press");
  await journal.addPerformedSet(entry.id, { weight: 80, reps: 5 });
  const other = await journal.createWorkout(localDate("2026-09-27"));
  await journal.addEntry(other.id, "squat");
  await journal.finishWorkout(other.id);

  const refusals = [
    await rejectionOf(journal.addPerformedSet(entry.id, { weight: 80, reps: -2 })),
    await rejectionOf(journal.substituteEntry(entry.id, "dumbbell press")),
    await rejectionOf(journal.addEntry(other.id, "deadlift")),
  ];

  expect(refusals.map(isRefusal)).toEqual([true, true, true]);
});

test("a call that fails because the store is unusable is not a refusal", async () => {
  const name = uniqueJournalName();
  const journal = openJournal({ name });
  await storeStateBecomes(journal, "ready");
  const newer = await newerCopyUpgrading(name);

  const failure = await rejectionOf(journal.createWorkout(localDate("2026-09-27")));

  expect(isRefusal(failure)).toBe(false);
  newer.close();
});
