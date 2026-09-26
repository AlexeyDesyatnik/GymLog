import { Dexie, type EntityTable } from "dexie";
import type { EntryRecord, ExerciseRecord, SetRecord, WorkoutRecord } from "@gymlog/shared";

/** The Journal's local store: one IndexedDB database of synced records. */
export type JournalDb = Dexie & {
  workouts: EntityTable<WorkoutRecord, "id">;
  exercises: EntityTable<ExerciseRecord, "id">;
  entries: EntityTable<EntryRecord, "id">;
  sets: EntityTable<SetRecord, "id">;
};

export function openStore(name: string): JournalDb {
  const db = new Dexie(name) as JournalDb;
  db.version(1).stores({ workouts: "id, [date+createdAt]" });
  db.version(2).stores({
    workouts: "id, [date+createdAt]",
    exercises: "id, *nameKeys",
    entries: "id, workoutId",
    sets: "id, entryId",
  });
  return db;
}

/** Every table a Workout's records live in, for transactions that check the Workout. */
export function workoutTables(db: JournalDb) {
  return [db.workouts, db.entries, db.sets];
}

/**
 * The Workout, if it can be changed: it is live and not Finished. A Finished Workout is
 * read-only; undoing finishing is the only change it takes.
 */
export async function changeableWorkout(db: JournalDb, id: string): Promise<WorkoutRecord> {
  const workout = await db.workouts.get(id);
  if (!workout || workout.deleted) throw new RangeError(`No Workout ${id}`);
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
