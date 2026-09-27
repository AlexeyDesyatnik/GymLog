/** Rules for record values, shared so the client and the server check them the same way. */

import { localDate } from "./local-date.ts";
import { RECORD_TYPES, type RecordType, type SyncRecord } from "./records.ts";

/** Weight is optional and never negative; reps are completed repetitions, a whole number from 0. */
export function checkSetValues({ weight, reps }: { weight: number | null; reps: number }): void {
  if (weight !== null && !(Number.isFinite(weight) && weight >= 0)) {
    throw new RangeError(`Weight must be a number of kg from 0, not ${weight}`);
  }
  if (!(Number.isInteger(reps) && reps >= 0)) {
    throw new RangeError(`Reps must be a whole number from 0, not ${reps}`);
  }
}

/** RPE "below 5" is stored as 4, which never means exactly 4. */
export const RPE_BELOW_5 = 4;

/** Every RPE value, in order: below 5, whole numbers to 7, then half steps to 10. */
export const RPE_SCALE: readonly number[] = [RPE_BELOW_5, 5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** A Target RPE is on the scale above "below 5". */
export const TARGET_RPE_SCALE: readonly number[] = RPE_SCALE.filter((value) => value !== RPE_BELOW_5);

/** RPE is a value on the scale, or null when not given. */
export function checkRpe(rpe: number | null): void {
  if (rpe !== null && !RPE_SCALE.includes(rpe)) {
    const scale = RPE_SCALE.map((value) => (value === RPE_BELOW_5 ? "below 5" : String(value))).join(", ");
    throw new RangeError(`RPE must be one of ${scale}, not ${rpe}`);
  }
}

/** Exercise names match ignoring case and extra spaces. */
export function exerciseNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

/** The longest login; any characters, spaces inside included. */
export const LOGIN_MAX_LENGTH = 40;
/** The shortest password; no other rules (ADR 0007). */
export const PASSWORD_MIN_LENGTH = 8;
/** The longest password, so hashing one can't be made to take long. */
export const PASSWORD_MAX_LENGTH = 200;

/** Logins match ignoring case and extra spaces, like Exercise names. */
export function loginKey(login: string): string {
  return exerciseNameKey(login);
}

/** A login is some text, not blank, up to LOGIN_MAX_LENGTH characters once trimmed. */
export function checkLogin(login: unknown): asserts login is string {
  must(typeof login === "string" && login.trim() !== "", "A login is needed");
  must(login.trim().length <= LOGIN_MAX_LENGTH, `A login is at most ${LOGIN_MAX_LENGTH} characters`);
}

/** A password is at least PASSWORD_MIN_LENGTH characters, and at most PASSWORD_MAX_LENGTH. */
export function checkPassword(password: unknown): asserts password is string {
  must(typeof password === "string", "A password is needed");
  must(password.length >= PASSWORD_MIN_LENGTH, `A password is at least ${PASSWORD_MIN_LENGTH} characters`);
  must(password.length <= PASSWORD_MAX_LENGTH, `A password is at most ${PASSWORD_MAX_LENGTH} characters`);
}

/** An id generated on a device: a UUID. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fields each type of record may have, beyond its type and owner; the others are refused. */
const FIELDS: Record<RecordType, readonly string[]> = {
  workout: ["id", "updatedAt", "deleted", "date", "createdAt", "finished"],
  exercise: ["id", "updatedAt", "deleted", "primaryName", "alternativeNames", "nameKeys"],
  entry: ["id", "updatedAt", "deleted", "workoutId", "exerciseId", "position", "substitutesEntryId"],
  set: ["id", "updatedAt", "deleted", "entryId", "kind", "position", "weight", "reps", "rpe", "comment", "maxReps"],
};

/**
 * A record sent by a device, checked field by field; throws a RangeError saying what is wrong.
 * A Set is checked by its kind: a Planned Set's `rpe` is its Target RPE and its `maxReps` the
 * top of a Rep range.
 */
export function checkSyncRecord(value: unknown): SyncRecord {
  const record = objectOf(value);
  const type = record.type as RecordType;
  must(RECORD_TYPES.includes(type), `Unknown record type ${JSON.stringify(record.type)}`);
  const unknown = Object.keys(record).filter(
    (key) => key !== "type" && key !== "ownerId" && !FIELDS[type].includes(key),
  );
  must(unknown.length === 0, `A ${type} record has no field ${unknown.join(", ")}`);
  mustBeId(record.id, "id");
  mustBeId(record.ownerId, "ownerId");
  must(Number.isFinite(record.updatedAt), "updatedAt must be a time in milliseconds");
  must(typeof record.deleted === "boolean", "deleted must be true or false");
  switch (type) {
    case "workout":
      must(typeof record.date === "string", "A Workout's date must be YYYY-MM-DD");
      localDate(record.date as string);
      must(Number.isFinite(record.createdAt), "createdAt must be a time in milliseconds");
      // Missing on Workouts recorded before finishing existed, which aren't Finished.
      must(record.finished === undefined || typeof record.finished === "boolean", "finished must be true or false");
      break;
    case "exercise":
      must(
        typeof record.primaryName === "string" && record.primaryName.trim() !== "",
        "An Exercise needs a Primary name",
      );
      mustBeStrings(record.alternativeNames, "alternativeNames");
      mustBeStrings(record.nameKeys, "nameKeys");
      break;
    case "entry":
      mustBeId(record.workoutId, "workoutId");
      mustBeId(record.exerciseId, "exerciseId");
      mustBePosition(record.position);
      if (record.substitutesEntryId !== undefined) mustBeId(record.substitutesEntryId, "substitutesEntryId");
      break;
    case "set":
      checkSet(record);
      break;
  }
  return record as unknown as SyncRecord;
}

function checkSet(set: Record<string, unknown>): void {
  must(set.kind === "planned" || set.kind === "performed", "A Set's kind must be planned or performed");
  mustBeId(set.entryId, "entryId");
  mustBePosition(set.position);
  must(set.weight === null || typeof set.weight === "number", "weight must be a number or null");
  must(typeof set.reps === "number", "reps must be a number");
  checkSetValues({ weight: set.weight as number | null, reps: set.reps as number });
  must(set.comment === null || typeof set.comment === "string", "comment must be text or null");
  must(set.rpe === null || typeof set.rpe === "number", "rpe must be a number or null");
  // Missing on Sets recorded before Rep ranges existed, which means a single count.
  const maxReps = set.maxReps ?? null;
  if (set.kind === "performed") {
    checkRpe(set.rpe as number | null);
    must(maxReps === null, "A Performed Set has no Rep range");
    return;
  }
  must((set.reps as number) >= 1, `A Planned Set needs at least 1 rep, not ${set.reps}`);
  must(
    set.rpe === null || TARGET_RPE_SCALE.includes(set.rpe as number),
    `A Target RPE must be one of ${TARGET_RPE_SCALE.join(", ")}, not ${set.rpe}`,
  );
  must(
    maxReps === null || (Number.isInteger(maxReps) && (maxReps as number) > (set.reps as number)),
    `A Rep range's highest count must be a whole number above its lowest, not ${maxReps}`,
  );
}

function objectOf(value: unknown): Record<string, unknown> {
  must(typeof value === "object" && value !== null && !Array.isArray(value), "A record must be an object");
  return value as Record<string, unknown>;
}

function mustBeId(value: unknown, field: string): void {
  must(typeof value === "string" && ID.test(value), `${field} must be a UUID`);
}

function mustBePosition(value: unknown): void {
  must(Number.isInteger(value) && (value as number) >= 0, "position must be a whole number from 0");
}

function mustBeStrings(value: unknown, field: string): void {
  must(Array.isArray(value) && value.every((item) => typeof item === "string"), `${field} must be a list of text`);
}

function must(condition: boolean, problem: string): asserts condition {
  if (!condition) throw new RangeError(problem);
}
