import { useState, type FormEvent } from "react";
import { localDate, type LocalDate } from "@gymlog/shared";
import type { Workout } from "../journal/journal.ts";
import { formatWorkoutDate } from "./format.ts";
import { workoutHref } from "./useRoute.ts";

interface WorkoutRowProps {
  workout: Workout;
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
      <li className="workout confirming" role="alertdialog" aria-label="Подтверждение удаления">
        <p className="confirm-text">Удалить тренировку за {label}?</p>
        <div className="actions">
          <button className="button danger" type="button" onClick={() => void onDelete()}>
            Удалить
          </button>
          <button className="button" type="button" onClick={() => setMode("view")} autoFocus>
            Отмена
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="workout">
      <a className="workout-date" href={workoutHref(workout.id)}>
        <span>{label}</span>
        {workout.date === today ? <span className="today">сегодня</span> : null}
      </a>
      <div className="actions">
        <button className="button quiet" type="button" onClick={() => setMode("changing-date")}>
          Изменить дату
        </button>
        <button className="button quiet" type="button" onClick={() => setMode("confirming-delete")}>
          Удалить
        </button>
      </div>
    </li>
  );
}
