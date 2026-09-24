import { useState } from "react";
import type { Journal, PerformedSet } from "../journal/journal.ts";
import { parseReps, parseWeight, showNumber } from "./numbers.ts";

interface SetRowProps {
  journal: Journal;
  set: PerformedSet;
  number: number;
  onChange: () => Promise<void>;
}

const RPE_VALUES = Array.from({ length: 19 }, (_, i) => 1 + i / 2);

export function SetRow({ journal, set, number, onChange }: SetRowProps) {
  const [weight, setWeight] = useState(showNumber(set.weight));
  const [reps, setReps] = useState(String(set.reps));
  const [pickingRpe, setPickingRpe] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState(set.comment ?? "");
  const parsedWeight = parseWeight(weight);
  const parsedReps = parseReps(reps);

  // Every valid change is saved at once: a field that never loses focus (the phone is
  // locked, the app is switched) must not lose what was typed.
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

  async function changeComment(text: string) {
    setComment(text);
    await journal.setComment(set.id, text);
    await onChange();
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
            setWeight(e.target.value);
            void saveValues(e.target.value, reps);
          }}
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
            setReps(e.target.value);
            void saveValues(weight, e.target.value);
          }}
          aria-label={`Повторы подхода ${number}`}
          aria-invalid={!parsedReps.ok}
        />
        <button
          className={`chip-button${set.rpe === null ? "" : " filled"}`}
          type="button"
          aria-expanded={pickingRpe}
          onClick={() => setPickingRpe(!pickingRpe)}
        >
          {set.rpe === null ? "RPE" : `RPE ${showNumber(set.rpe)}`}
        </button>
      </div>

      {pickingRpe ? (
        <div className="rpe-picker" role="group" aria-label={`RPE подхода ${number}`}>
          {RPE_VALUES.map((value) => (
            <button
              key={value}
              className={`rpe-option${set.rpe === value ? " selected" : ""}`}
              type="button"
              onClick={() => void chooseRpe(value)}
            >
              {showNumber(value)}
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
          onChange={(e) => void changeComment(e.target.value)}
          onBlur={() => setCommenting(false)}
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
