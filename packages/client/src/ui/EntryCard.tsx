import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { formatPlanSets, formatReps } from "@gymlog/shared";
import type { Entry, Journal, PlannedSet } from "../journal/journal.ts";
import { parseReps, parseWeight, showNumber, showRpe, showWeight } from "./numbers.ts";
import { ConfirmDelete } from "./ConfirmDelete.tsx";
import { formatSetCount } from "./format.ts";
import { SetRow } from "./SetRow.tsx";
import { SubstitutePicker } from "./SubstitutePicker.tsx";

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
  // A Rep range leaves the reps to the user, so there may be none to start from.
  const reps = typing?.reps ?? (suggestion?.reps != null ? String(suggestion.reps) : "");
  const prefilled = typing === null && suggestion !== null;
  // An empty reps field shows the Rep range to pick from.
  const repsPlaceholder = nextPlanned?.maxReps != null ? formatReps(nextPlanned.reps, nextPlanned.maxReps) : "повт.";
  const parsedWeight = parseWeight(weight);
  const parsedReps = parseReps(reps);
  // The next Planned Set's own numbers, typed or not, confirm it; other numbers, or any with a
  // Rep range, record it as performed. Either way the button reads "✓ Сделано" while a Planned
  // Set is next.
  const confirms =
    nextPlanned !== undefined &&
    nextPlanned.maxReps === null &&
    parsedWeight.ok &&
    parsedReps.ok &&
    parsedWeight.value === nextPlanned.weight &&
    parsedReps.value === nextPlanned.reps;
  const [saving, setSaving] = useState(false);
  // Set at once, unlike state, so a second tap arriving before the next render is turned away.
  const savingNow = useRef(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [substituting, setSubstituting] = useState(false);
  const hasPlan = entry.plannedSets.length > 0;
  const replaced = entry.replacedBy !== null;

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
      if (confirms) await journal.confirmPlannedSet(entry.id);
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

  function openSubstitutePicker() {
    // Opening synchronously within the tap lets the picker take focus and bring up the keyboard.
    flushSync(() => setSubstituting(true));
  }

  if (confirmingDelete) {
    const sets = entry.performedSets.length;
    const what = `${entry.exercise.primaryName}${sets > 0 ? ` и ${formatSetCount(sets)}` : ""}`;
    return (
      <ConfirmDelete
        className="entry"
        question={
          entry.replaces
            ? `Удалить замену ${what}? ${entry.replaces.primaryName} снова можно будет выполнить.`
            : `Удалить ${what}?`
        }
        onDelete={deleteEntry}
        onCancel={() => setConfirmingDelete(false)}
      />
    );
  }

  return (
    <li className={`entry${replaced ? " replaced" : ""}`}>
      <div className="entry-head">
        <h2 className="entry-name">{entry.exercise.primaryName}</h2>
        {/* An Entry from the Plan is removed by editing the Plan notation. */}
        {hasPlan || finished ? null : (
          <button className="button quiet muted-text" type="button" onClick={() => setConfirmingDelete(true)}>
            Удалить
          </button>
        )}
        {entry.substitutable && !substituting ? (
          <button className="button quiet" type="button" onClick={openSubstitutePicker}>
            Заменить
          </button>
        ) : null}
      </div>
      {entry.replaces ? <p className="substitute-note">вместо {entry.replaces.primaryName}</p> : null}
      {hasPlan ? (
        <p className="entry-plan">
          <span className="entry-plan-label">План</span> {formatPlanSets(entry.plannedSets)}
        </p>
      ) : null}
      {entry.replacedBy ? (
        <p className="replaced-note">
          Заменено на <strong>{entry.replacedBy.primaryName}</strong>
        </p>
      ) : null}
      {entry.substitutable && substituting ? (
        <SubstitutePicker
          journal={journal}
          entry={entry}
          onSubstituted={async () => {
            setSubstituting(false);
            await onChange();
          }}
          onCancel={() => setSubstituting(false)}
        />
      ) : null}

      {performedPairs.length > 0 ? (
        <ol className="sets">
          {performedPairs.map(({ planned, performed, asPlanned }, i) => (
            <SetRow
              key={performed!.id}
              journal={journal}
              set={performed!}
              planned={planned}
              asPlanned={asPlanned}
              beyondPlan={hasPlan && planned === null}
              deletable={i === performedPairs.length - 1}
              readOnly={finished}
              number={i + 1}
              onChange={onChange}
            />
          ))}
        </ol>
      ) : null}

      {/* A replaced Entry's Sets go to its Substitute. */}
      {finished || replaced || substituting ? null : (
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
              placeholder={repsPlaceholder}
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

      {!finished && !replaced && !substituting && laterPlanned.length > 0 ? (
        <ol className="sets upcoming" aria-label="Впереди по плану">
          {laterPlanned.map((set, i) => (
            <UnpairedPlannedSet key={set.id} set={set} number={nextNumber + 1 + i}>
              {set.targetRpe === null ? null : (
                <span className="upcoming-target">цель RPE {showRpe(set.targetRpe)}</span>
              )}
            </UnpairedPlannedSet>
          ))}
        </ol>
      ) : null}

      {notPerformed.length > 0 ? (
        <ol className="sets upcoming" aria-label="Не выполнены">
          {notPerformed.map(({ set, number }) => (
            <UnpairedPlannedSet key={set.id} set={set} number={number}>
              <span className="not-performed">не выполнен</span>
            </UnpairedPlannedSet>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/** A quiet row for a Planned Set with no Performed Set, with a note after its numbers. */
function UnpairedPlannedSet({ set, number, children }: { set: PlannedSet; number: number; children: ReactNode }) {
  return (
    <li className="upcoming-set">
      <span className="set-number">{number}</span>
      <span className="set-value">{showWeight(set.weight)}</span>
      <span className="unit">кг ×</span>
      <span className="set-value reps">{formatReps(set.reps, set.maxReps)}</span>
      {children}
    </li>
  );
}
