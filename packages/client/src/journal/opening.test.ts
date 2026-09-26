import { expect, test } from "vitest";
import { openJournal } from "./journal.ts";
import {
  newerCopyUpgrading,
  olderCopyHolding,
  storeStateBecomes,
  storeTheCodeCannotFit,
  uniqueJournalName,
} from "./testing.ts";

test("a Journal opened while an older copy of the app holds the store reports blocked, and carries on once it lets go", async () => {
  const name = uniqueJournalName();
  const older = await olderCopyHolding(name);

  const journal = openJournal({ name });
  await storeStateBecomes(journal, "blocked");
  const listed = journal.listWorkouts();
  older.close();

  await storeStateBecomes(journal, "ready");
  expect(await listed).toEqual([]);
});

test("an open Journal whose store a newer copy of the app upgrades reports so, and is not reopened on older code", async () => {
  const name = uniqueJournalName();
  const journal = openJournal({ name });
  await storeStateBecomes(journal, "ready");

  const newer = await newerCopyUpgrading(name);

  expect(journal.storeState()).toEqual({ status: "upgradedElsewhere" });
  await expect(journal.listWorkouts()).rejects.toThrow();
  newer.close();
});

test("a Journal whose store can't be opened reports that it failed, with the reason", async () => {
  const name = uniqueJournalName();
  await storeTheCodeCannotFit(name);

  const journal = openJournal({ name });

  const state = await storeStateBecomes(journal, "failed");
  expect(state).toEqual({ status: "failed", error: expect.stringContaining("UpgradeError") });
  await expect(journal.listWorkouts()).rejects.toThrow();
});
