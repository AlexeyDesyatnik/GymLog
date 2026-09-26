import { checkRpe, checkSetValues, exerciseNameKey, formatPlanLine, parsePlan, type PlanLine } from "@gymlog/shared";
import type { EntryRecord, ExerciseRecord, LocalDate, SetRecord, SyncedRecord, WorkoutRecord } from "@gymlog/shared";
import { entryView, isPlanLocked, pairByOrder, splitSets, toExercise, toPerformedSet } from "./entryView.ts";
import { newId } from "./ids.ts";
import {
  changeableEntry,
  changeablePerformedSet,
  changeableWorkout,
  liveEntriesOf,
  liveSetsOf,
  liveWorkout,
  openStore,
  workoutTables,
} from "./store.ts";

export interface Workout {
  id: string;
  date: LocalDate;
  /** Declared fully recorded; a Finished Workout is read-only until finishing is undone. */
  finished: boolean;
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
  /** The RPE this Set aims for, given only on the first Set of a group; null otherwise. */
  targetRpe: number | null;
}

/** A Planned Set and the Performed Set paired with it; either side may be missing. */
export interface SetPair {
  planned: PlannedSet | null;
  performed: PerformedSet | null;
  /** A Planned Set with no Performed Set, in a Finished Workout. Derived, never stored. */
  notPerformed: boolean;
}

export interface Entry {
  id: string;
  exercise: Exercise;
  plannedSets: PlannedSet[];
  performedSets: PerformedSet[];
  /** Planned and Performed Sets paired by order: every Set of the Entry is in exactly one pair. */
  pairs: SetPair[];
  /** The numbers the next Performed Set starts from (number prefill), or null when there are none. */
  nextSet: SetValues | null;
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
  /** Declares the Workout fully recorded, which makes it read-only; its unrecorded Planned Sets are Not performed. */
  finishWorkout(id: string): Promise<void>;
  /** The only change a Finished Workout takes: it becomes changeable again, and nothing is Not performed. */
  undoFinishing(id: string): Promise<void>;
  /** Adds an Entry for the Exercise with this name, creating the Exercise if no name matches. */
  addEntry(workoutId: string, exerciseName: string): Promise<Entry>;
  /** Deletes an Entry added on the fly; its Sets go with it, hidden by the Entry's tombstone. */
  deleteEntry(entryId: string): Promise<void>;
  addPerformedSet(entryId: string, values: SetValues): Promise<PerformedSet>;
  /** Records the next unpaired Planned Set as done: a Performed Set with its weight and reps. */
  confirmPlannedSet(entryId: string): Promise<PerformedSet>;
  editPerformedSet(setId: string, values: SetValues): Promise<void>;
  deletePerformedSet(setId: string): Promise<void>;
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

export function openJournal({ name = "gymlog", now = Date.now }: JournalOptions = {}): Journal {
  const db = openStore(name);

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

  /** Adds a Performed Set after the Entry's other Sets; call it inside a transaction on the Sets. */
  async function recordPerformedSet(entryId: string, { weight, reps }: SetValues): Promise<PerformedSet> {
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
  }

  return {
    async createWorkout(date) {
      const record: WorkoutRecord = { ...newRecord(), date, createdAt: now(), finished: false };
      await db.workouts.add(record);
      return toWorkout(record);
    },

    async listWorkouts() {
      const records = (await db.workouts.orderBy("[date+createdAt]").reverse().toArray()).filter((r) => !r.deleted);
      const entries = await liveEntriesOf(db, records.map((r) => r.id));
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
      const record = await db.workouts.get(id);
      if (!record || record.deleted) return undefined;
      const workout = toWorkout(record);
      const entries = await liveEntriesOf(db, [id]);
      const exercises = await db.exercises.bulkGet(entries.map((e) => e.exerciseId));
      const sets = await liveSetsOf(db, entries.map((e) => e.id));
      const views = entries.map((entry, i) =>
        entryView(entry, exercises[i]!, sets.filter((s) => s.entryId === entry.id), workout.finished),
      );
      return {
        ...workout,
        entries: views,
        planNotation: views
          .filter((entry) => entry.plannedSets.length > 0)
          .map((entry) => formatPlanLine(entry.exercise.primaryName, entry.plannedSets))
          .join("\n"),
        planLocked: isPlanLocked(sets),
      };
    },

    async changeWorkoutDate(id, date) {
      await db.transaction("rw", db.workouts, async () => {
        await changeableWorkout(db, id);
        await db.workouts.update(id, { date, updatedAt: now() });
      });
    },

    async deleteWorkout(id) {
      await db.transaction("rw", db.workouts, async () => {
        await changeableWorkout(db, id);
        // A tombstone rather than a removal, so the deletion can reach other devices.
        await db.workouts.update(id, { deleted: true, updatedAt: now() });
      });
    },

    async finishWorkout(id) {
      await db.transaction("rw", db.workouts, async () => {
        await changeableWorkout(db, id);
        await db.workouts.update(id, { finished: true, updatedAt: now() });
      });
    },

    async undoFinishing(id) {
      await db.transaction("rw", db.workouts, async () => {
        const workout = await liveWorkout(db, id);
        if (!workout.finished) throw new RangeError(`Workout ${id} isn't Finished`);
        await db.workouts.update(id, { finished: false, updatedAt: now() });
      });
    },

    async addEntry(workoutId, exerciseName) {
      return db.transaction("rw", [db.workouts, db.exercises, db.entries], async () => {
        await changeableWorkout(db, workoutId);
        const exercise = await findOrCreateExercise(exerciseName);
        const count = await db.entries.where("workoutId").equals(workoutId).count();
        const entry: EntryRecord = { ...newRecord(), workoutId, exerciseId: exercise.id, position: count };
        await db.entries.add(entry);
        return {
          id: entry.id,
          exercise: toExercise(exercise),
          plannedSets: [],
          performedSets: [],
          pairs: [],
          nextSet: null,
        };
      });
    },

    async deleteEntry(entryId) {
      await db.transaction("rw", workoutTables(db), async () => {
        await changeableEntry(db, entryId);
        const sets = await liveSetsOf(db, [entryId]);
        if (sets.some((s) => s.kind === "planned")) {
          throw new RangeError("An Entry from the Plan is removed by editing the Plan notation");
        }
        // Like a Workout, the Entry's tombstone hides its Sets.
        await db.entries.update(entryId, { deleted: true, updatedAt: now() });
      });
    },

    async addPerformedSet(entryId, values) {
      checkSetValues(values);
      return db.transaction("rw", workoutTables(db), async () => {
        await changeableEntry(db, entryId);
        return recordPerformedSet(entryId, values);
      });
    },

    async confirmPlannedSet(entryId) {
      return db.transaction("rw", workoutTables(db), async () => {
        await changeableEntry(db, entryId);
        const { plannedSets, performedSets } = splitSets(await liveSetsOf(db, [entryId]));
        const finished = false; // changeableEntry refuses an Entry of a Finished Workout
        const next = pairByOrder(plannedSets, performedSets, finished).find((pair) => pair.performed === null)?.planned;
        if (!next) throw new RangeError(`No Planned Set left to perform in Entry ${entryId}`);
        return recordPerformedSet(entryId, { weight: next.weight, reps: next.reps });
      });
    },

    async editPerformedSet(setId, { weight, reps }) {
      checkSetValues({ weight, reps });
      await db.transaction("rw", workoutTables(db), async () => {
        await changeablePerformedSet(db, setId);
        await db.sets.update(setId, { weight, reps, updatedAt: now() });
      });
    },

    async deletePerformedSet(setId) {
      await db.transaction("rw", workoutTables(db), async () => {
        const set = await changeablePerformedSet(db, setId);
        // Deleting from the middle would re-pair every Set after it with another Planned Set.
        const last = (await liveSetsOf(db, [set.entryId])).filter((s) => s.kind === "performed").at(-1);
        if (last?.id !== setId) {
          throw new RangeError(`Performed Set ${setId} isn't the last of its Entry, and only the last can be deleted`);
        }
        await db.sets.update(setId, { deleted: true, updatedAt: now() });
      });
    },

    async setRpe(setId, rpe) {
      checkRpe(rpe);
      await db.transaction("rw", workoutTables(db), async () => {
        // A Planned Set's record holds its Target RPE in the same place; the Plan notation changes that.
        await changeablePerformedSet(db, setId);
        await db.sets.update(setId, { rpe, updatedAt: now() });
      });
    },

    async setComment(setId, text) {
      await db.transaction("rw", workoutTables(db), async () => {
        await changeablePerformedSet(db, setId);
        await db.sets.update(setId, { comment: text.trim() || null, updatedAt: now() });
      });
    },

    async setPlan(workoutId, notation) {
      const lines = parsePlan(notation);
      await db.transaction("rw", [db.workouts, db.exercises, db.entries, db.sets], async () => {
        await changeableWorkout(db, workoutId);
        const entries = await liveEntriesOf(db, [workoutId]);
        const sets = await liveSetsOf(db, entries.map((e) => e.id));
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
          // A group's Target RPE is for its first Set.
          const plannedSets = line.groups.flatMap(({ weight, reps, sets, targetRpe }) =>
            Array.from({ length: sets }, (_, i) => ({ weight, reps, targetRpe: i === 0 ? targetRpe : null })),
          );
          await db.sets.bulkAdd(
            plannedSets.map((set, i): SetRecord => ({
              ...newRecord(),
              entryId: entry.id,
              kind: "planned",
              position: i,
              weight: set.weight,
              reps: set.reps,
              rpe: set.targetRpe,
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
  return { id: record.id, date: record.date, finished: record.finished === true };
}
