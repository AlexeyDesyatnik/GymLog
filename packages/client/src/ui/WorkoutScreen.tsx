import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { LocalDate } from "@gymlog/shared";
import type { Journal, WorkoutWithEntries } from "../journal/journal.ts";
import { EntryCard } from "./EntryCard.tsx";
import { formatWorkoutDate } from "./format.ts";
import { workoutsHref } from "./useRoute.ts";

interface WorkoutScreenProps {
  journal: Journal;
  workoutId: string;
  today: LocalDate;
}

export function WorkoutScreen({ journal, workoutId, today }: WorkoutScreenProps) {
  /** undefined while loading, null when there is no such Workout. */
  const [workout, setWorkout] = useState<WorkoutWithEntries | null | undefined>(undefined);
  const [exerciseName, setExerciseName] = useState("");

  const reload = useCallback(async () => {
    setWorkout((await journal.getWorkout(workoutId)) ?? null);
  }, [journal, workoutId]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

      {workout.entries.length === 0 ? (
        <p className="empty">Добавьте первое упражнение.</p>
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
