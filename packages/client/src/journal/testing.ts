import { Dexie } from "dexie";
import { forceCloseDatabase } from "fake-indexeddb";
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

/** The IndexedDB version of a schema version: Dexie keeps each one times ten. */
function indexedDbVersion(schemaVersion: number): number {
  return schemaVersion * 10;
}

/**
 * A copy of the app on older code holding the store open: the store at schema version 2,
 * as it was before Substitutes, on a connection that never lets go by itself, like a tab
 * frozen in the background.
 */
export async function olderCopyHolding(name: string): Promise<{ close(): void }> {
  // The older code's schema, as it was then, not as store.ts declares it now.
  const older = new Dexie(name);
  older.version(1).stores({ workouts: "id, [date+createdAt]" });
  older.version(2).stores({
    workouts: "id, [date+createdAt]",
    exercises: "id, *nameKeys",
    entries: "id, workoutId",
    sets: "id, entryId",
  });
  await older.open();
  older.close();
  return rawConnection(name, indexedDbVersion(2));
}

/** A copy of the app on newer code upgrading the store, which makes every older connection close. */
export async function newerCopyUpgrading(name: string): Promise<{ close(): void }> {
  const current = await rawConnection(name);
  const version = current.version;
  current.close();
  return rawConnection(name, version + indexedDbVersion(1));
}

/**
 * The browser closes every open connection to the store by itself, as when the user clears the
 * site's data. The connections are fake-indexeddb's own, reached through its internals, so the
 * Journal needn't hand its connection out.
 */
export function browserClosesStore(name: string): void {
  const databases = (indexedDB as unknown as { _databases: Map<string, { connections: IDBDatabase[] }> })._databases;
  const connections = databases.get(name)?.connections ?? [];
  if (connections.length === 0) throw new Error(`No open connection to ${name}`);
  // Its types ask for the connection's class, though it takes a connection.
  for (const connection of connections) forceCloseDatabase(connection as unknown as Parameters<typeof forceCloseDatabase>[0]);
}

/** A store at schema version 1 whose Workouts are keyed by date, which no version of the code can fit. */
export async function storeTheCodeCannotFit(name: string): Promise<void> {
  const store = await rawConnection(name, indexedDbVersion(1), (upgrading) => {
    upgrading.createObjectStore("workouts", { keyPath: "date" });
  });
  store.close();
}

/** A plain IndexedDB connection with no handler for another connection's upgrade. */
function rawConnection(name: string, version?: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    if (upgrade) request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * A store written by the app before sync existed (schema version 3): a Workout of 1 September
 * planned as "squat 100x5", recorded before finishing and Rep ranges existed, so its record
 * has no `finished` and its Planned Set no `maxReps`. Returns the Workout's id.
 */
export async function storeFromBeforeSync(name: string): Promise<string> {
  // The older code's schema, as it was then, not as store.ts declares it now.
  const older = new Dexie(name);
  older.version(1).stores({ workouts: "id, [date+createdAt]" });
  older.version(2).stores({
    workouts: "id, [date+createdAt]",
    exercises: "id, *nameKeys",
    entries: "id, workoutId",
    sets: "id, entryId",
  });
  older.version(3).stores({ entries: "id, workoutId, substitutesEntryId" });
  const workoutId = "0b8e6f2c-6f3e-4a51-9d49-3f1f6f0b1a01";
  await older.table("workouts").add({ id: workoutId, updatedAt: 1, deleted: false, date: "2026-09-01", createdAt: 1 });
  await older.table("exercises").add({
    id: "0b8e6f2c-6f3e-4a51-9d49-3f1f6f0b1a02",
    updatedAt: 1,
    deleted: false,
    primaryName: "squat",
    alternativeNames: [],
    nameKeys: ["squat"],
  });
  await older.table("entries").add({
    id: "0b8e6f2c-6f3e-4a51-9d49-3f1f6f0b1a03",
    updatedAt: 1,
    deleted: false,
    workoutId,
    exerciseId: "0b8e6f2c-6f3e-4a51-9d49-3f1f6f0b1a02",
    position: 0,
  });
  await older.table("sets").add({
    id: "0b8e6f2c-6f3e-4a51-9d49-3f1f6f0b1a04",
    updatedAt: 1,
    deleted: false,
    entryId: "0b8e6f2c-6f3e-4a51-9d49-3f1f6f0b1a03",
    kind: "planned",
    position: 0,
    weight: 100,
    reps: 5,
    rpe: null,
    comment: null,
  });
  older.close();
  return workoutId;
}
