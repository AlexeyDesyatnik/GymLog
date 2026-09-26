import { useState, type FormEvent } from "react";
import { formatPlanSets } from "@gymlog/shared";
import type { Entry, Journal } from "../journal/journal.ts";
import { parseReps, parseWeight, showNumber } from "./numbers.ts";
import { ConfirmDelete } from "./ConfirmDelete.tsx";
import { formatSetCount } from "./format.ts";
import { SetRow } from "./SetRow.tsx";

interface EntryCardProps {
  journal: Journal;
  entry: Entry;
  onChange: () => Promise<void>;
}

export function EntryCard({ journal, entry, onChange }: EntryCardProps) {
  const performedPairs = entry.pairs.filter((pair) => pair.performed !== null);
  const [nextPlanned, ...laterPlanned] = entry.pairs.flatMap((pair) => (pair.performed ? [] : [pair.planned!]));
  // The next Set starts from the next Planned Set, or else from the previous Set, so doing
  // it as planned, or repeating a Set, is one tap.
  const suggestion = nextPlanned ?? entry.performedSets.at(-1) ?? null;
  /** What the user typed over the suggestion; null while the suggestion (number prefill) stands. */
  const [typed, setTyped] = useState<{ weight: string; reps: string } | null>(null);
  const weight = typed?.weight ?? (suggestion ? showNumber(suggestion.weight) : "");
  const reps = typed?.reps ?? (suggestion ? String(suggestion.reps) : "");
  const prefilled = typed === null && suggestion !== null;
  const confirming = prefilled && nextPlanned !== undefined;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const planned = entry.plannedSets.length > 0;
  const parsedWeight = parseWeight(weight);
  const parsedReps = parseReps(reps);

  async function addSet(event: FormEvent) {
    event.preventDefault();
    if (!parsedWeight.ok || !parsedReps.ok) return;
    if (confirming) await journal.confirmPlannedSet(entry.id);
    else await journal.addPerformedSet(entry.id, { weight: parsedWeight.value, reps: parsedReps.value });
    setTyped(null);
    await onChange();
  }

  async function deleteEntry() {
    await journal.deleteEntry(entry.id);
    await onChange();
  }

  if (confirmingDelete) {
    const sets = entry.performedSets.length;
    return (
      <ConfirmDelete
        className="entry"
        question={`Удалить ${entry.exercise.primaryName}${sets > 0 ? ` и ${formatSetCount(sets)}` : ""}?`}
        onDelete={deleteEntry}
        onCancel={() => setConfirmingDelete(false)}
      />
    );
  }

  return (
    <li className="entry">
      <div className="entry-head">
        <h2 className="entry-name">{entry.exercise.primaryName}</h2>
        {/* An Entry from the Plan is removed by editing the Plan notation. */}
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

      {performedPairs.length > 0 ? (
        <ol className="sets">
          {performedPairs.map(({ planned, performed }, i) => (
            <SetRow
              key={performed!.id}
              journal={journal}
              set={performed!}
              planned={planned}
              number={i + 1}
              onChange={onChange}
            />
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
          onChange={(e) => setTyped({ weight: e.target.value, reps })}
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
          onChange={(e) => setTyped({ weight, reps: e.target.value })}
          placeholder="повт."
          aria-label="Повторы"
          aria-invalid={reps !== "" && !parsedReps.ok}
        />
        <button className="button primary" type="submit" disabled={!parsedWeight.ok || !parsedReps.ok}>
          {confirming ? "✓ Сделано" : "+ Подход"}
        </button>
      </form>

      {laterPlanned.length > 0 ? (
        <ol className="sets upcoming" aria-label="Впереди по плану">
          {laterPlanned.map((set, i) => (
            <li key={set.id} className="upcoming-set">
              <span className="set-number">{performedPairs.length + 2 + i}</span>
              <span className="set-value">{set.weight === null ? "—" : showNumber(set.weight)}</span>
              <span className="unit">кг ×</span>
              <span className="set-value reps">{set.reps}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}
