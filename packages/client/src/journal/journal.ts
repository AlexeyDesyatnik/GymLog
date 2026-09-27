import { checkRpe, checkSetValues, exerciseNameKey, formatPlanLine, parsePlan, type PlanLine } from "@gymlog/shared";
import type { EntryRecord, ExerciseRecord, LocalDate, SetRecord, SyncedRecord, WorkoutRecord } from "@gymlog/shared";
import {
  entryView,
  pairByOrder,
  splitSets,
  substitutionRefusal,
  toExercise,
  toPerformedSet,
} from "./entryView.ts";
import { newId } from "./ids.ts";
import {
  changeableEntry,
  changeablePerformedSet,
  changeableWorkout,
  liveEntriesOf,
  liveSetsOf,
  liveSubstituteOf,
  liveWorkout,
  openStore,
  previousSubstitutesFor,
  recordableEntry,
  workoutTables,
  type StoreState,
} from "./store.ts";

export type { StoreState };

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
  /** The planned reps, or the lowest count of a Rep range. */
  reps: number;
  /** The highest count of a Rep range; null when the reps are one count. */
  maxReps: number | null;
  /** The RPE this Set aims for, given only on the first Set of a group; null otherwise. */
  targetRpe: number | null;
}

/** A Planned Set and the Performed Set paired with it; either side may be missing. */
export interface SetPair {
  planned: PlannedSet | null;
  performed: PerformedSet | null;
  /** A Planned Set with no Performed Set, in a Finished Workout, of an Entry not replaced. Derived, never stored. */
  notPerformed: boolean;
  /** A Planned Set of an Entry replaced by a Substitute. Derived, never stored. */
  replaced: boolean;
  /** A Performed Set at its Planned Set's weight, with its Reps or Reps within its Rep range. */
  asPlanned: boolean;
}

export interface Entry {
  id: string;
  exercise: Exercise;
  plannedSets: PlannedSet[];
  performedSets: PerformedSet[];
  /** Planned and Performed Sets paired by order: every Set of the Entry is in exactly one pair. */
  pairs: SetPair[];
  /** The numbers the next Performed Set starts from (number prefill), or null when there are none. */
  nextSet: NextSet | null;
  /** The Exercise of the Substitute performed instead of this Entry; its Planned Sets count as replaced. */
  replacedBy: Exercise | null;
  /** For a Substitute, the Exercise of the Entry it replaces. */
  replaces: Exercise | null;
  /** It can be replaced by a Substitute: a planned Entry, not replaced, with no Performed Sets, in a Workout not Finished. */
  substitutable: boolean;
}

/** Number prefill for the next Performed Set; reps are null when the user must give them (a Rep range). */
export interface NextSet {
  weight: number | null;
  reps: number | null;
}

export interface WorkoutWithEntries extends Workout {
  entries: Entry[];
  /** The Plan in Plan notation, one line per planned Entry; empty when there is no Plan. */
  planNotation: string;
}

/**
 * The single interface the UI uses for everything a user does with their Workouts. A change
 * that fails, whether the store can't carry it out or the Journal refuses it, rejects with
 * ChangeNotSaved; the one exception is OwnExerciseRefusal.
 */
export interface Journal {
  /** The state of the local store on this device; calls wait while it is opening or blocked. */
  storeState(): StoreState;
  /** Calls the listener on every change of the store's state; returns a function that stops it. */
  onStoreStateChange(listener: () => void): () => void;
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
  /**
   * Replaces a whole planned Entry that has no Performed Sets with a Substitute of another Exercise,
   * placed right after it. The Substitute starts with no Sets, and the Plan is unchanged.
   * Refused with OwnExerciseRefusal when the name is one of the Entry's own Exercise.
   */
  substituteEntry(entryId: string, exerciseName: string): Promise<Entry>;
  /**
   * Exercises to replace this Entry with, matching the typed text by any name: first those used
   * before as a Substitute for its Exercise, most recently used first; never its own Exercise.
   */
  suggestSubstitutes(entryId: string, text: string): Promise<Exercise[]>;
  /** Deletes an Entry added on the fly or a Substitute; its Sets go with it, hidden by the Entry's tombstone. */
  deleteEntry(entryId: string): Promise<void>;
  addPerformedSet(entryId: string, values: SetValues): Promise<PerformedSet>;
  /**
   * Records the next unpaired Planned Set as done: a Performed Set with its weight and reps.
   * Refused for a Planned Set with a Rep range, whose Reps done must be given.
   */
  confirmPlannedSet(entryId: string): Promise<PerformedSet>;
  editPerformedSet(setId: string, values: SetValues): Promise<void>;
  deletePerformedSet(setId: string): Promise<void>;
  /** Sets RPE to a value on RPE_SCALE, or clears it with null. */
  setRpe(setId: string, rpe: number | null): Promise<void>;
  /** Sets the Comment; blank text clears it. */
  setComment(setId: string, text: string): Promise<void>;
  /**
   * Replaces the Workout's Plan with the understood lines of this Plan notation, and
   * reports how each non-empty line was understood. Each line takes, in order, the next
   * planned Entry of its Exercise, which keeps its Performed Sets; a planned Entry left
   * without a line stays for its Performed Sets or is removed. Refused for a Finished Workout.
   */
  setPlan(workoutId: string, notation: string): Promise<PlanLine[]>;
  close(): void;
}

/**
 * Substituting an Entry by its own Exercise, however it is typed. The one refusal the UI
 * can't foresee, since only the Journal knows every name of an Exercise.
 */
export class OwnExerciseRefusal extends RangeError {
  constructor() {
    super("A Substitute is of another Exercise");
    this.name = "OwnExerciseRefusal";
  }
}

/** A change that failed and left nothing saved; the cause says why. */
export class ChangeNotSaved extends Error {
  constructor(cause: unknown) {
    super(String(cause), { cause });
    this.name = "ChangeNotSaved";
  }
}

/** Whether each call of the Journal changes what is stored; the compiler keeps it complete. */
const CHANGES: Record<keyof Journal, boolean> = {
  storeState: false,
  onStoreStateChange: false,
  createWorkout: true,
  listWorkouts: false,
  getWorkout: false,
  changeWorkoutDate: true,
  deleteWorkout: true,
  finishWorkout: true,
  undoFinishing: true,
  addEntry: true,
  substituteEntry: true,
  suggestSubstitutes: false,
  deleteEntry: true,
  addPerformedSet: true,
  confirmPlannedSet: true,
  editPerformedSet: true,
  deletePerformedSet: true,
  setRpe: true,
  setComment: true,
  setPlan: true,
  close: false,
};

/** The Journal, with each failed change rejecting as ChangeNotSaved. */
function reportingUnsavedChanges(journal: Journal): Journal {
  const reporting: Record<string, unknown> = { ...journal };
  for (const [name, changes] of Object.entries(CHANGES)) {
    if (!changes) continue;
    const change = journal[name as keyof Journal] as (...args: unknown[]) => Promise<unknown>;
    reporting[name] = (...args: unknown[]) =>
      change(...args).catch((error: unknown) => {
        throw error instanceof OwnExerciseRefusal ? error : new ChangeNotSaved(error);
      });
  }
  return reporting as unknown as Journal;
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
  let currentStoreState: StoreState = { status: "opening" };
  const storeStateListeners = new Set<() => void>();
  let closed = false;
  const db = openStore(name, (state) => {
    // Closing cancels the opening; that isn't a failure anyone needs to hear about.
    if (closed) return;
    currentStoreState = state;
    for (const listener of storeStateListeners) listener();
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

  return reportingUnsavedChanges({
    storeState: () => currentStoreState,

    onStoreStateChange(listener) {
      storeStateListeners.add(listener);
      return () => storeStateListeners.delete(listener);
    },

    async createWorkout(date) {
      const record: WorkoutRecord = { ...newRecord(), date, createdAt: now(), finished: false };
      await db.workouts.add(record);
      return toWorkout(record);
    },

    async listWorkouts() {
      const records = (await db.workouts.orderBy("[date+createdAt]").reverse().toArray()).filter((r) => !r.deleted);
      const entries = await liveEntriesOf(db, records.map((r) => r.id));
      const exercises = await db.exercises.bulkGet(entries.map((e) => e.exerciseId));
      // A replaced Entry wasn't performed; its Substitute names the Exercise that was.
      const replacedIds = new Set(entries.flatMap((e) => e.substitutesEntryId ?? []));
      return records.map((record) => {
        // Keyed by Exercise, so each is named once, where it first appears.
        const primaryNameByExerciseId = new Map<string, string>();
        entries.forEach((entry, i) => {
          if (entry.workoutId === record.id && !replacedIds.has(entry.id)) {
            primaryNameByExerciseId.set(entry.exerciseId, exercises[i]!.primaryName);
          }
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
      const exerciseByEntryId = new Map(entries.map((entry, i) => [entry.id, toExercise(exercises[i]!)]));
      const views = entries.map((entry, i) =>
        entryView(entry, exercises[i]!, sets.filter((s) => s.entryId === entry.id), workout.finished, {
          replacedBy: substituteOf(entries, entry.id, exerciseByEntryId),
          // A Substitute whose replaced Entry is gone is an ordinary Entry.
          replaces: (entry.substitutesEntryId && exerciseByEntryId.get(entry.substitutesEntryId)) || null,
        }),
      );
      return {
        ...workout,
        entries: views,
        planNotation: views
          .filter((entry) => entry.plannedSets.length > 0)
          .map((entry) => formatPlanLine(entry.exercise.primaryName, entry.plannedSets))
          .join("\n"),
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
          replacedBy: null,
          replaces: null,
          substitutable: false,
        };
      });
    },

    async substituteEntry(entryId, exerciseName) {
      return db.transaction("rw", [db.workouts, db.exercises, db.entries, db.sets], async () => {
        const replaced = await changeableEntry(db, entryId);
        const refusal = substitutionRefusal(await liveSetsOf(db, [entryId]), !!(await liveSubstituteOf(db, entryId)));
        if (refusal) throw new RangeError(refusal);
        const entries = await liveEntriesOf(db, [replaced.workoutId]);
        const exercise = await findOrCreateExercise(exerciseName);
        if (exercise.id === replaced.exerciseId) throw new OwnExerciseRefusal();
        const time = now();
        // Later Entries move down to make room right after the replaced one.
        for (const later of entries.filter((e) => e.position > replaced.position)) {
          await db.entries.update(later.id, { position: later.position + 1, updatedAt: time });
        }
        const entry: EntryRecord = {
          ...newRecord(),
          workoutId: replaced.workoutId,
          exerciseId: exercise.id,
          position: replaced.position + 1,
          substitutesEntryId: replaced.id,
        };
        await db.entries.add(entry);
        const replacedExercise = (await db.exercises.get(replaced.exerciseId))!;
        const finished = false; // changeableEntry refuses an Entry of a Finished Workout
        return entryView(entry, exercise, [], finished, { replacedBy: null, replaces: toExercise(replacedExercise) });
      });
    },

    async suggestSubstitutes(entryId, text) {
      const entry = await db.entries.get(entryId);
      if (!entry || entry.deleted) throw new RangeError(`No Entry ${entryId}`);
      const key = exerciseNameKey(text);
      const matching = (await db.exercises.toArray()).filter(
        (e) => !e.deleted && e.id !== entry.exerciseId && e.nameKeys.some((name) => name.includes(key)),
      );
      const rank = new Map((await previousSubstitutesFor(db, entry.exerciseId)).map((id, i) => [id, i]));
      // The rest go by name until suggestions are ranked by use.
      return matching
        .sort(
          (a, b) =>
            (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size) ||
            a.primaryName.localeCompare(b.primaryName, "ru"),
        )
        .map(toExercise);
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
        await recordableEntry(db, entryId);
        return recordPerformedSet(entryId, values);
      });
    },

    async confirmPlannedSet(entryId) {
      return db.transaction("rw", workoutTables(db), async () => {
        await recordableEntry(db, entryId);
        const { plannedSets, performedSets } = splitSets(await liveSetsOf(db, [entryId]));
        // recordableEntry refuses an Entry of a Finished Workout and a replaced Entry.
        const pairs = pairByOrder(plannedSets, performedSets, { finished: false, replaced: false });
        const next = pairs.find((pair) => pair.performed === null)?.planned;
        if (!next) throw new RangeError(`No Planned Set left to perform in Entry ${entryId}`);
        if (next.maxReps !== null) {
          throw new RangeError("A Planned Set with a Rep range can't be Confirmed: the Reps done must be given");
        }
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
        const oldPlannedSets = sets.filter((s) => s.kind === "planned");
        const plannedEntryIds = new Set(oldPlannedSets.map((s) => s.entryId));
        const performedEntryIds = new Set(sets.filter((s) => s.kind === "performed").map((s) => s.entryId));
        const time = now();

        // The old Planned Sets all go; each line then takes, in order, the next planned Entry of its Exercise.
        for (const set of oldPlannedSets) await db.sets.update(set.id, { deleted: true, updatedAt: time });
        const unmatched = entries.filter((e) => plannedEntryIds.has(e.id));
        /** The Workout's Entries in their new order. */
        const ordered: EntryRecord[] = [];
        for (const line of lines) {
          if (!line.ok) continue;
          const exercise = await findOrCreateExercise(line.exerciseName);
          const matchIndex = unmatched.findIndex((e) => e.exerciseId === exercise.id);
          let entry: EntryRecord;
          if (matchIndex >= 0) {
            entry = unmatched.splice(matchIndex, 1)[0]!;
          } else {
            entry = { ...newRecord(), workoutId, exerciseId: exercise.id, position: ordered.length };
            await db.entries.add(entry);
          }
          ordered.push(entry);
          // A Substitute stays right after the Entry it replaces.
          const substitute = entries.find((e) => e.substitutesEntryId === entry.id);
          if (substitute) ordered.push(substitute);
          // A group's Target RPE is for its first Set.
          const plannedSets = line.groups.flatMap(({ weight, reps, maxReps, sets, targetRpe }) =>
            Array.from({ length: sets }, (_, i) => ({ weight, reps, maxReps, targetRpe: i === 0 ? targetRpe : null })),
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
              maxReps: set.maxReps,
            })),
          );
        }

        // An unmatched Entry is kept for its Performed Sets, otherwise removed.
        const removed = unmatched.filter((e) => !performedEntryIds.has(e.id));
        for (const entry of removed) await db.entries.update(entry.id, { deleted: true, updatedAt: time });
        // Entries outside the Plan stay after it, in their order.
        ordered.push(...entries.filter((e) => !ordered.includes(e) && !removed.includes(e)));
        for (const [position, entry] of ordered.entries()) {
          if (entry.position !== position) await db.entries.update(entry.id, { position, updatedAt: time });
        }
      });
      return lines;
    },

    close() {
      closed = true;
      db.close();
    },
  });
}

/** The Exercise of the live Substitute performed instead of this Entry, if there is one. */
function substituteOf(
  entries: EntryRecord[],
  entryId: string,
  exerciseByEntryId: Map<string, Exercise>,
): Exercise | null {
  const substitute = entries.find((e) => e.substitutesEntryId === entryId);
  return substitute ? exerciseByEntryId.get(substitute.id)! : null;
}

function toWorkout(record: WorkoutRecord): Workout {
  return { id: record.id, date: record.date, finished: record.finished === true };
}
