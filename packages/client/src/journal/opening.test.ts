import { expect, test } from "vitest";
import { openJournal, type StoreState } from "./journal.ts";
import {
  browserClosesStore,
  emptyServer,
  newerCopyUpgrading,
  olderCopyHolding,
  storeStateBecomes,
  storeTheCodeCannotFit,
  syncSettles,
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
  const states: StoreState[] = [];
  journal.onStoreStateChange(() => states.push(journal.storeState()));

  const newer = await newerCopyUpgrading(name);

  // Not even for a moment as closed by the browser, though the store is closed for the upgrade.
  expect(states).toEqual([{ status: "upgradedElsewhere" }]);
  await expect(journal.listWorkouts()).rejects.toThrow();
  newer.close();
});

/** A Journal syncing with a server, its store ready and synced once, whose coming back online syncs again. */
async function syncingJournal() {
  const name = uniqueJournalName();
  const server = emptyServer();
  const journal = openJournal({ name, server: server.options });
  await storeStateBecomes(journal, "ready");
  await syncSettles();
  const before = server.requests();
  server.backOnline();
  await syncSettles();
  expect(server.requests()).toBeGreaterThan(before);
  return { name, server, journal };
}

test("after its store is upgraded elsewhere, a Journal makes no more sync requests to the server", async () => {
  const { name, server, journal } = await syncingJournal();

  const newer = await newerCopyUpgrading(name);
  await storeStateBecomes(journal, "upgradedElsewhere");
  const requests = server.requests();
  server.backOnline();
  await journal.sync.now();
  await syncSettles();

  expect(server.requests()).toBe(requests);
  newer.close();
});

test("after the browser closes its store, a Journal makes no more sync requests to the server", async () => {
  const { name, server, journal } = await syncingJournal();

  browserClosesStore(name);
  await storeStateBecomes(journal, "closedByBrowser");
  const requests = server.requests();
  server.backOnline();
  await journal.sync.now();
  await syncSettles();

  expect(server.requests()).toBe(requests);
});

test("a Journal whose store can't be opened reports that it failed, with the reason", async () => {
  const name = uniqueJournalName();
  await storeTheCodeCannotFit(name);

  const journal = openJournal({ name });

  const state = await storeStateBecomes(journal, "failed");
  expect(state).toEqual({ status: "failed", error: expect.stringContaining("UpgradeError") });
  await expect(journal.listWorkouts()).rejects.toThrow();
});

test("an open Journal whose store the browser closes reports so, and is not reopened", async () => {
  const name = uniqueJournalName();
  const journal = openJournal({ name });
  await storeStateBecomes(journal, "ready");

  browserClosesStore(name);

  await storeStateBecomes(journal, "closedByBrowser");
  await expect(journal.listWorkouts()).rejects.toThrow();
});

test("a Journal closed on purpose doesn't report its store as closed by the browser", async () => {
  const journal = openJournal({ name: uniqueJournalName() });
  await storeStateBecomes(journal, "ready");
  const states: StoreState[] = [];
  journal.onStoreStateChange(() => states.push(journal.storeState()));

  journal.close();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(states).toEqual([]);
});
