import { expect, test } from "vitest";
import type { StoreState } from "@gymlog/client/journal";
import {
  browserClosesStore,
  newerCopyUpgrading,
  storeStateBecomes,
  uniqueJournalName,
} from "@gymlog/client/testing";
import { startTestServer } from "./testing/devices.ts";

/** Lets a sync started by an event send its first request: it does so before the next turn of the event loop. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test.each<[string, StoreState["status"], (store: string) => Promise<{ close(): void } | void>]>([
  ["upgraded by a newer copy of the app", "upgradedElsewhere", (store) => newerCopyUpgrading(store)],
  ["closed by the browser", "closedByBrowser", async (store) => browserClosesStore(store)],
])("once its store is %s, a device sends no more sync requests, even back online", async (_, status, closeStore) => {
  const server = await startTestServer();
  const store = uniqueJournalName();
  const phone = server.device(store);
  await phone.signUp("alexey");
  await phone.journal.sync.now();
  // While the store is open, coming back online syncs.
  const whileOpen = phone.requestsSent();
  phone.goOnline();
  await nextTurn();
  expect(phone.requestsSent()).toBeGreaterThan(whileOpen);
  await phone.journal.sync.now();

  const otherCopy = await closeStore(store);
  await storeStateBecomes(phone.journal, status);
  const sent = phone.requestsSent();
  phone.goOnline();
  await nextTurn();

  expect(phone.requestsSent()).toBe(sent);
  otherCopy?.close();
});
