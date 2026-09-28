import { useState, type FormEvent } from "react";
import { HasHistoryRefusal, NameTakenRefusal, type CatalogExercise, type Journal } from "../journal/journal.ts";
import { formatRecordedIn, formatWorkoutUse } from "./format.ts";
import { useCatalog } from "./useCatalog.ts";
import { exerciseHref, exercisesHref } from "./useRoute.ts";

/** How many Exercises to merge into are shown at once; typing narrows them down. */
const MERGE_CHOICES = 8;

interface ExerciseScreenProps {
  journal: Journal;
  exerciseId: string;
}

/** One Exercise of the catalog: its names, Merge into another, and deleting it. */
export function ExerciseScreen({ journal, exerciseId }: ExerciseScreenProps) {
  const { exercises: catalog, reload } = useCatalog(journal);

  if (catalog === null) return null;
  const exercise = catalog.find((e) => e.id === exerciseId);
  if (!exercise) {
    return (
      <main className="page">
        <a className="back" href={exercisesHref}>
          ← Упражнения
        </a>
        <p className="empty">Такого упражнения нет: возможно, его удалили или объединили с другим.</p>
      </main>
    );
  }

  return (
    <main className="page">
      <a className="back" href={exercisesHref}>
        ← Упражнения
      </a>
      <h1 className="exercise-title">{exercise.primaryName}</h1>
      <p className="hint">
        {exercise.workoutCount > 0
          ? `Записано ${formatWorkoutUse(exercise.workoutCount)}.`
          : "Ещё ни разу не записано."}
      </p>

      {/* Keyed by the name, so a rename from another device shows up in the field. */}
      <PrimaryNameForm key={exercise.primaryName} journal={journal} exercise={exercise} onChange={reload} />
      <AlternativeNames journal={journal} exercise={exercise} onChange={reload} />
      <MergeSection journal={journal} exercise={exercise} onChange={reload} />
      <DeleteSection journal={journal} exercise={exercise} onChange={reload} />
    </main>
  );
}

interface SectionProps {
  journal: Journal;
  exercise: CatalogExercise;
  /** Reads the catalog again after a change. */
  onChange: () => void;
}

/** What the user reads when a name belongs to another Exercise. */
function takenMessage(refusal: NameTakenRefusal): string {
  return `Название «${refusal.takenName}» уже есть у упражнения «${refusal.holder.primaryName}».`;
}

interface NameFormProps {
  id: string;
  label: string;
  submitLabel: string;
  initialName?: string;
  /** Whether the typed name would change anything. */
  changes?: (name: string) => boolean;
  /** Gives the Exercise the name; a name of another Exercise is refused with NameTakenRefusal. */
  onSubmit: (name: string) => Promise<void>;
}

/** A field for one name of an Exercise; a name another Exercise has is refused with a message. */
function NameForm({ id, label, submitLabel, initialName = "", changes = () => true, onSubmit }: NameFormProps) {
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canSubmit = name.trim() !== "" && changes(name) && !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit(name);
      setName(initialName);
    } catch (error) {
      if (!(error instanceof NameTakenRefusal)) throw error;
      setProblem(takenMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form className="add-entry" onSubmit={submit}>
        <label className="field">
          <span className="field-label">{label}</span>
          <input
            id={id}
            className="text-input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setProblem(null);
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            aria-invalid={problem !== null}
          />
        </label>
        <button className="button primary" type="submit" disabled={!canSubmit}>
          {submitLabel}
        </button>
      </form>
      {problem !== null ? <p className="plan-message">{problem}</p> : null}
    </>
  );
}

function PrimaryNameForm({ journal, exercise, onChange }: SectionProps) {
  return (
    <section className="catalog-section">
      <h2>Основное название</h2>
      <NameForm
        id="primary-name"
        label="Показывается везде"
        submitLabel="Сохранить"
        initialName={exercise.primaryName}
        changes={(name) => name.trim() !== exercise.primaryName}
        onSubmit={async (name) => {
          await journal.renameExercise(exercise.id, name);
          onChange();
        }}
      />
      <p className="hint">Прежнее название останется дополнительным, чтобы по нему упражнение тоже находилось.</p>
    </section>
  );
}

function AlternativeNames({ journal, exercise, onChange }: SectionProps) {
  async function remove(alternativeName: string) {
    await journal.removeAlternativeName(exercise.id, alternativeName);
    onChange();
  }

  return (
    <section className="catalog-section">
      <h2>Дополнительные названия</h2>
      <p className="hint">По ним упражнение находится, например, на другом языке.</p>
      {exercise.alternativeNames.length > 0 ? (
        <ul className="alternative-names">
          {exercise.alternativeNames.map((alternativeName) => (
            <li key={alternativeName} className="alternative-name">
              <span>{alternativeName}</span>
              <button
                className="button quiet danger-text"
                type="button"
                onClick={() => void remove(alternativeName)}
                aria-label={`Убрать название ${alternativeName}`}
              >
                Убрать
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <NameForm
        id="alternative-name"
        label="Новое название"
        submitLabel="Добавить"
        onSubmit={async (name) => {
          await journal.addAlternativeName(exercise.id, name);
          onChange();
        }}
      />
    </section>
  );
}

/** Merges this Exercise into another one the user picks, after confirming, since it can't be undone. */
function MergeSection({ journal, exercise }: SectionProps) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<CatalogExercise | null>(null);
  const [merging, setMerging] = useState(false);
  const { exercises: found } = useCatalog(journal, text);
  const choices = text.trim() ? (found ?? []).filter((e) => e.id !== exercise.id).slice(0, MERGE_CHOICES) : [];

  async function merge(into: CatalogExercise) {
    if (merging) return;
    setMerging(true);
    try {
      await journal.mergeExercises(exercise.id, into.id);
      window.location.hash = exerciseHref(into.id);
    } finally {
      setMerging(false);
    }
  }

  if (target !== null) {
    const names = [exercise.primaryName, ...exercise.alternativeNames].map((n) => `«${n}»`).join(", ");
    const history =
      exercise.workoutCount > 0
        ? `Всё записанное ${formatWorkoutUse(exercise.workoutCount)} перейдёт в «${target.primaryName}». `
        : "";
    const renamed =
      exercise.alternativeNames.length > 0
        ? `Названия ${names} станут дополнительными у «${target.primaryName}».`
        : `Название ${names} станет дополнительным у «${target.primaryName}».`;
    return (
      <section className="confirm-box" role="alertdialog" aria-label="Подтверждение объединения">
        <p className="confirm-text">
          Объединить «{exercise.primaryName}» с «{target.primaryName}»?
        </p>
        <p className="confirm-detail">
          {history}
          {renamed} Отменить объединение нельзя.
        </p>
        <div className="actions">
          <button className="button danger" type="button" onClick={() => void merge(target)} disabled={merging}>
            Объединить
          </button>
          <button className="button" type="button" onClick={() => setTarget(null)} autoFocus>
            Отмена
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="catalog-section">
      <h2>Объединить с другим</h2>
      <p className="hint">
        Если это то же упражнение, что и другое: его записи перейдут в выбранное, а названия станут дополнительными.
      </p>
      <label className="field">
        <span className="field-label">С каким упражнением</span>
        <input
          id="merge-target"
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
      {choices.length > 0 ? (
        <ul className="suggestions" aria-label="Упражнения для объединения">
          {choices.map((choice) => (
            <li key={choice.id}>
              <button className="suggestion merge-choice" type="button" onClick={() => setTarget(choice)}>
                <span className="merge-choice-names">
                  <span>{choice.primaryName}</span>
                  {choice.alternativeNames.length > 0 ? (
                    <span className="catalog-use">{choice.alternativeNames.join(" · ")}</span>
                  ) : null}
                </span>
                <span className="catalog-use merge-choice-use">{formatRecordedIn(choice.workoutCount)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : text.trim() && found !== null ? (
        <p className="hint">Такого упражнения нет.</p>
      ) : null}
    </section>
  );
}

/** Deletes an Exercise with no history after confirming; one with history is pointed to Merge. */
function DeleteSection({ journal, exercise, onChange }: SectionProps) {
  const [mode, setMode] = useState<"idle" | "confirming" | "refused">("idle");

  async function remove() {
    try {
      await journal.deleteExercise(exercise.id);
      window.location.hash = exercisesHref;
    } catch (error) {
      // Recorded on another device since the catalog was read: read it again for the count.
      if (!(error instanceof HasHistoryRefusal)) throw error;
      setMode("refused");
      onChange();
    }
  }

  if (mode === "confirming") {
    return (
      <section className="confirm-box" role="alertdialog" aria-label="Подтверждение удаления">
        <p className="confirm-text">Удалить упражнение «{exercise.primaryName}»?</p>
        <div className="actions">
          <button className="button danger" type="button" onClick={() => void remove()}>
            Удалить
          </button>
          <button className="button" type="button" onClick={() => setMode("idle")} autoFocus>
            Отмена
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="catalog-section">
      <div>
        <button
          className="button quiet danger-text"
          type="button"
          onClick={() => setMode(exercise.workoutCount > 0 ? "refused" : "confirming")}
        >
          Удалить упражнение
        </button>
      </div>
      {mode === "refused" && exercise.workoutCount > 0 ? (
        <p className="refusal" role="alert">
          Удалить нельзя: упражнение записано {formatWorkoutUse(exercise.workoutCount)}, и эти записи пропали бы. Если
          это то же упражнение, что и другое, объедините их.
        </p>
      ) : null}
    </section>
  );
}
