import { useState, type FormEvent } from "react";
import { localDate, type LocalDate } from "@gymlog/shared";
import type { WorkoutSummary } from "../journal/journal.ts";
import { ConfirmDelete } from "./ConfirmDelete.tsx";
import { formatWorkoutDate } from "./format.ts";
import { workoutHref } from "./useRoute.ts";

interface WorkoutRowProps {
  workout: WorkoutSummary;
  today: LocalDate;
  onChangeDate: (date: LocalDate) => Promise<void>;
  onDelete: () => Promise<void>;
}

type Mode = "view" | "changing-date" | "confirming-delete";

export function WorkoutRow({ workout, today, onChangeDate, onDelete }: WorkoutRowProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [date, setDate] = useState<string>(workout.date);
  const label = formatWorkoutDate(workout.date, today);

  async function saveDate(event: FormEvent) {
    event.preventDefault();
    if (!date) return;
    await onChangeDate(localDate(date));
    setMode("view");
  }

  if (mode === "changing-date") {
    return (
      <li className="workout">
        <form className="row-form" onSubmit={saveDate}>
          <label className="field">
            <span className="field-label">Новая дата</span>
            <input
              id={`workout-date-${workout.id}`}
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              autoFocus
            />
          </label>
          <div className="actions">
            <button className="button primary" type="submit" disabled={!date}>
              Сохранить
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setDate(workout.date);
                setMode("view");
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === "confirming-delete") {
    return (
      <ConfirmDelete
        className="workout"
        question={`Удалить тренировку за ${label}?`}
        onDelete={onDelete}
        onCancel={() => setMode("view")}
      />
    );
  }

  return (
    <li className="workout">
      <a className="workout-link" href={workoutHref(workout.id)}>
        <span className="workout-date">
          <span>{label}</span>
          {workout.date === today ? <span className="today">сегодня</span> : null}
          {workout.finished ? <span className="finished-tag">завершена</span> : null}
        </span>
        {workout.exerciseNames.length > 0 ? (
          <span className="workout-exercises">{workout.exerciseNames.join(" · ")}</span>
        ) : null}
      </a>
      {/* A Finished Workout is read-only: finishing is undone on its own screen first. */}
      {workout.finished ? null : (
        <div className="actions">
          <button className="button quiet" type="button" onClick={() => setMode("changing-date")}>
            Изменить дату
          </button>
          <button className="button quiet" type="button" onClick={() => setMode("confirming-delete")}>
            Удалить
          </button>
        </div>
      )}
    </li>
  );
}
