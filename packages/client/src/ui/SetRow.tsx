import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { RPE_SCALE } from "@gymlog/shared";
import type { Journal, PerformedSet, PlannedSet } from "../journal/journal.ts";
import { parseReps, parseWeight, showNumber, showRpe, showWeight } from "./numbers.ts";
import { ConfirmDelete } from "./ConfirmDelete.tsx";
import { useAutosave } from "./useAutosave.ts";

interface SetRowProps {
  journal: Journal;
  set: PerformedSet;
  /** The Planned Set this one is paired with, if any. */
  planned: PlannedSet | null;
  number: number;
  onChange: () => Promise<void>;
}

type Field = "weight" | "reps";

export function SetRow({ journal, set, planned, number, onChange }: SetRowProps) {
  const [weight, setWeight] = useState(showNumber(set.weight));
  const [reps, setReps] = useState(String(set.reps));
  /** The field being edited; the values show as text otherwise. */
  const [editing, setEditing] = useState<Field | null>(null);
  const weightField = useRef<HTMLInputElement>(null);
  const repsField = useRef<HTMLInputElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickingRpe, setPickingRpe] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState(set.comment ?? "");
  const parsedWeight = parseWeight(weight);
  const parsedReps = parseReps(reps);
  const valuesAutosave = useAutosave();
  const commentAutosave = useAutosave();

  // A layout effect runs while the opening tap is still being handled, which phones
  // require before they show the keyboard.
  useLayoutEffect(() => {
    if (editing === null) return;
    const input = (editing === "weight" ? weightField : repsField).current;
    input?.focus();
    input?.select();
  }, [editing]);

  function startEditing(event: MouseEvent) {
    const field = (event.target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset.field;
    flushSync(() => {
      setWeight(showNumber(set.weight));
      setReps(String(set.reps));
      setEditing(field === "weight" ? "weight" : "reps");
    });
  }

  function stopEditing(event: FocusEvent) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    // A half-typed value isn't saved, and the text shows the stored Set, so it simply goes away.
    valuesAutosave.flush();
    setEditing(null);
  }

  function askToDelete() {
    // Whatever is typed but not yet saved is dropped, so cancelling leaves the Set as it was.
    valuesAutosave.cancel();
    setEditing(null);
    setConfirmingDelete(true);
  }

  async function deleteSet() {
    await journal.deletePerformedSet(set.id);
    await onChange();
  }

  async function saveValues(weightText: string, repsText: string) {
    const newWeight = parseWeight(weightText);
    const newReps = parseReps(repsText);
    if (!newWeight.ok || !newReps.ok) return;
    await journal.editPerformedSet(set.id, { weight: newWeight.value, reps: newReps.value });
    await onChange();
  }

  async function chooseRpe(rpe: number | null) {
    setPickingRpe(false);
    await journal.setRpe(set.id, rpe);
    await onChange();
  }

  function changeComment(text: string) {
    setComment(text);
    commentAutosave.schedule(async () => {
      await journal.setComment(set.id, text);
      await onChange();
    });
  }

  const showComment = commenting || comment.trim() !== "";
  const shownWeight = set.weight === null ? null : showNumber(set.weight);
  // Done as planned needs no note; a difference shows what the Plan said.
  const offPlan = planned !== null && (planned.weight !== set.weight || planned.reps !== set.reps);

  if (confirmingDelete) {
    return (
      <ConfirmDelete
        className="set"
        question={`Удалить подход ${number}?`}
        onDelete={deleteSet}
        onCancel={() => setConfirmingDelete(false)}
      />
    );
  }

  return (
    <li className="set">
      <div className="set-values">
        <span className="set-number">{number}</span>
        {editing === null ? (
          <button
            className="set-summary"
            type="button"
            onClick={startEditing}
            aria-label={`Подход ${number}: ${shownWeight === null ? "без веса" : `${shownWeight} кг`} × ${set.reps}, изменить`}
          >
            <span className="set-value" data-field="weight">
              {showWeight(set.weight)}
            </span>
            <span className="unit">кг ×</span>
            <span className="set-value reps" data-field="reps">
              {set.reps}
            </span>
            <span className="set-done" aria-hidden="true">
              ✓
            </span>
          </button>
        ) : (
          <div className="set-editing" onBlur={stopEditing}>
            <input
              ref={weightField}
              id={`set-weight-${set.id}`}
              className="num-input"
              type="text"
              inputMode="decimal"
              value={weight}
              onChange={(e) => {
                const text = e.target.value;
                setWeight(text);
                valuesAutosave.schedule(() => saveValues(text, reps));
              }}
              onKeyDown={blurOnEnter}
              placeholder="—"
              aria-label={`Вес подхода ${number}, кг`}
              aria-invalid={!parsedWeight.ok}
              enterKeyHint="done"
            />
            <span className="unit">кг ×</span>
            <input
              ref={repsField}
              id={`set-reps-${set.id}`}
              className="num-input reps"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={reps}
              onChange={(e) => {
                const text = e.target.value;
                setReps(text);
                valuesAutosave.schedule(() => saveValues(weight, text));
              }}
              onKeyDown={blurOnEnter}
              aria-label={`Повторы подхода ${number}`}
              aria-invalid={!parsedReps.ok}
              enterKeyHint="done"
            />
          </div>
        )}
        <button
          className={`chip-button${set.rpe === null ? "" : " filled"}`}
          type="button"
          aria-expanded={pickingRpe}
          onClick={() => setPickingRpe(!pickingRpe)}
        >
          {set.rpe === null ? "RPE" : `RPE ${showRpe(set.rpe)}`}
        </button>
      </div>

      {offPlan ? (
        <p className="set-plan">
          план {showWeight(planned.weight)} кг × {planned.reps}
        </p>
      ) : null}

      {editing === null ? null : (
        <div className="set-delete">
          <button
            className="button quiet danger-text"
            type="button"
            // Keeps the focus in the field, so editing doesn't close before the tap lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={askToDelete}
          >
            Удалить подход
          </button>
        </div>
      )}

      {pickingRpe ? (
        <div className="rpe-picker" role="group" aria-label={`RPE подхода ${number}`}>
          {RPE_SCALE.map((value) => (
            <button
              key={value}
              className={`rpe-option${set.rpe === value ? " selected" : ""}`}
              type="button"
              onClick={() => void chooseRpe(value)}
            >
              {showRpe(value)}
            </button>
          ))}
          {set.rpe !== null ? (
            <button className="rpe-option clear" type="button" onClick={() => void chooseRpe(null)}>
              Без RPE
            </button>
          ) : null}
        </div>
      ) : null}

      {showComment ? (
        <input
          id={`set-comment-${set.id}`}
          className="comment-input"
          type="text"
          value={comment}
          onChange={(e) => changeComment(e.target.value)}
          onBlur={() => {
            commentAutosave.flush();
            setCommenting(false);
          }}
          onKeyDown={blurOnEnter}
          placeholder="Комментарий"
          aria-label={`Комментарий к подходу ${number}`}
          enterKeyHint="done"
          autoFocus={commenting && set.comment === null}
        />
      ) : (
        <button className="add-comment" type="button" onClick={() => setCommenting(true)}>
          + комментарий
        </button>
      )}
    </li>
  );
}

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.currentTarget.blur();
}
