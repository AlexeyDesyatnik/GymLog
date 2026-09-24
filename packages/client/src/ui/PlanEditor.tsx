import { useState } from "react";
import { parsePlanLine, type PlanLineProblem } from "@gymlog/shared";
import type { Journal } from "../journal/journal.ts";
import { showNumber } from "./numbers.ts";
import { clearPlanDraft, savePlanDraft } from "./planDraft.ts";

interface PlanEditorProps {
  journal: Journal;
  workoutId: string;
  initialText: string;
  onClose: () => void;
  onApplied: () => Promise<void>;
}

const PROBLEMS: Record<PlanLineProblem, string> = {
  "no-groups": "После названия нужны подходы, например 80x5x3.",
  "no-name": "Нет названия упражнения.",
  "zero-reps-or-sets": "Повторов и подходов должно быть не меньше одного.",
};

export function PlanEditor({ journal, workoutId, initialText, onClose, onApplied }: PlanEditorProps) {
  const [text, setText] = useState(initialText);
  const [leftOut, setLeftOut] = useState(false);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const parsed = lines.map((line) => ({ line, result: parsePlanLine(line) }));

  function change(value: string) {
    setText(value);
    setLeftOut(false);
    savePlanDraft(workoutId, value);
  }

  async function done() {
    const results = await journal.setPlan(workoutId, text);
    await onApplied();
    if (results.every((r) => r.ok)) {
      clearPlanDraft(workoutId);
      onClose();
    } else {
      setLeftOut(true);
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
          id={`plan-text-${workoutId}`}
          className="plan-text"
          value={text}
          onChange={(e) => change(e.target.value)}
          placeholder={"bench press 80x5x3 70x8\npull-up x8x3"}
          rows={Math.max(4, lines.length + 1)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>

      {parsed.length > 0 ? (
        <ul className="plan-lines">
          {parsed.map(({ line, result }, i) =>
            result.ok ? (
              <li key={i} className="plan-line">
                <span className="plan-line-name">✓ {result.exerciseName}</span>
                <span className="plan-line-groups">
                  {result.groups.map((g, j) => (
                    <span key={j} className="plan-chip">
                      {g.weight === null ? "без веса" : `${showNumber(g.weight)} кг`} × {g.reps}
                      {g.sets > 1 ? ` × ${g.sets} подх.` : ""}
                    </span>
                  ))}
                </span>
              </li>
            ) : (
              <li key={i} className="plan-line bad">
                <span className="plan-line-name">✕ {line}</span>
                <span className="plan-line-problem">{PROBLEMS[result.problem]}</span>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {leftOut ? (
        <p className="plan-left-out" role="status">
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
