import type { LocalDate } from "./local-date.ts";

/**
 * Fields every synced record carries (parent spec, Records). A device's local store holds
 * one user's records, so the owner is added only when a record is sent (see SyncRecord).
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
  /** For a Substitute, the Entry it was performed instead of; missing for any other Entry. */
  substitutesEntryId?: string;
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

/**
 * Whether a change to a record replaces the version already kept of it, by the rules of sync
 * (ADR 0004) that the server and every device follow alike. Deleting wins over editing: a
 * deleted record never changes again, and deleting replaces any edit. Otherwise the later
 * change wins; on a tie the version kept stays, as the one the server received first.
 */
export function replacesKept(change: SyncedRecord, kept: SyncedRecord): boolean {
  if (kept.deleted) return false;
  return change.deleted || change.updatedAt > kept.updatedAt;
}

/** The kinds of synced record, each kept in a table of its own on the device. */
export const RECORD_TYPES = ["workout", "exercise", "entry", "set"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** A record as sync sends it between a device and the server: tagged with its type and its owner. */
export type SyncRecord =
  | ({ type: "workout"; ownerId: string } & WorkoutRecord)
  | ({ type: "exercise"; ownerId: string } & ExerciseRecord)
  | ({ type: "entry"; ownerId: string } & EntryRecord)
  | ({ type: "set"; ownerId: string } & SetRecord);

/** The server's answer to a push: the records it refused, and why; it took all the others. */
export interface PushAnswer {
  refused: { id: string | null; reason: string }[];
}

/** One page of the records changed after a device's cursor, in the order they were written. */
export interface PullAnswer {
  records: SyncRecord[];
  /** Where the next pull starts. */
  cursor: number;
  /** More records wait after this page. */
  more: boolean;
}

/** Who is signed in on a device, as the server knows from its session. */
export interface SessionAnswer {
  userId: string;
  /** The owner of GymLog, who alone creates Invites. */
  owner: boolean;
}

/** A new Invite the owner created: the token that goes into its link. */
export interface InviteAnswer {
  invite: string;
}

/** Whether an Invite can still make a User: it was made and nobody has used it. */
export interface InviteCheck {
  usable: boolean;
}

/**
 * Why the server refused to make a User, sign someone in or set a new password: the
 * Invite is used up or was never made; the login is someone else's; the login and password
 * don't match (an unknown login says the same, so logins can't be guessed); too many wrong
 * passwords for the Login lately; the Reset link is used, expired or never made.
 */
export type SignInRefusal = "inviteUnusable" | "loginTaken" | "wrongPassword" | "tooManyAttempts" | "resetLinkUnusable";

/** A User as the Owner sees them, in the list where the Owner creates Reset links. */
export interface UserSummary {
  userId: string;
  login: string;
  owner: boolean;
  /** False for a User from before passwords, until a Reset link sets one. */
  hasPassword: boolean;
}

/** A new Reset link the Owner created: the token that goes into it. */
export interface ResetLinkAnswer {
  resetLink: string;
}

/** Whose password a Reset link sets, or null when it is used, expired or was never made. */
export interface ResetLinkCheck {
  login: string | null;
}
