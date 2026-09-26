import type { EntryRecord, ExerciseRecord, SetRecord } from "@gymlog/shared";
import type { Entry, Exercise, NextSet, PerformedSet, PlannedSet, SetPair } from "./journal.ts";

/**
 * An Entry as the UI reads it, with everything derived from its live Sets (given in order)
 * and whether its Workout is Finished.
 */
export function entryView(entry: EntryRecord, exercise: ExerciseRecord, sets: SetRecord[], finished: boolean): Entry {
  const { plannedSets, performedSets } = splitSets(sets);
  const pairs = pairByOrder(plannedSets, performedSets, finished);
  return {
    id: entry.id,
    exercise: toExercise(exercise),
    plannedSets,
    performedSets,
    pairs,
    nextSet: nextSetOf(pairs),
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

/** Pairs Planned and Performed Sets by order; in a Finished Workout, a Planned Set left unpaired is Not performed. */
export function pairByOrder(planned: PlannedSet[], performed: PerformedSet[], finished: boolean): SetPair[] {
  return Array.from({ length: Math.max(planned.length, performed.length) }, (_, i) => ({
    planned: planned[i] ?? null,
    performed: performed[i] ?? null,
    notPerformed: finished && planned[i] !== undefined && performed[i] === undefined,
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
    const previous = pairs[nextIndex - 1];
    const done =
      previous?.planned && previous.performed ? { planned: previous.planned, performed: previous.performed } : null;
    // A weight changed from the Plan carries on to Planned Sets of the same planned weight;
    // the reps stay the Plan's.
    const sameWeight = done !== null && done.planned.weight === next.weight;
    const weight = sameWeight ? done.performed.weight : next.weight;
    if (next.maxReps === null) return { weight, reps: next.reps };
    // A Rep range's reps are the user's to give; later Sets of its group repeat the Set before.
    const sameRange = sameWeight && done.planned.reps === next.reps && done.planned.maxReps === next.maxReps;
    return { weight, reps: sameRange ? done.performed.reps : null };
  }
  // Past the Plan, or with none, repeating the previous Set is one tap.
  const previous = pairs.at(-1)?.performed;
  return previous ? { weight: previous.weight, reps: previous.reps } : null;
}

/** Re-editing a Plan with recorded Sets needs reconciliation, which comes in a later ticket. */
export function isPlanLocked(sets: SetRecord[]): boolean {
  return sets.some((s) => s.kind === "performed");
}
