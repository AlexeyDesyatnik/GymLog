import type { EntryRecord, ExerciseRecord, SetRecord } from "@gymlog/shared";
import type { Entry, Exercise, NextSet, PerformedSet, PlannedSet, SetPair } from "./journal.ts";

/** How an Entry takes part in a substitution: the Substitute performed instead of it, or the Entry it replaces. */
export interface Substitution {
  replacedBy: Exercise | null;
  replaces: Exercise | null;
}

/**
 * An Entry as the UI reads it, with everything derived from its live Sets (given in order),
 * whether its Workout is Finished, and its substitution.
 */
export function entryView(
  entry: EntryRecord,
  exercise: ExerciseRecord,
  sets: SetRecord[],
  finished: boolean,
  { replacedBy, replaces }: Substitution,
): Entry {
  const { plannedSets, performedSets } = splitSets(sets);
  const replaced = replacedBy !== null;
  const pairs = pairByOrder(plannedSets, performedSets, finished, replaced);
  return {
    id: entry.id,
    exercise: toExercise(exercise),
    plannedSets,
    performedSets,
    pairs,
    // A replaced Entry takes no Sets: they go to its Substitute.
    nextSet: replaced ? null : nextSetOf(pairs),
    replacedBy,
    replaces,
  };
}

/** An Entry's live Sets (in order), split by kind. */
export function splitSets(sets: SetRecord[]): { plannedSets: PlannedSet[]; performedSets: PerformedSet[] } {
  return {
    plannedSets: sets.filter((s) => s.kind === "planned").map(toPlannedSet),
    performedSets: sets.filter((s) => s.kind === "performed").map(toPerformedSet),
  };
}

export function toExercise(record: ExerciseRecord): Exercise {
  return { id: record.id, primaryName: record.primaryName };
}

export function toPerformedSet(record: SetRecord): PerformedSet {
  return { id: record.id, weight: record.weight, reps: record.reps, rpe: record.rpe, comment: record.comment };
}

function toPlannedSet(record: SetRecord): PlannedSet {
  return {
    id: record.id,
    weight: record.weight,
    reps: record.reps,
    maxReps: record.maxReps ?? null,
    targetRpe: record.rpe,
  };
}

/**
 * Pairs Planned and Performed Sets by order. The Planned Sets of a replaced Entry are replaced;
 * otherwise, in a Finished Workout, a Planned Set left unpaired is Not performed.
 */
export function pairByOrder(
  planned: PlannedSet[],
  performed: PerformedSet[],
  finished: boolean,
  replaced: boolean,
): SetPair[] {
  return Array.from({ length: Math.max(planned.length, performed.length) }, (_, i) => ({
    planned: planned[i] ?? null,
    performed: performed[i] ?? null,
    notPerformed: finished && !replaced && planned[i] !== undefined && performed[i] === undefined,
    replaced: replaced && planned[i] !== undefined,
    asPlanned: isAsPlanned(planned[i], performed[i]),
  }));
}

function isAsPlanned(planned: PlannedSet | undefined, performed: PerformedSet | undefined): boolean {
  if (!planned || !performed || planned.weight !== performed.weight) return false;
  return performed.reps >= planned.reps && performed.reps <= (planned.maxReps ?? planned.reps);
}

function nextSetOf(pairs: SetPair[]): NextSet | null {
  const nextIndex = pairs.findIndex((pair) => pair.performed === null);
  const next = pairs[nextIndex]?.planned;
  if (next) {
    // A weight changed from the Plan carries on to Planned Sets of the same planned weight;
    // the reps stay the Plan's, and a Rep range leaves them to be given every time.
    const previous = pairs[nextIndex - 1];
    const weight =
      previous?.planned && previous.performed && previous.planned.weight === next.weight
        ? previous.performed.weight
        : next.weight;
    return { weight, reps: next.maxReps === null ? next.reps : null };
  }
  // Past the Plan, or with none, repeating the previous Set is one tap.
  const previous = pairs.at(-1)?.performed;
  return previous ? { weight: previous.weight, reps: previous.reps } : null;
}

/** Re-editing a Plan with recorded Sets or Substitutes needs reconciliation, which comes in a later ticket. */
export function isPlanLocked(entries: EntryRecord[], sets: SetRecord[]): boolean {
  return sets.some((s) => s.kind === "performed") || entries.some((e) => e.substitutesEntryId !== undefined);
}
