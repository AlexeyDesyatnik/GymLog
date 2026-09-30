import { useCallback, useEffect, useState, type FormEvent } from "react";
import { localDate, type LocalDate } from "@gymlog/shared";
import type { Journal, Template, TemplateChoice, WorkoutSummary } from "../journal/journal.ts";
import { formatWorkoutDate } from "./format.ts";
import { SyncStatus } from "./SyncStatus.tsx";
import { exercisesHref, workoutHref } from "./useRoute.ts";
import { WorkoutRow } from "./WorkoutRow.tsx";

/** The value of the Template choice for a new Workout with no Template. */
const NO_TEMPLATE = "";

export function WorkoutListScreen({ journal, today }: { journal: Journal; today: LocalDate }) {
  const [workouts, setWorkouts] = useState<WorkoutSummary[] | null>(null);
  /** The date the user picked for a new Workout; until they pick one, it's today. */
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const newDate = chosenDate ?? today;
  /** The Templates a new Workout can have, and the date they were looked up for. */
  const [choice, setChoice] = useState<(TemplateChoice & { date: string }) | null>(null);
  const templates = choice?.templates ?? [];
  // Until the choice for the date shown is in, a new Workout could get the wrong Template.
  const ready = !!newDate && choice?.date === newDate;
  /** The Template the user picked, or NO_TEMPLATE; until they pick, it's the one offered. */
  const [chosenTemplateId, setChosenTemplateId] = useState<string | null>(null);
  // A picked Template that has since gone, deleted here or on another device, is picked no more.
  const templateId =
    chosenTemplateId === NO_TEMPLATE || templates.some((t) => t.id === chosenTemplateId)
      ? chosenTemplateId!
      : (choice?.offered ?? NO_TEMPLATE);

  const reload = useCallback(async () => {
    setWorkouts(await journal.listWorkouts());
  }, [journal]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Workouts recorded on the user's other devices show up as they arrive.
  useEffect(() => journal.sync.onRecordsArrived(() => void reload()), [journal, reload]);

  // Which Template is offered depends on the date, and on the Workouts there are to copy.
  useEffect(() => {
    if (!newDate || workouts === null) return;
    let current = true;
    void journal.templatesFor(localDate(newDate)).then((found) => {
      if (current) setChoice({ ...found, date: newDate });
    });
    return () => {
      current = false;
    };
  }, [journal, newDate, workouts]);

  async function create(event: FormEvent) {
    event.preventDefault();
    // The date and the Template shown are the ones the new Workout gets.
    if (!ready) return;
    const created =
      templateId === NO_TEMPLATE
        ? await journal.createWorkout(localDate(newDate))
        : await journal.createFromTemplate(templateId, localDate(newDate));
    // Straight into the new Workout, to go through its Plan or change it.
    window.location.hash = workoutHref(created.id);
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
        {templates.length > 0 ? (
          <label className="field template-field">
            <span className="field-label">План из тренировки</span>
            <select
              id="new-workout-template"
              value={templateId}
              onChange={(e) => setChosenTemplateId(e.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {templateLabel(template, today)}
                </option>
              ))}
              <option value={NO_TEMPLATE}>Без плана</option>
            </select>
          </label>
        ) : null}
        <button className="button primary" type="submit" disabled={!ready}>
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

/** "вт, 22 сентября: squat · bench press". */
function templateLabel(template: Template, today: LocalDate): string {
  return `${formatWorkoutDate(template.date, today)}: ${template.exerciseNames.join(" · ")}`;
}
