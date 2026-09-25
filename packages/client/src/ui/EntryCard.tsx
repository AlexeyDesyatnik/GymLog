import { useState, type FormEvent } from "react";
import { formatPlanSets } from "@gymlog/shared";
import type { Entry, Journal } from "../journal/journal.ts";
import { parseReps, parseWeight, showNumber } from "./numbers.ts";
import { formatSetCount } from "./format.ts";
import { SetRow } from "./SetRow.tsx";

interface EntryCardProps {
  journal: Journal;
  entry: Entry;
  onChange: () => Promise<void>;
}

export function EntryCard({ journal, entry, onChange }: EntryCardProps) {
  const last = entry.performedSets.at(-1);
  // The next Set starts from the previous one, so repeating a Set is one tap.
  const [weight, setWeight] = useState(last ? showNumber(last.weight) : "");
  const [reps, setReps] = useState(last ? String(last.reps) : "");
  /** The values are still the previous Set's (number prefill), shown muted until edited. */
  const [prefilled, setPrefilled] = useState(last !== undefined);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const planned = entry.plannedSets.length > 0;
  const parsedWeight = parseWeight(weight);
  const parsedReps = parseReps(reps);

  async function addSet(event: FormEvent) {
    event.preventDefault();
    if (!parsedWeight.ok || !parsedReps.ok) return;
    await journal.addPerformedSet(entry.id, { weight: parsedWeight.value, reps: parsedReps.value });
    setPrefilled(true);
    await onChange();
  }

  async function deleteEntry() {
    await journal.deleteEntry(entry.id);
    await onChange();
  }

  if (confirmingDelete) {
    const sets = entry.performedSets.length;
    return (
      <li className="entry confirming" role="alertdialog" aria-label="Подтверждение удаления">
        <p className="confirm-text">
          Удалить {entry.exercise.primaryName}
          {sets > 0 ? ` и ${formatSetCount(sets)}` : ""}?
        </p>
        <div className="actions">
          <button className="button danger" type="button" onClick={() => void deleteEntry()}>
            Удалить
          </button>
          <button className="button" type="button" onClick={() => setConfirmingDelete(false)} autoFocus>
            Отмена
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="entry">
      <div className="entry-head">
        <h2 className="entry-name">{entry.exercise.primaryName}</h2>
        {/* An Entry from the Plan is removed by editing the Plan text. */}
        {planned ? null : (
          <button className="button quiet muted-text" type="button" onClick={() => setConfirmingDelete(true)}>
            Удалить
          </button>
        )}
      </div>
      {planned ? (
        <p className="entry-plan">
          <span className="entry-plan-label">План</span> {formatPlanSets(entry.plannedSets)}
        </p>
      ) : null}

      {entry.performedSets.length > 0 ? (
        <ol className="sets">
          {entry.performedSets.map((set, i) => (
            <SetRow key={set.id} journal={journal} set={set} number={i + 1} onChange={onChange} />
          ))}
        </ol>
      ) : null}

      <form className="add-set" onSubmit={addSet}>
        <span className="set-number" aria-hidden="true">
          {entry.performedSets.length + 1}
        </span>
        <input
          id={`new-set-weight-${entry.id}`}
          className={`num-input${prefilled ? " prefilled" : ""}`}
          type="text"
          inputMode="decimal"
          value={weight}
          onChange={(e) => {
            setWeight(e.target.value);
            setPrefilled(false);
          }}
          placeholder="вес"
          aria-label="Вес, кг"
          aria-invalid={!parsedWeight.ok}
        />
        <span className="unit">кг ×</span>
        <input
          id={`new-set-reps-${entry.id}`}
          className={`num-input reps${prefilled ? " prefilled" : ""}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={reps}
          onChange={(e) => {
            setReps(e.target.value);
            setPrefilled(false);
          }}
          placeholder="повт."
          aria-label="Повторы"
          aria-invalid={reps !== "" && !parsedReps.ok}
        />
        <button className="button primary" type="submit" disabled={!parsedWeight.ok || !parsedReps.ok}>
          + Подход
        </button>
      </form>
    </li>
  );
}
