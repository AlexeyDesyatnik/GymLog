import { Dexie } from "dexie";
import { openJournal, type Journal, type StoreState } from "./journal.ts";

let journalCount = 0;

/** A unique IndexedDB name, so tests never share a database. */
export function uniqueJournalName(): string {
  return `journal-test-${++journalCount}`;
}

/** A Journal on its own empty database, with a clock that ticks by 1 ms per reading. */
export function freshJournal(): Journal {
  let clock = 1_000;
  return openJournal({ name: uniqueJournalName(), now: () => clock++ });
}

/** Resolves once the Journal's store is in this state. */
export function storeStateBecomes(journal: Journal, status: StoreState["status"]): Promise<StoreState> {
  return new Promise((resolve) => {
    const check = () => {
      const state = journal.storeState();
      if (state.status !== status) return;
      stop();
      resolve(state);
    };
    const stop = journal.onStoreStateChange(check);
    check();
  });
}

/**
 * A copy of the app on older code holding the store open: the store at schema version 2,
 * as it was before Substitutes, on a connection that never lets go by itself, like a tab
 * frozen in the background.
 */
export async function olderCopyHolding(name: string): Promise<{ close(): void }> {
  const older = new Dexie(name);
  older.version(1).stores({ workouts: "id, [date+createdAt]" });
  older.version(2).stores({
    workouts: "id, [date+createdAt]",
    exercises: "id, *nameKeys",
    entries: "id, workoutId",
    sets: "id, entryId",
  });
  await older.open();
  const version = older.verno * 10;
  older.close();
  return rawConnection(name, version);
}

/** A copy of the app on newer code upgrading the store, which makes every older connection close. */
export async function newerCopyUpgrading(name: string): Promise<{ close(): void }> {
  const current = await rawConnection(name);
  const version = current.version;
  current.close();
  return rawConnection(name, version + 10);
}

/** A store at the current version whose Workouts are keyed differently, which no version of the code can fit. */
export async function storeTheCodeCannotFit(name: string): Promise<void> {
  const request = indexedDB.open(name, 30);
  request.onupgradeneeded = () => request.result.createObjectStore("workouts", { keyPath: "date" });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
}

/** A plain IndexedDB connection with no handler for another connection's upgrade. */
function rawConnection(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
