import { Dexie, type EntityTable } from "dexie";
import type { EntryRecord, ExerciseRecord, LocalDate, SetRecord, SyncedRecord, WorkoutRecord } from "@gymlog/shared";
import { newId } from "./ids.ts";

export interface Workout {
  id: string;
  date: LocalDate;
}

export interface Exercise {
  id: string;
  primaryName: string;
}

export interface PerformedSet {
  id: string;
  /** kg; null for a bodyweight Set. */
  weight: number | null;
  /** Completed repetitions. */
  reps: number;
  rpe: number | null;
  comment: string | null;
}

export interface Entry {
  id: string;
  exercise: Exercise;
  performedSets: PerformedSet[];
}

export interface WorkoutWithEntries extends Workout {
  entries: Entry[];
}

/** The single interface the UI uses for everything a user does with their Workouts. */
export interface Journal {
  createWorkout(date: LocalDate): Promise<Workout>;
  listWorkouts(): Promise<Workout[]>;
  /** The Workout with its Entries, or undefined if there is no such Workout. */
  getWorkout(id: string): Promise<WorkoutWithEntries | undefined>;
  changeWorkoutDate(id: string, date: LocalDate): Promise<void>;
  deleteWorkout(id: string): Promise<void>;
  /** Adds an Entry for the Exercise with this name, creating the Exercise if no name matches. */
  addEntry(workoutId: string, exerciseName: string): Promise<Entry>;
  addPerformedSet(entryId: string, values: SetValues): Promise<PerformedSet>;
  editPerformedSet(setId: string, values: SetValues): Promise<void>;
  /** Sets RPE (1 to 10 in steps of 0.5), or clears it with null. */
  setRpe(setId: string, rpe: number | null): Promise<void>;
  /** Sets the Comment; blank text clears it. */
  setComment(setId: string, text: string): Promise<void>;
  close(): void;
}

export interface SetValues {
  weight: number | null;
  reps: number;
}

export interface JournalOptions {
  /** IndexedDB database name. */
  name?: string;
  /** Device clock in milliseconds. */
  now?: () => number;
}

type JournalDb = Dexie & {
  workouts: EntityTable<WorkoutRecord, "id">;
  exercises: EntityTable<ExerciseRecord, "id">;
  entries: EntityTable<EntryRecord, "id">;
  sets: EntityTable<SetRecord, "id">;
};

export function openJournal({ name = "gymlog", now = Date.now }: JournalOptions = {}): Journal {
  const db = new Dexie(name) as JournalDb;
  db.version(1).stores({ workouts: "id, [date+createdAt]" });
  db.version(2).stores({
    workouts: "id, [date+createdAt]",
    exercises: "id, *nameKeys",
    entries: "id, workoutId",
    sets: "id, entryId",
  });

  /** The fields every new record starts with. */
  function newRecord(): SyncedRecord {
    return { id: newId(), updatedAt: now(), deleted: false };
  }

  async function findOrCreateExercise(name: string): Promise<ExerciseRecord> {
    const key = nameKey(name);
    if (!key) throw new RangeError("An Exercise needs a name");
    const existing = await db.exercises.where("nameKeys").equals(key).filter((e) => !e.deleted).first();
    if (existing) return existing;
    const created: ExerciseRecord = { ...newRecord(), primaryName: name.trim(), nameKeys: [key] };
    await db.exercises.add(created);
    return created;
  }

  return {
    async createWorkout(date) {
      const record: WorkoutRecord = { ...newRecord(), date, createdAt: now() };
      await db.workouts.add(record);
      return toWorkout(record);
    },

    async listWorkouts() {
      const records = await db.workouts.orderBy("[date+createdAt]").reverse().toArray();
      return records.filter((r) => !r.deleted).map(toWorkout);
    },

    async getWorkout(id) {
      const workout = await db.workouts.get(id);
      if (!workout || workout.deleted) return undefined;
      const entries = (await db.entries.where("workoutId").equals(id).toArray())
        .filter((e) => !e.deleted)
        .sort((a, b) => a.position - b.position);
      const exercises = await db.exercises.bulkGet(entries.map((e) => e.exerciseId));
      const sets = (await db.sets.where("entryId").anyOf(entries.map((e) => e.id)).toArray())
        .filter((s) => !s.deleted)
        .sort((a, b) => a.position - b.position);
      return {
        ...toWorkout(workout),
        entries: entries.map((entry, i) => ({
          id: entry.id,
          exercise: toExercise(exercises[i]!),
          performedSets: sets.filter((s) => s.entryId === entry.id).map(toPerformedSet),
        })),
      };
    },

    async changeWorkoutDate(id, date) {
      await db.workouts.update(id, { date, updatedAt: now() });
    },

    async deleteWorkout(id) {
      // A tombstone rather than a removal, so the deletion can reach other devices.
      await db.workouts.update(id, { deleted: true, updatedAt: now() });
    },

    async addEntry(workoutId, exerciseName) {
      return db.transaction("rw", [db.exercises, db.entries], async () => {
        const exercise = await findOrCreateExercise(exerciseName);
        const count = await db.entries.where("workoutId").equals(workoutId).count();
        const entry: EntryRecord = { ...newRecord(), workoutId, exerciseId: exercise.id, position: count };
        await db.entries.add(entry);
        return { id: entry.id, exercise: toExercise(exercise), performedSets: [] };
      });
    },

    async addPerformedSet(entryId, { weight, reps }) {
      checkSetValues({ weight, reps });
      return db.transaction("rw", db.sets, async () => {
        const count = await db.sets.where("entryId").equals(entryId).count();
        const set: SetRecord = { ...newRecord(), entryId, position: count, weight, reps, rpe: null, comment: null };
        await db.sets.add(set);
        return toPerformedSet(set);
      });
    },

    async editPerformedSet(setId, { weight, reps }) {
      checkSetValues({ weight, reps });
      await db.sets.update(setId, { weight, reps, updatedAt: now() });
    },

    async setRpe(setId, rpe) {
      if (rpe !== null && !(Number.isInteger(rpe * 2) && rpe >= 1 && rpe <= 10)) {
        throw new RangeError(`RPE must be 1 to 10 in steps of 0.5, not ${rpe}`);
      }
      await db.sets.update(setId, { rpe, updatedAt: now() });
    },

    async setComment(setId, text) {
      await db.sets.update(setId, { comment: text.trim() || null, updatedAt: now() });
    },

    close() {
      db.close();
    },
  };
}

/** Weight is optional and never negative; reps are completed repetitions, a whole number from 0. */
function checkSetValues({ weight, reps }: SetValues): void {
  if (weight !== null && !(Number.isFinite(weight) && weight >= 0)) {
    throw new RangeError(`Weight must be a number of kg from 0, not ${weight}`);
  }
  if (!(Number.isInteger(reps) && reps >= 0)) {
    throw new RangeError(`Reps must be a whole number from 0, not ${reps}`);
  }
}

/** Exercise names match ignoring case and extra spaces. */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

function toWorkout(record: WorkoutRecord): Workout {
  return { id: record.id, date: record.date };
}

function toExercise(record: ExerciseRecord): Exercise {
  return { id: record.id, primaryName: record.primaryName };
}

function toPerformedSet(record: SetRecord): PerformedSet {
  return { id: record.id, weight: record.weight, reps: record.reps, rpe: record.rpe, comment: record.comment };
}
