import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { LocalDate } from "@gymlog/shared";
import { OwnExerciseRefusal, type Entry, type Journal } from "../journal/journal.ts";
import { SuggestionList, useSuggestions } from "./Suggestions.tsx";

interface SubstitutePickerProps {
  journal: Journal;
  entry: Entry;
  today: LocalDate;
  onSubstituted: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Chooses the Exercise of a Substitute: typed, or tapped among the suggestions, where last time's
 * Substitutes come first. It opens from a tap, so its name field takes focus and brings up the keyboard.
 */
export function SubstitutePicker({ journal, entry, today, onSubstituted, onCancel }: SubstitutePickerProps) {
  const [name, setName] = useState("");
  const suggestions = useSuggestions(journal, today, name, entry.id);
  /** The name given is the Entry's own Exercise, under another name or spelling. */
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  // Set at once, unlike state, so a second tap arriving before the next render is turned away.
  const savingNow = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    input.current?.focus();
  }, []);

  async function substitute(exerciseName: string) {
    if (!exerciseName.trim() || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    try {
      await journal.substituteEntry(entry.id, exerciseName);
      await onSubstituted();
    } catch (error) {
      if (!(error instanceof OwnExerciseRefusal)) throw error;
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
      <SuggestionList
        suggestions={suggestions}
        onPick={(exercise) => void substitute(exercise.primaryName)}
        disabled={saving}
      />
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
