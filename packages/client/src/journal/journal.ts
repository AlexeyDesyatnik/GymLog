import { Dexie, type EntityTable } from "dexie";
import { checkRpe, checkSetValues, exerciseNameKey, formatPlanLine, parsePlan, type PlanLine } from "@gymlog/shared";
import type { EntryRecord, ExerciseRecord, LocalDate, SetRecord, SyncedRecord, WorkoutRecord } from "@gymlog/shared";
import { newId } from "./ids.ts";

export interface Workout {
  id: string;
  date: LocalDate;
}

/** A Workout as shown in the list of Workouts. */
export interface WorkoutSummary extends Workout {
  /** Primary names of the Workout's Exercises, in Entry order. */
  exerciseNames: string[];
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
  /** A value on RPE_SCALE (RPE_BELOW_5 for "below 5"); null when not given. */
  rpe: number | null;
  comment: string | null;
}

export interface PlannedSet {
  id: string;
  /** kg; null for a bodyweight Set. */
  weight: number | null;
  reps: number;
}

export interface Entry {
  id: string;
  exercise: Exercise;
  plannedSets: PlannedSet[];
  performedSets: PerformedSet[];
}

export interface WorkoutWithEntries extends Workout {
  entries: Entry[];
  /** The Plan in Plan notation, one line per planned Entry; empty when there is no Plan. */
  planNotation: string;
  /** The Plan can't be changed once a Performed Set is recorded (re-editing comes in a later ticket). */
  planLocked: boolean;
}

/** The single interface the UI uses for everything a user does with their Workouts. */
export interface Journal {
  createWorkout(date: LocalDate): Promise<Workout>;
  listWorkouts(): Promise<WorkoutSummary[]>;
  /** The Workout with its Entries, or undefined if there is no such Workout. */
  getWorkout(id: string): Promise<WorkoutWithEntries | undefined>;
  changeWorkoutDate(id: string, date: LocalDate): Promise<void>;
  deleteWorkout(id: string): Promise<void>;
  /** Adds an Entry for the Exercise with this name, creating the Exercise if no name matches. */
  addEntry(workoutId: string, exerciseName: string): Promise<Entry>;
  addPerformedSet(entryId: string, values: SetValues): Promise<PerformedSet>;
  editPerformedSet(setId: string, values: SetValues): Promise<void>;
  /** Sets RPE to a value on RPE_SCALE, or clears it with null. */
  setRpe(setId: string, rpe: number | null): Promise<void>;
  /** Sets the Comment; blank text clears it. */
  setComment(setId: string, text: string): Promise<void>;
  /**
   * Replaces the Workout's Plan with the understood lines of this Plan notation, and
   * reports how each non-empty line was understood. Refused once the Plan is locked.
   */
  setPlan(workoutId: string, notation: string): Promise<PlanLine[]>;
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
    const key = exerciseNameKey(name);
    if (!key) throw new RangeError("An Exercise needs a name");
    const existing = await db.exercises.where("nameKeys").equals(key).filter((e) => !e.deleted).first();
    if (existing) return existing;
    const created: ExerciseRecord = { ...newRecord(), primaryName: name.trim(), alternativeNames: [], nameKeys: [key] };
    await db.exercises.add(created);
    return created;
  }

  /** The live Entries of these Workouts, in Entry order. */
  async function liveEntriesOf(workoutIds: string[]): Promise<EntryRecord[]> {
    return (await db.entries.where("workoutId").anyOf(workoutIds).toArray())
      .filter((e) => !e.deleted)
      .sort((a, b) => a.position - b.position);
  }

  return {
    async createWorkout(date) {
      const record: WorkoutRecord = { ...newRecord(), date, createdAt: now() };
      await db.workouts.add(record);
      return toWorkout(record);
    },

    async listWorkouts() {
      const records = (await db.workouts.orderBy("[date+createdAt]").reverse().toArray()).filter((r) => !r.deleted);
      const entries = await liveEntriesOf(records.map((r) => r.id));
      const exercises = await db.exercises.bulkGet(entries.map((e) => e.exerciseId));
      return records.map((record) => {
        // Keyed by Exercise, so each is named once, where it first appears.
        const primaryNameByExerciseId = new Map<string, string>();
        entries.forEach((entry, i) => {
          if (entry.workoutId === record.id) primaryNameByExerciseId.set(entry.exerciseId, exercises[i]!.primaryName);
        });
        return { ...toWorkout(record), exerciseNames: [...primaryNameByExerciseId.values()] };
      });
    },

    async getWorkout(id) {
      const workout = await db.workouts.get(id);
      if (!workout || workout.deleted) return undefined;
      const entries = await liveEntriesOf([id]);
      const exercises = await db.exercises.bulkGet(entries.map((e) => e.exerciseId));
      const sets = (await db.sets.where("entryId").anyOf(entries.map((e) => e.id)).toArray())
        .filter((s) => !s.deleted)
        .sort((a, b) => a.position - b.position);
      const views: Entry[] = entries.map((entry, i) => ({
        id: entry.id,
        exercise: toExercise(exercises[i]!),
        plannedSets: sets.filter((s) => s.entryId === entry.id && s.kind === "planned").map(toPlannedSet),
        performedSets: sets.filter((s) => s.entryId === entry.id && s.kind === "performed").map(toPerformedSet),
      }));
      return {
        ...toWorkout(workout),
        entries: views,
        planNotation: views
          .filter((entry) => entry.plannedSets.length > 0)
          .map((entry) => formatPlanLine(entry.exercise.primaryName, entry.plannedSets))
          .join("\n"),
        planLocked: isPlanLocked(sets),
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
        return { id: entry.id, exercise: toExercise(exercise), plannedSets: [], performedSets: [] };
      });
    },

    async addPerformedSet(entryId, { weight, reps }) {
      checkSetValues({ weight, reps });
      return db.transaction("rw", db.sets, async () => {
        const count = await db.sets.where("entryId").equals(entryId).count();
        const set: SetRecord = {
          ...newRecord(),
          entryId,
          kind: "performed",
          position: count,
          weight,
          reps,
          rpe: null,
          comment: null,
        };
        await db.sets.add(set);
        return toPerformedSet(set);
      });
    },

    async editPerformedSet(setId, { weight, reps }) {
      checkSetValues({ weight, reps });
      await db.sets.update(setId, { weight, reps, updatedAt: now() });
    },

    async setRpe(setId, rpe) {
      checkRpe(rpe);
      await db.sets.update(setId, { rpe, updatedAt: now() });
    },

    async setComment(setId, text) {
      await db.sets.update(setId, { comment: text.trim() || null, updatedAt: now() });
    },

    async setPlan(workoutId, notation) {
      const lines = parsePlan(notation);
      await db.transaction("rw", [db.workouts, db.exercises, db.entries, db.sets], async () => {
        const workout = await db.workouts.get(workoutId);
        if (!workout || workout.deleted) throw new RangeError(`No Workout ${workoutId}`);
        const entries = await liveEntriesOf([workoutId]);
        const sets = (await db.sets.where("entryId").anyOf(entries.map((e) => e.id)).toArray()).filter(
          (s) => !s.deleted,
        );
        if (isPlanLocked(sets)) {
          throw new RangeError("The Plan can't be changed once the Workout has Performed Sets");
        }

        // The old Plan goes; Entries added outside the Plan stay, after the new one.
        const plannedEntryIds = new Set(sets.map((s) => s.entryId));
        const time = now();
        for (const set of sets) await db.sets.update(set.id, { deleted: true, updatedAt: time });
        for (const entry of entries.filter((e) => plannedEntryIds.has(e.id))) {
          await db.entries.update(entry.id, { deleted: true, updatedAt: time });
        }
        const keptEntries = entries.filter((e) => !plannedEntryIds.has(e.id));

        let position = 0;
        for (const line of lines) {
          if (!line.ok) continue;
          const exercise = await findOrCreateExercise(line.exerciseName);
          const entry: EntryRecord = { ...newRecord(), workoutId, exerciseId: exercise.id, position: position++ };
          await db.entries.add(entry);
          const plannedSets = line.groups.flatMap((g) => Array.from({ length: g.sets }, () => g));
          await db.sets.bulkAdd(
            plannedSets.map((g, i): SetRecord => ({
              ...newRecord(),
              entryId: entry.id,
              kind: "planned",
              position: i,
              weight: g.weight,
              reps: g.reps,
              rpe: null,
              comment: null,
            })),
          );
        }
        for (const entry of keptEntries) {
          await db.entries.update(entry.id, { position: position++, updatedAt: time });
        }
      });
      return lines;
    },

    close() {
      db.close();
    },
  };
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

function toPlannedSet(record: SetRecord): PlannedSet {
  return { id: record.id, weight: record.weight, reps: record.reps };
}

/** Re-editing a Plan with recorded Sets needs reconciliation, which comes in a later ticket. */
function isPlanLocked(sets: SetRecord[]): boolean {
  return sets.some((s) => s.kind === "performed");
}
