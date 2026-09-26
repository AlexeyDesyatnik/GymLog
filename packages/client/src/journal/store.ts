import { Dexie, type EntityTable } from "dexie";
import type { EntryRecord, ExerciseRecord, SetRecord, WorkoutRecord } from "@gymlog/shared";

/** The Journal's local store: one IndexedDB database of synced records. */
export type JournalDb = Dexie & {
  workouts: EntityTable<WorkoutRecord, "id">;
  exercises: EntityTable<ExerciseRecord, "id">;
  entries: EntityTable<EntryRecord, "id">;
  sets: EntityTable<SetRecord, "id">;
};

/** The state of the local store on this device. */
export type StoreState =
  | { status: "opening" }
  | { status: "ready" }
  /** Upgrading the store waits for another open copy of the app, on older code, to let go of it. */
  | { status: "blocked" }
  /** Another copy of the app, on newer code, upgraded the store, so this copy closed it for good. */
  | { status: "upgradedElsewhere" }
  | { status: "failed"; error: string };

/**
 * Opens the store at once, reporting each change of its state. Calls wait while it is
 * opening or blocked, and fail once it is closed: it is never reopened behind the user's
 * back, since code older than the store may not fit it.
 */
export function openStore(name: string, onStateChange: (state: StoreState) => void): JournalDb {
  const db = new Dexie(name, { autoOpen: false }) as JournalDb;
  db.version(1).stores({ workouts: "id, [date+createdAt]" });
  db.version(2).stores({
    workouts: "id, [date+createdAt]",
    exercises: "id, *nameKeys",
    entries: "id, workoutId",
    sets: "id, entryId",
  });
  // Only Substitutes carry the reference, so only they are in its index.
  db.version(3).stores({ entries: "id, workoutId, substitutesEntryId" });
  db.on("blocked", () => onStateChange({ status: "blocked" }));
  // Dexie closes the store itself here, to let the upgrade go ahead.
  db.on("versionchange", () => onStateChange({ status: "upgradedElsewhere" }));
  db.open().then(
    () => onStateChange({ status: "ready" }),
    (error: unknown) => onStateChange({ status: "failed", error: String(error) }),
  );
  return db;
}

/** Every table a Workout's records live in, for transactions that check the Workout. */
export function workoutTables(db: JournalDb) {
  return [db.workouts, db.entries, db.sets];
}

/** The Workout, if it is live. */
export async function liveWorkout(db: JournalDb, id: string): Promise<WorkoutRecord> {
  const workout = await db.workouts.get(id);
  if (!workout || workout.deleted) throw new RangeError(`No Workout ${id}`);
  return workout;
}

/**
 * The Workout, if it can be changed: it is live and not Finished. A Finished Workout is
 * read-only; undoing finishing is the only change it takes.
 */
export async function changeableWorkout(db: JournalDb, id: string): Promise<WorkoutRecord> {
  const workout = await liveWorkout(db, id);
  if (workout.finished) throw new RangeError(`Workout ${id} is Finished; undo finishing to change it`);
  return workout;
}

/** The Entry, if it and its Workout can be changed. */
export async function changeableEntry(db: JournalDb, id: string): Promise<EntryRecord> {
  const entry = await db.entries.get(id);
  if (!entry || entry.deleted) throw new RangeError(`No Entry ${id}`);
  await changeableWorkout(db, entry.workoutId);
  return entry;
}

/** The live Substitute performed instead of this Entry, if there is one. */
export async function liveSubstituteOf(db: JournalDb, entryId: string): Promise<EntryRecord | undefined> {
  return db.entries.where("substitutesEntryId").equals(entryId).filter((e) => !e.deleted).first();
}

/** The Entry, if it can take new Sets: it can be changed and isn't replaced, whose Sets go to its Substitute. */
export async function recordableEntry(db: JournalDb, id: string): Promise<EntryRecord> {
  const entry = await changeableEntry(db, id);
  if (await liveSubstituteOf(db, id)) throw new RangeError(`Entry ${id} is replaced; record Sets on its Substitute`);
  return entry;
}

/**
 * The Performed Set, if it and its Workout can be changed. A Planned Set changes only
 * through the Plan notation.
 */
export async function changeablePerformedSet(db: JournalDb, id: string): Promise<SetRecord> {
  const set = await db.sets.get(id);
  if (!set || set.deleted || set.kind !== "performed") throw new RangeError(`No Performed Set ${id}`);
  await changeableEntry(db, set.entryId);
  return set;
}

/** The live Entries of these Workouts, in Entry order. */
export async function liveEntriesOf(db: JournalDb, workoutIds: string[]): Promise<EntryRecord[]> {
  return (await db.entries.where("workoutId").anyOf(workoutIds).toArray())
    .filter((e) => !e.deleted)
    .sort((a, b) => a.position - b.position);
}

/** The live Sets of these Entries, in order. */
export async function liveSetsOf(db: JournalDb, entryIds: string[]): Promise<SetRecord[]> {
  return (await db.sets.where("entryId").anyOf(entryIds).toArray())
    .filter((s) => !s.deleted)
    .sort((a, b) => a.position - b.position);
}

/** The Exercises used as a Substitute for this Exercise in live Workouts, most recently used first. */
export async function previousSubstitutesFor(db: JournalDb, exerciseId: string): Promise<string[]> {
  // Only Substitutes are in this index.
  const substitutes = (await db.entries.orderBy("substitutesEntryId").toArray()).filter((e) => !e.deleted);
  const replaced = await db.entries.bulkGet(substitutes.map((e) => e.substitutesEntryId!));
  const workouts = await db.workouts.bulkGet(substitutes.map((e) => e.workoutId));
  const uses = substitutes.flatMap((substitute, i) => {
    const workout = workouts[i];
    const replacedEntry = replaced[i];
    if (!workout || workout.deleted || !replacedEntry || replacedEntry.deleted) return [];
    return replacedEntry.exerciseId === exerciseId ? [{ exerciseId: substitute.exerciseId, workout }] : [];
  });
  uses.sort((a, b) => b.workout.date.localeCompare(a.workout.date) || b.workout.createdAt - a.workout.createdAt);
  return [...new Set(uses.map((use) => use.exerciseId))];
}
