import { useEffect, useState } from "react";
import type { LocalDate } from "@gymlog/shared";
import type { Exercise, Journal } from "../journal/journal.ts";

/** How many suggestions fit above the phone keyboard. */
const SUGGESTION_COUNT = 5;

/**
 * The first Exercises suggested for the typed text, ranked by use; for a Substitute of this
 * Entry, when one is given. None while the text is null.
 */
export function useSuggestions(journal: Journal, today: LocalDate, text: string | null, entryId?: string): Exercise[] {
  const [found, setFound] = useState<Exercise[]>([]);

  useEffect(() => {
    if (text === null) return;
    // Only the answer for the latest text is shown, whatever order the answers come in.
    let current = true;
    const suggesting =
      entryId === undefined ? journal.suggestExercises(text, today) : journal.suggestSubstitutes(entryId, text, today);
    void suggesting.then((exercises) => {
      if (current) setFound(exercises.slice(0, SUGGESTION_COUNT));
    });
    return () => {
      current = false;
    };
  }, [journal, today, text, entryId]);

  return text === null ? [] : found;
}

interface SuggestionListProps {
  suggestions: Exercise[];
  onPick: (exercise: Exercise) => void;
  disabled?: boolean;
  /** A tap leaves the focus in the field typed in, so the phone keyboard stays up. */
  keepFocus?: boolean;
}

/** Suggested Exercises to tap, by Primary name. */
export function SuggestionList({ suggestions, onPick, disabled = false, keepFocus = false }: SuggestionListProps) {
  if (suggestions.length === 0) return null;
  return (
    <ul className="suggestions" aria-label="Подсказки">
      {suggestions.map((exercise) => (
        <li key={exercise.id}>
          <button
            className="suggestion"
            type="button"
            onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
            onClick={() => onPick(exercise)}
            disabled={disabled}
          >
            {exercise.primaryName}
          </button>
        </li>
      ))}
    </ul>
  );
}
