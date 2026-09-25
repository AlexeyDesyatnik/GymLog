import { useState } from "react";
import { RPE_SCALE } from "@gymlog/shared";
import type { Journal, PerformedSet } from "../journal/journal.ts";
import { parseReps, parseWeight, showNumber, showRpe } from "./numbers.ts";
import { useAutosave } from "./useAutosave.ts";

interface SetRowProps {
  journal: Journal;
  set: PerformedSet;
  number: number;
  onChange: () => Promise<void>;
}

export function SetRow({ journal, set, number, onChange }: SetRowProps) {
  const [weight, setWeight] = useState(showNumber(set.weight));
  const [reps, setReps] = useState(String(set.reps));
  const [pickingRpe, setPickingRpe] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState(set.comment ?? "");
  const parsedWeight = parseWeight(weight);
  const parsedReps = parseReps(reps);
  const valuesAutosave = useAutosave();
  const commentAutosave = useAutosave();

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

  return (
    <li className="set">
      <div className="set-values">
        <span className="set-number">{number}</span>
        <input
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
          onBlur={valuesAutosave.flush}
          placeholder="—"
          aria-label={`Вес подхода ${number}, кг`}
          aria-invalid={!parsedWeight.ok}
        />
        <span className="unit">кг ×</span>
        <input
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
          onBlur={valuesAutosave.flush}
          aria-label={`Повторы подхода ${number}`}
          aria-invalid={!parsedReps.ok}
        />
        <button
          className={`chip-button${set.rpe === null ? "" : " filled"}`}
          type="button"
          aria-expanded={pickingRpe}
          onClick={() => setPickingRpe(!pickingRpe)}
        >
          {set.rpe === null ? "RPE" : `RPE ${showRpe(set.rpe)}`}
        </button>
      </div>

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
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
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
