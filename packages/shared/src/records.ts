import type { LocalDate } from "./local-date.ts";

/**
 * Fields every synced record carries (parent spec, Records). The owner is added
 * together with sign-in in the sync ticket.
 */
export interface SyncedRecord {
  /** Generated on the client, so resending a record never duplicates it. */
  id: string;
  /** Device time of the last change, in milliseconds. */
  updatedAt: number;
  /** Tombstone: deleted records are kept so the deletion can sync. */
  deleted: boolean;
}

export interface WorkoutRecord extends SyncedRecord {
  date: LocalDate;
  createdAt: number;
  /** Missing on Workouts recorded before finishing existed; missing means not Finished. */
  finished?: boolean;
}

export interface ExerciseRecord extends SyncedRecord {
  primaryName: string;
  alternativeNames: string[];
  /** The Primary and Alternative names, normalised for lookup (see exerciseNameKey). */
  nameKeys: string[];
}

export interface EntryRecord extends SyncedRecord {
  workoutId: string;
  exerciseId: string;
  /** Order within the Workout. */
  position: number;
}

export interface SetRecord extends SyncedRecord {
  entryId: string;
  kind: "planned" | "performed";
  /** Order within the Entry. */
  position: number;
  /** kg; null for a bodyweight Set. */
  weight: number | null;
  reps: number;
  /**
   * A Performed Set's RPE, a value on RPE_SCALE (4 means "below 5", never exactly 4); for a
   * Planned Set, its Target RPE.
   */
  rpe: number | null;
  comment: string | null;
  /**
   * A Planned Set's Rep range: `reps` is its lowest count and this its highest. Null or missing
   * (on Sets recorded before Rep ranges existed) for a single count and for a Performed Set.
   */
  maxReps?: number | null;
}
