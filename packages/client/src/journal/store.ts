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
