import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { isRefusal, type Entry, type Exercise, type Journal } from "../journal/journal.ts";

/** How many suggestions fit above the phone keyboard. */
const SUGGESTION_COUNT = 5;

interface SubstitutePickerProps {
  journal: Journal;
  entry: Entry;
  onSubstituted: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Chooses the Exercise of a Substitute: typed, or tapped among the suggestions, where last time's
 * Substitutes come first. It opens from a tap, so its name field takes focus and brings up the keyboard.
 */
export function SubstitutePicker({ journal, entry, onSubstituted, onCancel }: SubstitutePickerProps) {
  const [name, setName] = useState("");
  const [suggestions, setSuggestions] = useState<Exercise[]>([]);
  /** The name given was refused, e.g. the Entry's own Exercise under another name. */
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  // Set at once, unlike state, so a second tap arriving before the next render is turned away.
  const savingNow = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    // Only the answer for the latest text is shown, whatever order the answers come in.
    let current = true;
    journal.suggestSubstitutes(entry.id, name).then(
      (found) => {
        if (current) setSuggestions(found.slice(0, SUGGESTION_COUNT));
      },
      // The Entry is gone, e.g. deleted on another screen: there is nothing to suggest for.
      (error: unknown) => {
        if (!isRefusal(error)) throw error;
        if (current) setSuggestions([]);
      },
    );
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
    } catch (error) {
      if (!isRefusal(error)) throw error;
      setRefused(true);
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
          onChange={(e) => {
            setName(e.target.value);
            setRefused(false);
          }}
          placeholder="упражнение"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={refused}
        />
      </label>
      {refused ? <p className="plan-message">Замена должна быть другим упражнением.</p> : null}
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
