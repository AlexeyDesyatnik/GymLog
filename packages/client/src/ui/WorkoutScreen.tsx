import { useCallback, useEffect, useState, type FormEvent } from "react";
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

interface WorkoutScreenProps {
  journal: Journal;
  workoutId: string;
  today: LocalDate;
}

export function WorkoutScreen({ journal, workoutId, today }: WorkoutScreenProps) {
  /** undefined while loading, null when there is no such Workout. */
  const [workout, setWorkout] = useState<WorkoutWithEntries | null | undefined>(undefined);
  const [exerciseName, setExerciseName] = useState("");
  /** What the Plan editor works on while it is open. */
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);

  const reload = useCallback(async () => {
    setWorkout((await journal.getWorkout(workoutId)) ?? null);
  }, [journal, workoutId]);

  /** The editor's starting point: an unfinished draft of the current Plan, or the Plan itself. */
  const currentDraft = useCallback(async (): Promise<PlanDraft | null> => {
    const [stored, current] = [loadPlanDraft(workoutId), await journal.getWorkout(workoutId)];
    if (!current || current.planLocked) {
      clearPlanDraft(workoutId);
      return null;
    }
    const notation = await journal.getPlanNotation(workoutId);
    if (stored && stored.basedOn === notation) return stored;
    // A draft of a Plan that has changed since would hide the change, so it goes.
    clearPlanDraft(workoutId);
    return { notation, basedOn: notation };
  }, [journal, workoutId]);

  useEffect(() => {
    void reload();
    // An unfinished draft reopens the editor, as long as it still fits the Plan.
    void currentDraft().then((draft) => {
      if (draft && loadPlanDraft(workoutId)) setPlanDraft(draft);
    });
  }, [reload, currentDraft, workoutId]);

  async function openPlanEditor() {
    setPlanDraft(await currentDraft());
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

      {planDraft !== null ? (
        <PlanEditor
          journal={journal}
          workoutId={workoutId}
          draft={planDraft}
          onClose={() => setPlanDraft(null)}
          onApplied={reload}
        />
      ) : (
        <PlanButton workout={workout} onOpen={() => void openPlanEditor()} />
      )}

      {workout.entries.length === 0 ? (
        <p className="empty">Напишите план или добавьте первое упражнение.</p>
      ) : (
        <ol className="entries">
          {workout.entries.map((entry) => (
            <EntryCard key={entry.id} journal={journal} entry={entry} onChange={reload} />
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
