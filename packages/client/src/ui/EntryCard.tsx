import { useRef, useState, type FormEvent } from "react";
import { formatPlanSets } from "@gymlog/shared";
import type { Entry, Journal } from "../journal/journal.ts";
import { parseReps, parseWeight, showNumber, showRpe, showWeight } from "./numbers.ts";
import { ConfirmDelete } from "./ConfirmDelete.tsx";
import { formatSetCount } from "./format.ts";
import { SetRow } from "./SetRow.tsx";

interface EntryCardProps {
  journal: Journal;
  entry: Entry;
  /** The Workout is Finished, so the Entry is read-only and shows what was Not performed. */
  finished: boolean;
  onChange: () => Promise<void>;
}

export function EntryCard({ journal, entry, finished, onChange }: EntryCardProps) {
  const performedPairs = entry.pairs.filter((pair) => pair.performed !== null);
  const [nextPlanned, ...laterPlanned] = entry.pairs.flatMap((pair) => (pair.performed ? [] : [pair.planned!]));
  const notPerformed = entry.pairs.flatMap((pair, i) =>
    pair.notPerformed ? [{ set: pair.planned!, number: i + 1 }] : [],
  );
  const suggestion = entry.nextSet;
  /**
   * What the user typed over the suggestion (number prefill), and for which Set number:
   * once that Set is recorded or one is deleted, the typing no longer applies.
   */
  const [typed, setTyped] = useState<{ number: number; weight: string; reps: string } | null>(null);
  const nextNumber = performedPairs.length + 1;
  const typing = typed !== null && typed.number === nextNumber ? typed : null;
  const weight = typing?.weight ?? (suggestion ? showNumber(suggestion.weight) : "");
  const reps = typing?.reps ?? (suggestion ? String(suggestion.reps) : "");
  const prefilled = typing === null && suggestion !== null;
  const parsedWeight = parseWeight(weight);
  const parsedReps = parseReps(reps);
  // The next Planned Set's own numbers, typed or not, confirm it; other numbers record it as
  // performed differently. Either way the button reads "✓ Сделано" while a Planned Set is next.
  const asPlanned =
    nextPlanned !== undefined &&
    parsedWeight.ok &&
    parsedReps.ok &&
    parsedWeight.value === nextPlanned.weight &&
    parsedReps.value === nextPlanned.reps;
  const [saving, setSaving] = useState(false);
  // Set at once, unlike state, so a second tap arriving before the next render is turned away.
  const savingNow = useRef(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const hasPlan = entry.plannedSets.length > 0;

  function type(values: { weight: string; reps: string }) {
    setTyped({ number: nextNumber, ...values });
  }

  async function addSet(event: FormEvent) {
    event.preventDefault();
    if (!parsedWeight.ok || !parsedReps.ok || savingNow.current) return;
    // One Set per tap: a second tap before the list reloads would record the Set after it.
    savingNow.current = true;
    setSaving(true);
    try {
      if (asPlanned) await journal.confirmPlannedSet(entry.id);
      else await journal.addPerformedSet(entry.id, { weight: parsedWeight.value, reps: parsedReps.value });
      setTyped(null);
      await onChange();
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
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
        {hasPlan || finished ? null : (
          <button className="button quiet muted-text" type="button" onClick={() => setConfirmingDelete(true)}>
            Удалить
          </button>
        )}
      </div>
      {hasPlan ? (
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
              beyondPlan={hasPlan && planned === null}
              deletable={i === performedPairs.length - 1}
              readOnly={finished}
              number={i + 1}
              onChange={onChange}
            />
          ))}
        </ol>
      ) : null}

      {finished ? null : (
        <form className="add-set" onSubmit={addSet}>
          <div className="add-set-row">
            <span className="set-number" aria-hidden="true">
              {nextNumber}
            </span>
            <input
              id={`new-set-weight-${entry.id}`}
              className={`num-input${prefilled ? " prefilled" : ""}`}
              type="text"
              inputMode="decimal"
              value={weight}
              onChange={(e) => type({ weight: e.target.value, reps })}
              placeholder={suggestion !== null && suggestion.weight === null ? "—" : "вес"}
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
              onChange={(e) => type({ weight, reps: e.target.value })}
              placeholder="повт."
              aria-label="Повторы"
              aria-invalid={reps !== "" && !parsedReps.ok}
            />
            <button className="button primary" type="submit" disabled={!parsedWeight.ok || !parsedReps.ok || saving}>
              {nextPlanned ? "✓ Сделано" : "+ Подход"}
            </button>
          </div>
          {nextPlanned?.targetRpe != null ? (
            <p className="set-target">цель RPE {showRpe(nextPlanned.targetRpe)}</p>
          ) : null}
        </form>
      )}

      {!finished && laterPlanned.length > 0 ? (
        <ol className="sets upcoming" aria-label="Впереди по плану">
          {laterPlanned.map((set, i) => (
            <li key={set.id} className="upcoming-set">
              <span className="set-number">{nextNumber + 1 + i}</span>
              <span className="set-value">{showWeight(set.weight)}</span>
              <span className="unit">кг ×</span>
              <span className="set-value reps">{set.reps}</span>
              {set.targetRpe === null ? null : (
                <span className="upcoming-target">цель RPE {showRpe(set.targetRpe)}</span>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      {notPerformed.length > 0 ? (
        <ol className="sets upcoming" aria-label="Не выполнены">
          {notPerformed.map(({ set, number }) => (
            <li key={set.id} className="upcoming-set">
              <span className="set-number">{number}</span>
              <span className="set-value">{showWeight(set.weight)}</span>
              <span className="unit">кг ×</span>
              <span className="set-value reps">{set.reps}</span>
              <span className="not-performed">не выполнен</span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}
