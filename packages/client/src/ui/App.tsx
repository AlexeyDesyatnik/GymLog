import { useCallback, useEffect, useState, type FormEvent } from "react";
import { localDate, localDateOf } from "@gymlog/shared";
import type { Journal, Workout } from "../journal/journal.ts";
import { WorkoutRow } from "./WorkoutRow.tsx";

export function App({ journal }: { journal: Journal }) {
  const today = localDateOf(new Date());
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [newDate, setNewDate] = useState<string>(today);

  const reload = useCallback(async () => {
    setWorkouts(await journal.listWorkouts());
  }, [journal]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!newDate) return;
    await journal.createWorkout(localDate(newDate));
    await reload();
  }

  return (
    <main className="page">
      <h1>Тренировки</h1>

      <form className="create" onSubmit={create}>
        <label className="field">
          <span className="field-label">Дата</span>
          <input
            id="new-workout-date"
            type="date"
            required
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
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
    </main>
  );
}
