import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import type { LocalDate } from "@gymlog/shared";
import type { Journal, WorkoutWithEntries } from "../journal/journal.ts";
import { EntryCard } from "./EntryCard.tsx";
import { formatWorkoutDate } from "./format.ts";
import { PlanEditor } from "./PlanEditor.tsx";
import { clearPlanDraft, loadPlanDraft, type PlanDraft } from "./planDraft.ts";
import { SuggestionList, useSuggestions } from "./Suggestions.tsx";
import { workoutsHref } from "./useRoute.ts";

/**
 * Opens the Plan editor. Once part of the Workout is recorded, editing the Plan is the
 * exception, so it asks first; "Отмена" has the focus, so a stray tap changes nothing.
 */
function PlanButton({ workout, onOpen }: { workout: WorkoutWithEntries; onOpen: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const hasPlan = workout.entries.some((e) => e.plannedSets.length > 0);
  // Writing a first Plan only adds Entries, so there is nothing to ask.
  const confirmFirst = hasPlan && workout.entries.some((e) => e.performedSets.length > 0);
  if (confirming) {
    return (
      <div className="plan-button confirming" role="alertdialog" aria-label="Подтверждение изменения плана">
        <p className="confirm-text">
          Часть тренировки уже записана. Всё равно изменить план? Записанные подходы сохранятся.
        </p>
        <div className="actions">
          <button className="button primary" type="button" onClick={onOpen}>
            Изменить план
          </button>
          <button className="button" type="button" onClick={() => setConfirming(false)} autoFocus>
            Отмена
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="plan-button">
      <button className="button" type="button" onClick={confirmFirst ? () => setConfirming(true) : onOpen}>
        {hasPlan ? "Изменить план" : "Написать план"}
      </button>
    </div>
  );
}

/**
 * The Plan editor's starting point: an unfinished draft of the current Plan, or the Plan
 * itself; null when the Workout is Finished. A draft of a Plan that has changed since would
 * hide the change, so it is dropped.
 */
function draftFor(workoutId: string, workout: WorkoutWithEntries): PlanDraft | null {
  const stored = loadPlanDraft(workoutId);
  if (workout.finished) {
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
  // Suggested once the user starts typing a name.
  const entrySuggestions = useSuggestions(journal, today, exerciseName.trim() ? exerciseName : null);
  /** What the Plan editor works on while it is open, and whether it opened from a tap. */
  const [planEditor, setPlanEditor] = useState<{ draft: PlanDraft; tapped: boolean } | null>(null);
  /** Finishing or undoing it is under way, so a second tap does nothing. */
  const [switching, setSwitching] = useState(false);
  // Set at once, unlike state, so a second tap arriving before the next render is turned away.
  const switchingNow = useRef(false);

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

  // Changes to this Workout from the user's other devices show up as they arrive.
  useEffect(() => journal.sync.onRecordsArrived(() => void reload()), [journal, reload]);

  function openPlanEditor(current: WorkoutWithEntries) {
    // Opening synchronously within the tap lets the editor take focus and bring up the
    // keyboard; phones only allow that during the tap itself.
    const draft = draftFor(workoutId, current);
    if (draft) flushSync(() => setPlanEditor({ draft, tapped: true }));
  }

  async function addEntry(name: string) {
    if (!name.trim()) return;
    await journal.addEntry(workoutId, name);
    setExerciseName("");
    await reload();
  }

  function submitEntry(event: FormEvent) {
    event.preventDefault();
    void addEntry(exerciseName);
  }

  /** Runs finishing or undoing it once per tap, then shows the result. */
  async function switchOnce(action: () => Promise<void>) {
    if (switchingNow.current) return;
    switchingNow.current = true;
    setSwitching(true);
    try {
      await action();
      await reload();
    } finally {
      switchingNow.current = false;
      setSwitching(false);
    }
  }

  function finish() {
    return switchOnce(async () => {
      setPlanEditor(null);
      await journal.finishWorkout(workoutId);
      // Only once finished: if finishing fails, the draft is still there after reloading.
      clearPlanDraft(workoutId);
    });
  }

  function undoFinishing() {
    return switchOnce(() => journal.undoFinishing(workoutId));
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

      {workout.finished ? (
        <div className="finished-bar">
          <p className="finished-text">
            <strong>Тренировка завершена.</strong> Чтобы изменить или удалить её, отмените завершение.
          </p>
          <button className="button" type="button" onClick={() => void undoFinishing()} disabled={switching}>
            Отменить завершение
          </button>
        </div>
      ) : planEditor !== null ? (
        <PlanEditor
          journal={journal}
          workoutId={workoutId}
          draft={planEditor.draft}
          today={today}
          focusOnOpen={planEditor.tapped}
          onClose={() => setPlanEditor(null)}
          onApplied={refresh}
        />
      ) : (
        <PlanButton workout={workout} onOpen={() => openPlanEditor(workout)} />
      )}

      {workout.entries.length === 0 ? (
        <p className="empty">
          {workout.finished ? "В тренировке ничего не записано." : "Напишите план или добавьте первое упражнение."}
        </p>
      ) : (
        <ol className="entries">
          {workout.entries.map((entry) => (
            <EntryCard
              key={entry.id}
              journal={journal}
              entry={entry}
              finished={workout.finished}
              today={today}
              onChange={refresh}
            />
          ))}
        </ol>
      )}

      {workout.finished ? null : (
        <form className="add-entry" onSubmit={submitEntry}>
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
          {entrySuggestions.length > 0 ? (
            <div className="add-entry-suggestions">
              <SuggestionList suggestions={entrySuggestions} onPick={(exercise) => void addEntry(exercise.primaryName)} />
            </div>
          ) : null}
        </form>
      )}

      {/* An empty Workout has nothing to declare recorded. */}
      {workout.finished || workout.entries.length === 0 ? null : (
        <div className="finish">
          <button className="button" type="button" onClick={() => void finish()} disabled={switching}>
            Завершить тренировку
          </button>
          <p className="hint">
            Незаписанные подходы из плана будут отмечены как невыполненные. Завершение можно отменить.
          </p>
        </div>
      )}
    </main>
  );
}
