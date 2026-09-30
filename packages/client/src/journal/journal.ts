import {
  checkRpe,
  checkSetValues,
  daysBefore,
  exerciseNameKey,
  formatPlanLine,
  monthsBefore,
  parsePlan,
  type PlanLine,
} from "@gymlog/shared";
import type { EntryRecord, ExerciseRecord, LocalDate, SetRecord, SyncedRecord, WorkoutRecord } from "@gymlog/shared";
import {
  entryView,
  pairByOrder,
  splitSets,
  substitutionRefusal,
  toExercise,
  toPerformedSet,
} from "./entryView.ts";
import { openAccess, type Access } from "../sync/access.ts";
import { openSync, type Sync, type SyncOptions, type SyncState } from "../sync/sync.ts";
import { newId } from "./ids.ts";
import {
  changeableEntry,
  changeablePerformedSet,
  changeableWorkout,
  compareWorkoutOrder,
  exercisesMatching,
  exerciseUses,
  liveEntriesOf,
  liveExercise,
  liveSetsOf,
  liveSubstituteOf,
  liveWorkout,
  mergeExercise,
  openStore,
  previousSubstitutesFor,
  recordableEntry,
  withNames,
  workoutTables,
  type StoreState,
} from "./store.ts";

export type { Access, StoreState, Sync, SyncState };

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

/** An Exercise as the Exercise catalog shows it. */
export interface CatalogExercise extends Exercise {
  alternativeNames: string[];
  /** The live Workouts with an Entry of it; an Exercise used in any has history. */
  workoutCount: number;
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
 * ChangeNotSaved; the exceptions are the Refusals the UI can't foresee.
 */
export interface Journal {
  /** The state of the local store on this device; calls wait while it is opening or blocked. */
  storeState(): StoreState;
  /** Calls the listener on every change of the store's state; returns a function that stops it. */
  onStoreStateChange(listener: () => void): () => void;
  createWorkout(date: LocalDate): Promise<Workout>;
  /**
   * Creates a Workout on this date whose Plan is a copy of the Template's: its planned Entries with
   * their Planned Sets, Target RPEs and Rep ranges. A Template with no Plan gives its Performed Sets
   * as Planned Sets, weight and reps only. Nothing else is copied: no Substitutes, Entries added
   * on the fly, Performed Sets, RPE or Comments.
   */
  createFromTemplate(templateId: string, date: LocalDate): Promise<Workout>;
  /**
   * The Workouts that can serve as the Template of a new Workout on this date: those with a Plan or
   * Performed Sets to copy. First the one offered by default: the Workout a week before the date,
   * otherwise the most recent one before it; then the others as listWorkouts orders them.
   */
  templatesFor(date: LocalDate): Promise<WorkoutSummary[]>;
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
   * Exercises with a name, of any of theirs, in which the typed text starts a word, ignoring case:
   * first those used in Workouts dated within the last three months up to today, by number of
   * such Workouts, then those used earlier, each by most recent use; then those never used, by
   * name. Each name comes once. Only names are suggested; the numbers are the user's to type.
   */
  suggestExercises(text: string, today: LocalDate): Promise<Exercise[]>;
  /**
   * Exercises to replace this Entry with, matched like suggestExercises: first those used before
   * as a Substitute for its Exercise, most recently used first, then the others as
   * suggestExercises ranks them; never its own Exercise under any of its names.
   */
  suggestSubstitutes(entryId: string, text: string, today: LocalDate): Promise<Exercise[]>;
  /**
   * The Exercise catalog, by Primary name; with text, only the Exercises with a name in which it
   * starts a word, ignoring case, as suggestExercises matches them.
   */
  listExercises(text?: string): Promise<CatalogExercise[]>;
  /**
   * Gives the Exercise a new Primary name; the old one stays as an Alternative name, so it still
   * finds it. Refused with NameTakenRefusal when the name is another Exercise's.
   */
  renameExercise(id: string, primaryName: string): Promise<void>;
  /** Adds a name the Exercise is also found by. Refused with NameTakenRefusal when it is another Exercise's name. */
  addAlternativeName(id: string, name: string): Promise<void>;
  /** Removes an Alternative name, matched ignoring case; the Exercise is no longer found by it. */
  removeAlternativeName(id: string, name: string): Promise<void>;
  /**
   * Merges one Exercise into the target: every Entry of it moves to the target, which keeps
   * its Primary name, and its names become the target's Alternative names. Cannot be undone.
   */
  mergeExercises(mergedId: string, targetId: string): Promise<void>;
  /**
   * Deletes an Exercise with no history: no live Entry of a live Workout is of it. Refused
   * with HasHistoryRefusal otherwise; such an Exercise can only be merged into another.
   */
  deleteExercise(id: string): Promise<void>;
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
  /** Keeps the records here and on the user's other devices in step, by way of the server. */
  readonly sync: Sync;
  /** Who gets in: using an Invite, signing in, and what the Owner does for other Users. */
  readonly access: Access;
  close(): void;
}

/**
 * A change the Journal refuses that the UI can't foresee, since only the Journal knows every
 * name of every Exercise and every use of one. It rejects as itself, not as ChangeNotSaved.
 */
export class Refusal extends RangeError {}

/** Substituting an Entry by its own Exercise, however it is typed. */
export class OwnExerciseRefusal extends Refusal {
  constructor() {
    super("A Substitute is of another Exercise");
    this.name = "OwnExerciseRefusal";
  }
}

/** A name already belongs to another Exercise, ignoring case: within a catalog, a name belongs to at most one. */
export class NameTakenRefusal extends Refusal {
  constructor(
    /** The name as it was given. */
    readonly takenName: string,
    /** The Exercise it belongs to. */
    readonly holder: Exercise,
  ) {
    super(`"${takenName}" is a name of the Exercise ${holder.primaryName}`);
    this.name = "NameTakenRefusal";
  }
}

/** Deleting an Exercise with history, which would lose its Sets; it can be merged into another instead. */
export class HasHistoryRefusal extends Refusal {
  constructor(
    readonly exercise: Exercise,
    /** The live Workouts with an Entry of it. */
    readonly workoutCount: number,
  ) {
    super(`The Exercise ${exercise.primaryName} is used in ${workoutCount} Workouts`);
    this.name = "HasHistoryRefusal";
  }
}

/** A change that failed and left nothing saved; the cause says why. */
export class ChangeNotSaved extends Error {
  constructor(cause: unknown) {
    super(String(cause), { cause });
    this.name = "ChangeNotSaved";
  }
}

/**
 * Whether each call of the Journal changes what is stored. The compiler keeps it complete,
 * and lets only calls that return a promise be marked as changes.
 */
const CHANGES: {
  [Name in keyof Journal]: Journal[Name] extends (...args: never[]) => Promise<unknown> ? boolean : false;
} = {
  storeState: false,
  onStoreStateChange: false,
  createWorkout: true,
  createFromTemplate: true,
  templatesFor: false,
  listWorkouts: false,
  getWorkout: false,
  changeWorkoutDate: true,
  deleteWorkout: true,
  finishWorkout: true,
  undoFinishing: true,
  addEntry: true,
  substituteEntry: true,
  suggestExercises: false,
  suggestSubstitutes: false,
  listExercises: false,
  renameExercise: true,
  addAlternativeName: true,
  removeAlternativeName: true,
  mergeExercises: true,
  deleteExercise: true,
  deleteEntry: true,
  addPerformedSet: true,
  confirmPlannedSet: true,
  editPerformedSet: true,
  deletePerformedSet: true,
  setRpe: true,
  setComment: true,
  setPlan: true,
  sync: false,
  access: false,
  close: false,
};

/** The Journal, with each failed change rejecting as ChangeNotSaved, and each saved one reported. */
function reportingChanges(journal: Journal, onSaved: () => void): Journal {
  const reporting: Record<string, unknown> = { ...journal };
  for (const [name, changes] of Object.entries(CHANGES)) {
    if (!changes) continue;
    const change = journal[name as keyof Journal] as (...args: unknown[]) => Promise<unknown>;
    reporting[name] = (...args: unknown[]) =>
      change(...args).then(
        (result) => {
          onSaved();
          return result;
        },
        (error: unknown) => {
          throw error instanceof Refusal ? error : new ChangeNotSaved(error);
        },
      );
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
  /** The server to sync with; without one, the records stay on this device. */
  server?: SyncOptions;
}

export function openJournal({ name = "gymlog", now = Date.now, server }: JournalOptions = {}): Journal {
  let currentStoreState: StoreState = { status: "opening" };
  const storeStateListeners = new Set<() => void>();
  let closed = false;
  const db = openStore(name, (state) => {
    // Closing cancels the opening; that isn't a failure anyone needs to hear about.
    if (closed) return;
    currentStoreState = state;
    for (const listener of storeStateListeners) listener();
    // Never called before openStore returns, so sync is there by then.
    if (state.status === "ready") sync.start();
  });
  const sync = openSync(db, server, now);

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

  /**
   * The key of a name the Exercise can take: not blank, and no other live Exercise's name.
   * Refused with NameTakenRefusal otherwise.
   */
  async function freeNameKey(name: string, exerciseId: string): Promise<string> {
    const key = exerciseNameKey(name);
    if (!key) throw new RangeError("An Exercise's name can't be blank");
    const holder = await db.exercises
      .where("nameKeys")
      .equals(key)
      .filter((e) => !e.deleted && e.id !== exerciseId)
      .first();
    if (holder) throw new NameTakenRefusal(name.trim(), toExercise(holder));
    return key;
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

  async function listWorkouts(): Promise<WorkoutSummary[]> {
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
  }

  /** Adds an Entry's Planned Sets, in order; call it inside a transaction on the Sets. */
  async function addPlannedSets(entryId: string, plannedSets: Omit<PlannedSet, "id">[]): Promise<void> {
    await db.sets.bulkAdd(
      plannedSets.map((set, i): SetRecord => ({
        ...newRecord(),
        entryId,
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

  return reportingChanges({
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

    async createFromTemplate(templateId, date) {
      return db.transaction("rw", workoutTables(db), async () => {
        await liveWorkout(db, templateId);
        const entries = await liveEntriesOf(db, [templateId]);
        const sets = await liveSetsOf(db, entries.map((e) => e.id));
        const record: WorkoutRecord = { ...newRecord(), date, createdAt: now(), finished: false };
        await db.workouts.add(record);
        const hasPlan = sets.some((s) => s.kind === "planned");
        const copied = entries.map(({ id, exerciseId }) => {
          const { plannedSets, performedSets } = splitSets(sets.filter((s) => s.entryId === id));
          // Without a Plan, what was performed becomes the Plan.
          const planned = hasPlan
            ? plannedSets
            : performedSets.map(({ weight, reps }) => ({ weight, reps, maxReps: null, targetRpe: null }));
          return { exerciseId, planned };
        });
        // Entries with nothing planned, such as Substitutes and those added on the fly, stay behind.
        for (const [position, { exerciseId, planned }] of copied.filter((c) => c.planned.length > 0).entries()) {
          const entry: EntryRecord = { ...newRecord(), workoutId: record.id, exerciseId, position };
          await db.entries.add(entry);
          await addPlannedSets(entry.id, planned);
        }
        return toWorkout(record);
      });
    },

    async templatesFor(date) {
      const workouts = await listWorkouts();
      const entries = await liveEntriesOf(db, workouts.map((w) => w.id));
      const sets = await liveSetsOf(db, entries.map((e) => e.id));
      // Planned or performed, a Set is something to copy.
      const workoutIdByEntryId = new Map(entries.map((e) => [e.id, e.workoutId]));
      const withSets = new Set(sets.map((s) => workoutIdByEntryId.get(s.entryId)));
      const templates = workouts.filter((w) => withSets.has(w.id));
      const weekBefore = daysBefore(date, 7);
      // The list is newest first, so the first found is the most recent.
      const offered =
        templates.find((w) => w.date === weekBefore) ?? templates.find((w) => w.date < date) ?? templates[0];
      return offered ? [offered, ...templates.filter((w) => w !== offered)] : [];
    },

    listWorkouts,

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

    async suggestExercises(text, today) {
      const matching = await exercisesMatching(db, text);
      return oncePerName(matching.sort(byUse(await exerciseUses(db), today))).map(toExercise);
    },

    async suggestSubstitutes(entryId, text, today) {
      const entry = await db.entries.get(entryId);
      if (!entry || entry.deleted) throw new RangeError(`No Entry ${entryId}`);
      const own = (await db.exercises.get(entry.exerciseId))!;
      // Nor any other Exercise of one of its names, which substituting would take for its own.
      const matching = (await exercisesMatching(db, text)).filter(
        (e) => !e.nameKeys.some((name) => own.nameKeys.includes(name)),
      );
      const rank = new Map((await previousSubstitutesFor(db, entry.exerciseId)).map((id, i) => [id, i]));
      const rankByUse = byUse(await exerciseUses(db), today);
      return oncePerName(
        matching.sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size) || rankByUse(a, b)),
      ).map(toExercise);
    },

    async listExercises(text = "") {
      const uses = await exerciseUses(db);
      return (await exercisesMatching(db, text)).sort(byPrimaryName).map((e) => ({
        ...toExercise(e),
        alternativeNames: e.alternativeNames,
        workoutCount: uses.get(e.id)?.length ?? 0,
      }));
    },

    async renameExercise(id, primaryName) {
      await db.transaction("rw", db.exercises, async () => {
        const exercise = await liveExercise(db, id);
        const key = await freeNameKey(primaryName, id);
        // The new name leaves the Alternative names, and the old one joins them unless it is the same name.
        const alternativeNames = [...exercise.alternativeNames, exercise.primaryName].filter(
          (name) => exerciseNameKey(name) !== key,
        );
        await db.exercises.update(id, { ...withNames(primaryName.trim(), alternativeNames), updatedAt: now() });
      });
    },

    async addAlternativeName(id, name) {
      await db.transaction("rw", db.exercises, async () => {
        const exercise = await liveExercise(db, id);
        const key = await freeNameKey(name, id);
        // Already one of its names: nothing to add.
        if (exercise.nameKeys.includes(key)) return;
        const names = withNames(exercise.primaryName, [...exercise.alternativeNames, name.trim()]);
        await db.exercises.update(id, { ...names, updatedAt: now() });
      });
    },

    async removeAlternativeName(id, name) {
      await db.transaction("rw", db.exercises, async () => {
        const exercise = await liveExercise(db, id);
        const key = exerciseNameKey(name);
        const alternativeNames = exercise.alternativeNames.filter((n) => exerciseNameKey(n) !== key);
        if (alternativeNames.length === exercise.alternativeNames.length) return;
        await db.exercises.update(id, { ...withNames(exercise.primaryName, alternativeNames), updatedAt: now() });
      });
    },

    async mergeExercises(mergedId, targetId) {
      if (mergedId === targetId) throw new RangeError("An Exercise is merged into another one");
      await db.transaction("rw", [db.exercises, db.entries], () => mergeExercise(db, mergedId, targetId, now()));
    },

    async deleteExercise(id) {
      await db.transaction("rw", [db.workouts, db.exercises, db.entries], async () => {
        const exercise = await liveExercise(db, id);
        const workoutCount = (await exerciseUses(db)).get(id)?.length ?? 0;
        if (workoutCount > 0) throw new HasHistoryRefusal(toExercise(exercise), workoutCount);
        await db.exercises.update(id, { deleted: true, updatedAt: now() });
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
          await addPlannedSets(entry.id, plannedSets);
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

    sync,

    access: openAccess(server, sync),

    close() {
      closed = true;
      sync.close();
      db.close();
    },
  }, sync.changed);
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

/**
 * Each Primary name once, where it ranks best. Exercises that devices each made of one Primary name
 * before they synced are merged once sync brings them together, but a suggestion is picked by
 * its name even before then.
 */
function oncePerName(ranked: ExerciseRecord[]): ExerciseRecord[] {
  const seen = new Set<string>();
  return ranked.filter((e) => {
    const key = exerciseNameKey(e.primaryName);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** How far back a use of an Exercise counts as recent in suggestion ranking. */
const RECENT_MONTHS = 3;

/**
 * Suggestion ranking: first Exercises used in Workouts dated within the last three months, by
 * number of such Workouts, then older ones, each by most recent use; then those never used, by name.
 */
function byUse(uses: Map<string, WorkoutRecord[]>, today: LocalDate): (a: ExerciseRecord, b: ExerciseRecord) => number {
  const recentSince = monthsBefore(today, RECENT_MONTHS);
  // A Workout planned for after today hasn't used its Exercises yet.
  const usesOf = (exerciseId: string) => (uses.get(exerciseId) ?? []).filter((w) => w.date <= today);
  const recentCount = (exerciseId: string) => usesOf(exerciseId).filter((w) => w.date >= recentSince).length;
  const lastUse = (exerciseId: string) => usesOf(exerciseId).sort(compareWorkoutOrder).at(-1);
  /** The later last use first; any use before none. */
  const byLastUse = (a?: WorkoutRecord, b?: WorkoutRecord) =>
    a && b ? compareWorkoutOrder(b, a) : (b ? 1 : 0) - (a ? 1 : 0);
  return (a, b) =>
    recentCount(b.id) - recentCount(a.id) ||
    byLastUse(lastUse(a.id), lastUse(b.id)) ||
    byPrimaryName(a, b);
}

/** Exercises in the order of their Primary names, Russian ones first. */
function byPrimaryName(a: ExerciseRecord, b: ExerciseRecord): number {
  return a.primaryName.localeCompare(b.primaryName, "ru");
}

function toWorkout(record: WorkoutRecord): Workout {
  return { id: record.id, date: record.date, finished: record.finished === true };
}
