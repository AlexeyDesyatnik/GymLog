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
  /** The RPE this Set aims for, given only on the first Set of a group; null otherwise. */
  targetRpe: number | null;
}

/** A Planned Set and the Performed Set paired with it; either side may be missing. */
export interface SetPair {
  planned: PlannedSet | null;
  performed: PerformedSet | null;
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

  /** The live Sets of these Entries, in order. */
  async function liveSetsOf(entryIds: string[]): Promise<SetRecord[]> {
    return (await db.sets.where("entryId").anyOf(entryIds).toArray())
      .filter((s) => !s.deleted)
      .sort((a, b) => a.position - b.position);
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
      const sets = await liveSetsOf(entries.map((e) => e.id));
      const views: Entry[] = entries.map((entry, i) => {
        const plannedSets = sets.filter((s) => s.entryId === entry.id && s.kind === "planned").map(toPlannedSet);
        const performedSets = sets.filter((s) => s.entryId === entry.id && s.kind === "performed").map(toPerformedSet);
        const pairs = pairByOrder(plannedSets, performedSets);
        return {
          id: entry.id,
          exercise: toExercise(exercises[i]!),
          plannedSets,
          performedSets,
          pairs,
          nextSet: nextSetOf(pairs),
        };
      });
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
      await db.transaction("rw", [db.entries, db.sets], async () => {
        const entry = await db.entries.get(entryId);
        if (!entry || entry.deleted) throw new RangeError(`No Entry ${entryId}`);
        const sets = await db.sets.where("entryId").equals(entryId).toArray();
        if (sets.some((s) => !s.deleted && s.kind === "planned")) {
          throw new RangeError("An Entry from the Plan is removed by editing the Plan notation");
        }
        // Like a Workout, the Entry's tombstone hides its Sets.
        await db.entries.update(entryId, { deleted: true, updatedAt: now() });
      });
    },

    async addPerformedSet(entryId, values) {
      checkSetValues(values);
      return db.transaction("rw", db.sets, () => recordPerformedSet(entryId, values));
    },

    async confirmPlannedSet(entryId) {
      return db.transaction("rw", db.sets, async () => {
        const sets = await liveSetsOf([entryId]);
        const next = pairByOrder(
          sets.filter((s) => s.kind === "planned").map(toPlannedSet),
          sets.filter((s) => s.kind === "performed").map(toPerformedSet),
        ).find((pair) => pair.performed === null)?.planned;
        if (!next) throw new RangeError(`No Planned Set left to perform in Entry ${entryId}`);
        return recordPerformedSet(entryId, { weight: next.weight, reps: next.reps });
      });
    },

    async editPerformedSet(setId, { weight, reps }) {
      checkSetValues({ weight, reps });
      await db.sets.update(setId, { weight, reps, updatedAt: now() });
    },

    async deletePerformedSet(setId) {
      await db.transaction("rw", db.sets, async () => {
        const set = await db.sets.get(setId);
        if (!set || set.deleted || set.kind !== "performed") throw new RangeError(`No Performed Set ${setId}`);
        // Deleting from the middle would re-pair every Set after it with another Planned Set.
        const last = (await liveSetsOf([set.entryId])).filter((s) => s.kind === "performed").at(-1);
        if (last?.id !== setId) {
          throw new RangeError(`Performed Set ${setId} isn't the last of its Entry, and only the last can be deleted`);
        }
        await db.sets.update(setId, { deleted: true, updatedAt: now() });
      });
    },

    async setRpe(setId, rpe) {
      checkRpe(rpe);
      await db.transaction("rw", db.sets, async () => {
        // A Planned Set's record holds its Target RPE in the same place; the Plan notation changes that.
        const set = await db.sets.get(setId);
        if (!set || set.deleted || set.kind !== "performed") throw new RangeError(`No Performed Set ${setId}`);
        await db.sets.update(setId, { rpe, updatedAt: now() });
      });
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
        const sets = await liveSetsOf(entries.map((e) => e.id));
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
  return { id: record.id, date: record.date };
}

function toExercise(record: ExerciseRecord): Exercise {
  return { id: record.id, primaryName: record.primaryName };
}

function toPerformedSet(record: SetRecord): PerformedSet {
  return { id: record.id, weight: record.weight, reps: record.reps, rpe: record.rpe, comment: record.comment };
}

function toPlannedSet(record: SetRecord): PlannedSet {
  return { id: record.id, weight: record.weight, reps: record.reps, targetRpe: record.rpe };
}

function pairByOrder(planned: PlannedSet[], performed: PerformedSet[]): SetPair[] {
  return Array.from({ length: Math.max(planned.length, performed.length) }, (_, i) => ({
    planned: planned[i] ?? null,
    performed: performed[i] ?? null,
  }));
}

function nextSetOf(pairs: SetPair[]): SetValues | null {
  const nextIndex = pairs.findIndex((pair) => pair.performed === null);
  const next = pairs[nextIndex]?.planned;
  if (next) {
    // A weight changed from the Plan carries on to Planned Sets of the same planned weight;
    // the reps stay the Plan's.
    const previous = pairs[nextIndex - 1];
    const carried =
      previous?.planned && previous.performed && previous.planned.weight === next.weight
        ? previous.performed.weight
        : next.weight;
    return { weight: carried, reps: next.reps };
  }
  // Past the Plan, or with none, repeating the previous Set is one tap.
  const previous = pairs.at(-1)?.performed;
  return previous ? { weight: previous.weight, reps: previous.reps } : null;
}

/** Re-editing a Plan with recorded Sets needs reconciliation, which comes in a later ticket. */
function isPlanLocked(sets: SetRecord[]): boolean {
  return sets.some((s) => s.kind === "performed");
}
