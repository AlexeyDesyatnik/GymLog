import { useState, type FormEvent } from "react";
import { formatPlanSets } from "@gymlog/shared";
import type { Entry, Journal } from "../journal/journal.ts";
import { parseReps, parseWeight, showNumber } from "./numbers.ts";
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
  const parsedWeight = parseWeight(weight);
  const parsedReps = parseReps(reps);

  async function addSet(event: FormEvent) {
    event.preventDefault();
    if (!parsedWeight.ok || !parsedReps.ok) return;
    await journal.addPerformedSet(entry.id, { weight: parsedWeight.value, reps: parsedReps.value });
    await onChange();
  }

  return (
    <li className="entry">
      <h2 className="entry-name">{entry.exercise.primaryName}</h2>
      {entry.plannedSets.length > 0 ? (
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
          className="num-input"
          type="text"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="вес"
          aria-label="Вес, кг"
          aria-invalid={!parsedWeight.ok}
        />
        <span className="unit">кг ×</span>
        <input
          id={`new-set-reps-${entry.id}`}
          className="num-input reps"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="повт."
          aria-label="Повторы"
          aria-invalid={reps !== "" && !parsedReps.ok}
        />
        <button className="button" type="submit" disabled={!parsedWeight.ok || !parsedReps.ok}>
          + Подход
        </button>
      </form>
    </li>
  );
}
