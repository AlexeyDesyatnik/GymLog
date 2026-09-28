import { useCallback, useEffect, useState, type FormEvent } from "react";
import { localDate, localDateOf, type LocalDate } from "@gymlog/shared";
import type { Journal, WorkoutSummary } from "../journal/journal.ts";
import { SyncStatus } from "./SyncStatus.tsx";
import { exercisesHref } from "./useRoute.ts";
import { WorkoutRow } from "./WorkoutRow.tsx";

export function WorkoutListScreen({ journal, today }: { journal: Journal; today: LocalDate }) {
  const [workouts, setWorkouts] = useState<WorkoutSummary[] | null>(null);
  /** The date the user picked for a new Workout; until they pick one, it's today. */
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const newDate = chosenDate ?? today;

  const reload = useCallback(async () => {
    setWorkouts(await journal.listWorkouts());
  }, [journal]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Workouts recorded on the user's other devices show up as they arrive.
  useEffect(() => journal.sync.onRecordsArrived(() => void reload()), [journal, reload]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const date = chosenDate ?? localDateOf(new Date());
    if (!date) return;
    await journal.createWorkout(localDate(date));
    await reload();
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>Тренировки</h1>
        <a className="head-link" href={exercisesHref}>
          Упражнения
        </a>
      </div>

      <form className="create" onSubmit={create}>
        <label className="field">
          <span className="field-label">Дата</span>
          <input
            id="new-workout-date"
            type="date"
            required
            value={newDate}
            onChange={(e) => setChosenDate(e.target.value)}
          />
        </label>
        <button className="button primary" type="submit" disabled={!newDate}>
          Новая тренировка
        </button>
      </form>

      {workouts === null ? null : workouts.length === 0 ? (
        <p className="empty">Тренировок пока нет. Выберите дату и создайте первую.</p>
      ) : (
        <ul className="workouts">
          {workouts.map((workout) => (
            <WorkoutRow
              key={workout.id}
              workout={workout}
              today={today}
              onChangeDate={async (date) => {
                await journal.changeWorkoutDate(workout.id, date);
                await reload();
              }}
              onDelete={async () => {
                await journal.deleteWorkout(workout.id);
                await reload();
              }}
            />
          ))}
        </ul>
      )}

      <SyncStatus journal={journal} />
    </main>
  );
}
