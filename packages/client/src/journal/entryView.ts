import type { EntryRecord, ExerciseRecord, SetRecord } from "@gymlog/shared";
import type { Entry, Exercise, PerformedSet, PlannedSet, SetPair, SetValues } from "./journal.ts";

/** An Entry as the UI reads it, with everything derived from its live Sets (given in order). */
export function entryView(entry: EntryRecord, exercise: ExerciseRecord, sets: SetRecord[]): Entry {
  const { plannedSets, performedSets } = splitSets(sets);
  const pairs = pairByOrder(plannedSets, performedSets);
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
  return { id: record.id, weight: record.weight, reps: record.reps, targetRpe: record.rpe };
}

export function pairByOrder(planned: PlannedSet[], performed: PerformedSet[]): SetPair[] {
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
export function isPlanLocked(sets: SetRecord[]): boolean {
  return sets.some((s) => s.kind === "performed");
}
