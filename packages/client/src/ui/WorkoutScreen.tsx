import { useCallback, useEffect, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import type { LocalDate } from "@gymlog/shared";
import type { Journal, WorkoutWithEntries } from "../journal/journal.ts";
import { EntryCard } from "./EntryCard.tsx";
import { formatWorkoutDate } from "./format.ts";
import { PlanEditor } from "./PlanEditor.tsx";
import { clearPlanDraft, loadPlanDraft, type PlanDraft } from "./planDraft.ts";
import { workoutsHref } from "./useRoute.ts";

function PlanButton({ workout, onOpen }: { workout: WorkoutWithEntries; onOpen: () => void }) {
  const hasPlan = workout.entries.some((e) => e.plannedSets.length > 0);
  if (workout.planLocked && !hasPlan) return null;
  return (
    <div className="plan-button">
      <button className="button" type="button" onClick={onOpen} disabled={workout.planLocked}>
        {hasPlan ? "Изменить план" : "Написать план"}
      </button>
      {workout.planLocked ? <p className="hint">План нельзя менять, когда уже записаны подходы.</p> : null}
    </div>
  );
}

/**
 * The Plan editor's starting point: an unfinished draft of the current Plan, or the Plan
 * itself; null when the Plan is locked. A draft of a Plan that has changed since would
 * hide the change, so it is dropped.
 */
function draftFor(workoutId: string, workout: WorkoutWithEntries): PlanDraft | null {
  const stored = loadPlanDraft(workoutId);
  if (workout.planLocked) {
    clearPlanDraft(workoutId);
    return null;
  }
  if (stored && stored.basedOn === workout.planNotation) return stored;
  clearPlanDraft(workoutId);
  return { notation: workout.planNotation, basedOn: workout.planNotation };
}

interface WorkoutScreenProps {
  journal: Journal;
  workoutId: string;
  today: LocalDate;
}

export function WorkoutScreen({ journal, workoutId, today }: WorkoutScreenProps) {
  /** undefined while loading, null when there is no such Workout. */
  const [workout, setWorkout] = useState<WorkoutWithEntries | null | undefined>(undefined);
  const [exerciseName, setExerciseName] = useState("");
  /** What the Plan editor works on while it is open, and whether it opened from a tap. */
  const [planEditor, setPlanEditor] = useState<{ draft: PlanDraft; tapped: boolean } | null>(null);

  const reload = useCallback(async () => {
    const loaded = (await journal.getWorkout(workoutId)) ?? null;
    setWorkout(loaded);
    return loaded;
  }, [journal, workoutId]);

  const refresh = useCallback(async () => {
    await reload();
  }, [reload]);

  useEffect(() => {
    void reload().then((loaded) => {
      // An unfinished draft reopens the editor, as long as it still fits the Plan.
      const hadDraft = loadPlanDraft(workoutId) !== null;
      const draft = loaded ? draftFor(workoutId, loaded) : null;
      if (hadDraft && draft && loadPlanDraft(workoutId)) setPlanEditor({ draft, tapped: false });
    });
  }, [reload, workoutId]);

  function openPlanEditor(current: WorkoutWithEntries) {
    // Opening synchronously within the tap lets the editor take focus and bring up the
    // keyboard; phones only allow that during the tap itself.
    const draft = draftFor(workoutId, current);
    if (draft) flushSync(() => setPlanEditor({ draft, tapped: true }));
  }

  async function addEntry(event: FormEvent) {
    event.preventDefault();
    if (!exerciseName.trim()) return;
    await journal.addEntry(workoutId, exerciseName);
    setExerciseName("");
    await reload();
  }

  if (workout === undefined) return null;

  if (workout === null) {
    return (
      <main className="page">
        <a className="back" href={workoutsHref}>← Тренировки</a>
        <p className="empty">Такой тренировки нет: возможно, её удалили.</p>
      </main>
    );
  }

  return (
    <main className="page">
      <a className="back" href={workoutsHref}>← Тренировки</a>
      <h1 className="workout-title">
        <span>{formatWorkoutDate(workout.date, today)}</span>
        {workout.date === today ? <span className="today">сегодня</span> : null}
      </h1>

      {planEditor !== null ? (
        <PlanEditor
          journal={journal}
          workoutId={workoutId}
          draft={planEditor.draft}
          focusOnOpen={planEditor.tapped}
          onClose={() => setPlanEditor(null)}
          onApplied={refresh}
        />
      ) : (
        <PlanButton workout={workout} onOpen={() => openPlanEditor(workout)} />
      )}

      {workout.entries.length === 0 ? (
        <p className="empty">Напишите план или добавьте первое упражнение.</p>
      ) : (
        <ol className="entries">
          {workout.entries.map((entry) => (
            <EntryCard key={entry.id} journal={journal} entry={entry} onChange={refresh} />
          ))}
        </ol>
      )}

      <form className="add-entry" onSubmit={addEntry}>
        <label className="field">
          <span className="field-label">Упражнение</span>
          <input
            id="new-entry-exercise"
            className="text-input"
            type="text"
            value={exerciseName}
            onChange={(e) => setExerciseName(e.target.value)}
            placeholder="например, bench press"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
          />
        </label>
        <button className="button primary" type="submit" disabled={!exerciseName.trim()}>
          Добавить
        </button>
      </form>
    </main>
  );
}
