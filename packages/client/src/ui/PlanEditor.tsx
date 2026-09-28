import { useLayoutEffect, useRef, useState } from "react";
import { formatReps, parsePlan, parsePlanLine, type LocalDate, type PlanLineProblem } from "@gymlog/shared";
import type { Exercise, Journal } from "../journal/journal.ts";
import { showNumber, showRpe } from "./numbers.ts";
import { clearPlanDraft, savePlanDraft, type PlanDraft } from "./planDraft.ts";
import { SuggestionList, useSuggestions } from "./Suggestions.tsx";

interface PlanEditorProps {
  journal: Journal;
  workoutId: string;
  today: LocalDate;
  /** What the editor opens with: the stored Plan, or an unfinished draft of it. */
  draft: PlanDraft;
  /** Put the cursor at the end of the notation at once, so typing can start without another tap. */
  focusOnOpen: boolean;
  onClose: () => void;
  onApplied: () => Promise<void>;
}

const PROBLEMS: Record<PlanLineProblem, string> = {
  "no-groups": "После названия нужны подходы, например 80x5x3.",
  "no-name": "Нет названия упражнения.",
  "broken-group": "Похоже на недописанный подход, например «80x» без повторов.",
  "zero-reps-or-sets": "Повторов и подходов должно быть не меньше одного.",
  "bad-rep-range": "В диапазоне повторов сначала меньшее число, потом большее, например 10-12.",
  "bad-target-rpe": "Целевой RPE пишется сразу после подходов, например 100x5x3@7, и бывает 5, 6, 7, 7,5, 8, 8,5, 9, 9,5 или 10.",
};

type Outcome = "editing" | "lines-skipped";

/** Where the line holding the caret starts and ends in the notation. */
function lineAt(notation: string, caret: number): { start: number; end: number } {
  const start = notation.lastIndexOf("\n", caret - 1) + 1;
  const end = notation.indexOf("\n", caret);
  return { start, end: end === -1 ? notation.length : end };
}

export function PlanEditor({ journal, workoutId, today, draft, focusOnOpen, onClose, onApplied }: PlanEditorProps) {
  const [notation, setNotation] = useState(draft.notation);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Where the caret is; a controlled field starts with it at the end. */
  const [caret, setCaret] = useState(draft.notation.length);
  /** Where the caret goes once a picked suggestion is in the field. */
  const caretAfterPick = useRef<number | null>(null);
  /** The line a suggestion was picked for, as it was put in; it needs no more suggestions until it changes. */
  const [pickedLine, setPickedLine] = useState<string | null>(null);

  // A line with a name and no numbers yet is an Exercise name being typed.
  const caretLine = lineAt(notation, caret);
  const caretLineText = notation.slice(caretLine.start, caretLine.end);
  const caretLineReading = parsePlanLine(caretLineText);
  const typingName =
    caretLineText.trim() !== "" &&
    caretLineText !== pickedLine &&
    !caretLineReading.ok &&
    caretLineReading.problem === "no-groups";
  const suggestions = useSuggestions(journal, today, typingName ? caretLineText.trim() : null);

  useLayoutEffect(() => {
    const textarea = field.current;
    const position = caretAfterPick.current;
    if (!textarea || position === null) return;
    caretAfterPick.current = null;
    textarea.setSelectionRange(position, position);
  }, [notation]);

  // A layout effect runs while the opening tap is still being handled, which phones
  // require before they show the keyboard.
  useLayoutEffect(() => {
    const textarea = field.current;
    if (!focusOnOpen || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [focusOnOpen]);
  const [outcome, setOutcome] = useState<Outcome>("editing");
  const lines = notation.split(/\r?\n/).filter((line) => line.trim() !== "");
  const readings = parsePlan(notation);

  function change(value: string) {
    setNotation(value);
    setOutcome("editing");
    savePlanDraft(workoutId, { notation: value, basedOn: draft.basedOn });
  }

  /** Puts the picked Exercise's Primary name in place of the typed one, followed by last time's numbers. */
  async function pick(exercise: Exercise) {
    const numbers = await journal.prefillNumbers(workoutId, exercise.id);
    const line = numbers === null ? `${exercise.primaryName} ` : `${exercise.primaryName} ${numbers}`;
    const position = caretLine.start + line.length;
    caretAfterPick.current = position;
    setCaret(position);
    setPickedLine(line);
    change(notation.slice(0, caretLine.start) + line + notation.slice(caretLine.end));
  }

  async function done() {
    const results = await journal.setPlan(workoutId, notation);
    await onApplied();
    if (results.every((r) => r.ok)) {
      clearPlanDraft(workoutId);
      onClose();
    } else {
      setOutcome("lines-skipped");
    }
  }

  function cancel() {
    clearPlanDraft(workoutId);
    onClose();
  }

  return (
    <section className="plan-editor" aria-label="План тренировки">
      <label className="field">
        <span className="field-label">План: одна строка — одно упражнение</span>
        <textarea
          ref={field}
          className="plan-text"
          value={notation}
          onChange={(e) => {
            change(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          placeholder={"bench press 80x5x3 70x8\npull-up x8x3"}
          rows={Math.max(4, lines.length + 1)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>

      <SuggestionList suggestions={suggestions} onPick={(exercise) => void pick(exercise)} keepFocus />

      {readings.length > 0 ? (
        <ul className="plan-lines">
          {readings.map((reading, i) =>
            reading.ok ? (
              <li key={i} className="plan-line">
                <span className="plan-line-name">✓ {reading.exerciseName}</span>
                <span className="plan-line-groups">
                  {reading.groups.map((g, j) => (
                    <span key={j} className="plan-chip">
                      {g.weight === null ? "без веса" : `${showNumber(g.weight)} кг`} × {formatReps(g.reps, g.maxReps)}
                      {g.sets > 1 ? ` × ${g.sets} подх.` : ""}
                      {g.targetRpe === null ? "" : `, цель RPE ${showRpe(g.targetRpe)}`}
                    </span>
                  ))}
                </span>
              </li>
            ) : (
              <li key={i} className="plan-line bad">
                <span className="plan-line-name">✕ {lines[i]}</span>
                <span className="plan-line-problem">{PROBLEMS[reading.problem]}</span>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {outcome === "lines-skipped" ? (
        <p className="plan-message" role="status">
          Строки с ошибками не попали в план. Исправьте или удалите их и снова нажмите «Готово».
        </p>
      ) : null}

      <div className="actions">
        <button className="button primary" type="button" onClick={() => void done()}>
          Готово
        </button>
        <button className="button" type="button" onClick={cancel}>
          Отмена
        </button>
      </div>
    </section>
  );
}
