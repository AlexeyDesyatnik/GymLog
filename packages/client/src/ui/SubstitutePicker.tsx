import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Entry, Exercise, Journal } from "../journal/journal.ts";

/** How many suggestions fit above the phone keyboard. */
const SUGGESTION_COUNT = 5;

interface SubstitutePickerProps {
  journal: Journal;
  entry: Entry;
  /** Opened by a tap, so the name field takes focus and brings up the keyboard. */
  focusOnOpen: boolean;
  onSubstituted: () => Promise<void>;
  onCancel: () => void;
}

/** Chooses the Exercise of a Substitute: typed, or tapped among the suggestions, where last time's Substitutes come first. */
export function SubstitutePicker({ journal, entry, focusOnOpen, onSubstituted, onCancel }: SubstitutePickerProps) {
  const [name, setName] = useState("");
  const [suggestions, setSuggestions] = useState<Exercise[]>([]);
  const [saving, setSaving] = useState(false);
  // Set at once, unlike state, so a second tap arriving before the next render is turned away.
  const savingNow = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (focusOnOpen) input.current?.focus();
  }, [focusOnOpen]);

  useEffect(() => {
    // Only the answer for the latest text is shown, whatever order the answers come in.
    let current = true;
    void journal.suggestSubstitutes(entry.id, name).then((found) => {
      if (current) setSuggestions(found.slice(0, SUGGESTION_COUNT));
    });
    return () => {
      current = false;
    };
  }, [journal, entry.id, name]);

  async function substitute(exerciseName: string) {
    if (!exerciseName.trim() || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    try {
      await journal.substituteEntry(entry.id, exerciseName);
      await onSubstituted();
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void substitute(name);
  }

  return (
    <form className="substitute-picker" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Чем заменить {entry.exercise.primaryName}</span>
        <input
          ref={input}
          id={`substitute-${entry.id}`}
          className="text-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="упражнение"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
        />
      </label>
      {suggestions.length > 0 ? (
        <ul className="suggestions" aria-label="Подсказки">
          {suggestions.map((exercise) => (
            <li key={exercise.id}>
              <button
                className="suggestion"
                type="button"
                onClick={() => void substitute(exercise.primaryName)}
                disabled={saving}
              >
                {exercise.primaryName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="actions">
        <button className="button primary" type="submit" disabled={!name.trim() || saving}>
          Заменить
        </button>
        <button className="button" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
