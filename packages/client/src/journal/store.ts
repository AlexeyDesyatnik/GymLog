import { Dexie, type EntityTable, type Table, type Transaction } from "dexie";
import { exerciseNameKey } from "@gymlog/shared";
import type { EntryRecord, ExerciseRecord, RecordType, SetRecord, SyncedRecord, WorkoutRecord } from "@gymlog/shared";

/**
 * How a record is kept on the device: 1 while it has a change the server hasn't taken yet,
 * 2 when the server refused it, which is kept so a fix can send it again. Every write marks
 * it 1, except a write by sync itself (see syncWrites).
 */
export interface Unsynced {
  unsynced?: 0 | 1 | 2;
}

/** What sync keeps on the device, in one row. */
export interface SyncProgress {
  key: "sync";
  /** The user this device's records belong to: whoever signed in first. */
  ownerId: string;
  /** The server's sequence number of the last record pulled. */
  cursor: number;
}

/** The Journal's local store: one IndexedDB database of synced records. */
export type JournalDb = Dexie & {
  workouts: EntityTable<WorkoutRecord & Unsynced, "id">;
  exercises: EntityTable<ExerciseRecord & Unsynced, "id">;
  entries: EntityTable<EntryRecord & Unsynced, "id">;
  sets: EntityTable<SetRecord & Unsynced, "id">;
  syncProgress: EntityTable<SyncProgress, "key">;
};

/** The table each type of record is kept in. */
export function recordTable(db: JournalDb, type: RecordType): Table<SyncedRecord & Unsynced, string> {
  const tables = { workout: db.workouts, exercise: db.exercises, entry: db.entries, set: db.sets };
  return tables[type] as unknown as Table<SyncedRecord & Unsynced, string>;
}

/** Transactions in which sync writes: what it stores came from the server or was just sent there. */
const syncWrites = new WeakSet<Transaction>();

/** Runs sync's own writes to the store, which leave records' unsynced marks as they set them. */
export function writeAsSync<T>(db: JournalDb, write: () => Promise<T>): Promise<T> {
  return db.transaction("rw", [db.workouts, db.exercises, db.entries, db.sets, db.syncProgress], () => {
    syncWrites.add(Dexie.currentTransaction);
    return write();
  });
}

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
  // Records written before sync existed have all yet to reach the server.
  db.version(4)
    .stores({
      workouts: "id, [date+createdAt], unsynced",
      exercises: "id, *nameKeys, unsynced",
      entries: "id, workoutId, substitutesEntryId, unsynced",
      sets: "id, entryId, unsynced",
      syncProgress: "key",
    })
    .upgrade(async (upgrading) => {
      for (const name of ["workouts", "exercises", "entries", "sets"]) {
        await upgrading.table(name).toCollection().modify({ unsynced: 1 });
      }
    });
  for (const table of [db.workouts, db.exercises, db.entries, db.sets] as Table<SyncedRecord & Unsynced>[]) {
    table.hook("creating", (_key, record, transaction) => {
      if (!syncWrites.has(transaction)) record.unsynced = 1;
    });
    table.hook("updating", (changes: Partial<SyncedRecord>, _key, record, transaction) => {
      if (syncWrites.has(transaction)) return undefined;
      // A change is always later than the version it changes, so it wins over it in sync even
      // when that version came from a device whose clock is ahead of this one.
      return { unsynced: 1, updatedAt: Math.max(changes.updatedAt ?? 0, record.updatedAt + 1) };
    });
  }
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

/** The Exercise, if it is live. */
export async function liveExercise(db: JournalDb, id: string): Promise<ExerciseRecord> {
  const exercise = await db.exercises.get(id);
  if (!exercise || exercise.deleted) throw new RangeError(`No Exercise ${id}`);
  return exercise;
}

/**
 * Moves each live Entry of an Exercise merged away to the Exercise it was merged into. An Entry
 * recorded on a device that hadn't heard of the Merge yet arrives on the merged Exercise; this is
 * a change of the Entry here, sent on like any other. Returns whether any Entry moved.
 */
export async function followMerges(db: JournalDb): Promise<boolean> {
  return db.transaction("rw", [db.exercises, db.entries], async () => {
    const exercises = new Map((await db.exercises.toArray()).map((e) => [e.id, e]));
    /** The live Exercise this one ended up in, or undefined when it is live itself or was simply deleted. */
    const survivor = (id: string): string | undefined => {
      let exercise = exercises.get(id);
      // A merged Exercise's target may have been merged in turn; ids can't loop, but a bound costs nothing.
      for (let hops = 0; exercise?.mergedIntoId && hops < exercises.size; hops++) {
        exercise = exercises.get(exercise.mergedIntoId);
        if (exercise && !exercise.deleted) return exercise.id;
      }
      return undefined;
    };
    let moved = false;
    for (const entry of await db.entries.filter((e) => !e.deleted).toArray()) {
      const target = survivor(entry.exerciseId);
      if (!target) continue;
      await db.entries.update(entry.id, { exerciseId: target });
      moved = true;
    }
    return moved;
  });
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

/** Workouts in the order of the list of Workouts, earliest first: by date, then by when each was created. */
export function compareWorkoutOrder(a: WorkoutRecord, b: WorkoutRecord): number {
  return a.date.localeCompare(b.date) || a.createdAt - b.createdAt;
}

/** These Entries, each with its Workout, keeping only live Entries of live Workouts. */
async function withLiveWorkouts(
  db: JournalDb,
  entries: EntryRecord[],
): Promise<{ entry: EntryRecord; workout: WorkoutRecord }[]> {
  const workouts = await db.workouts.bulkGet(entries.map((e) => e.workoutId));
  return entries.flatMap((entry, i) => {
    const workout = workouts[i];
    return !entry.deleted && workout && !workout.deleted ? [{ entry, workout }] : [];
  });
}

/** For each Exercise, the live Workouts with an Entry of it, each once. */
export async function exerciseUses(db: JournalDb): Promise<Map<string, WorkoutRecord[]>> {
  const uses = new Map<string, WorkoutRecord[]>();
  for (const { entry, workout } of await withLiveWorkouts(db, await db.entries.toArray())) {
    const used = uses.get(entry.exerciseId) ?? [];
    if (!used.some((w) => w.id === workout.id)) used.push(workout);
    uses.set(entry.exerciseId, used);
  }
  return uses;
}

/**
 * The live Exercises with a name in which the typed text starts a word, ignoring case: "be" finds
 * bench press and close-grip bench press, but not barbell row.
 */
export async function exercisesMatching(db: JournalDb, text: string): Promise<ExerciseRecord[]> {
  const key = exerciseNameKey(text);
  const startsWord = (name: string) => name.startsWith(key) || name.includes(` ${key}`) || name.includes(`-${key}`);
  return (await db.exercises.toArray()).filter((e) => !e.deleted && e.nameKeys.some(startsWord));
}

/** The Exercises used as a Substitute for this Exercise in live Workouts, most recently used first. */
export async function previousSubstitutesFor(db: JournalDb, exerciseId: string): Promise<string[]> {
  // Only Substitutes are in this index.
  const substitutes = await withLiveWorkouts(db, await db.entries.orderBy("substitutesEntryId").toArray());
  const replaced = await db.entries.bulkGet(substitutes.map(({ entry }) => entry.substitutesEntryId!));
  const uses = substitutes.filter((_, i) => {
    const replacedEntry = replaced[i];
    return replacedEntry && !replacedEntry.deleted && replacedEntry.exerciseId === exerciseId;
  });
  uses.sort((a, b) => compareWorkoutOrder(b.workout, a.workout));
  return [...new Set(uses.map(({ entry }) => entry.exerciseId))];
}
