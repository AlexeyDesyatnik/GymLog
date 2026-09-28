import { useState } from "react";
import type { CatalogExercise, Journal } from "../journal/journal.ts";
import { formatRecordedIn } from "./format.ts";
import { useCatalog } from "./useCatalog.ts";
import { exerciseHref, workoutsHref } from "./useRoute.ts";

export function ExerciseCatalogScreen({ journal }: { journal: Journal }) {
  const [text, setText] = useState("");
  const { exercises } = useCatalog(journal, text);

  return (
    <main className="page">
      <a className="back" href={workoutsHref}>
        ← Тренировки
      </a>
      <h1>Упражнения</h1>

      <label className="field">
        <span className="field-label">Найти</span>
        <input
          id="catalog-search"
          className="text-input"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="любое название"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
        />
      </label>

      {exercises === null ? null : <ExerciseList exercises={exercises} />}
    </main>
  );
}

function ExerciseList({ exercises }: { exercises: CatalogExercise[] }) {
  if (exercises.length === 0) return <p className="empty">Таких упражнений нет.</p>;
  return (
    <ul className="catalog">
      {exercises.map((exercise) => (
        <li key={exercise.id}>
          <a className="catalog-item" href={exerciseHref(exercise.id)}>
            <span className="catalog-name">{exercise.primaryName}</span>
            {exercise.alternativeNames.length > 0 ? (
              <span className="catalog-alternatives">{exercise.alternativeNames.join(" · ")}</span>
            ) : null}
            <span className="catalog-use">{formatRecordedIn(exercise.workoutCount)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
