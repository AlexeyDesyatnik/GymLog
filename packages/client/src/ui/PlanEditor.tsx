import { useState } from "react";
import { parsePlan, type PlanLineProblem } from "@gymlog/shared";
import type { Journal } from "../journal/journal.ts";
import { showNumber } from "./numbers.ts";
import { clearPlanDraft, savePlanDraft, type PlanDraft } from "./planDraft.ts";

interface PlanEditorProps {
  journal: Journal;
  workoutId: string;
  /** What the editor opens with: the stored Plan, or an unfinished draft of it. */
  draft: PlanDraft;
  onClose: () => void;
  onApplied: () => Promise<void>;
}

const PROBLEMS: Record<PlanLineProblem, string> = {
  "no-groups": "После названия нужны подходы, например 80x5x3.",
  "no-name": "Нет названия упражнения.",
  "broken-group": "Похоже на недописанный подход, например «80x» без повторов.",
  "zero-reps-or-sets": "Повторов и подходов должно быть не меньше одного.",
};

type Outcome = "editing" | "lines-skipped" | "failed";

export function PlanEditor({ journal, workoutId, draft, onClose, onApplied }: PlanEditorProps) {
  const [notation, setNotation] = useState(draft.notation);
  const [outcome, setOutcome] = useState<Outcome>("editing");
  const lines = notation.split(/\r?\n/).filter((line) => line.trim() !== "");
  const readings = parsePlan(notation);

  function change(value: string) {
    setNotation(value);
    setOutcome("editing");
    savePlanDraft(workoutId, { notation: value, basedOn: draft.basedOn });
  }

  async function done() {
    try {
      const results = await journal.setPlan(workoutId, notation);
      await onApplied();
      if (results.every((r) => r.ok)) {
        clearPlanDraft(workoutId);
        onClose();
      } else {
        setOutcome("lines-skipped");
      }
    } catch {
      setOutcome("failed");
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
          className="plan-text"
          value={notation}
          onChange={(e) => change(e.target.value)}
          placeholder={"bench press 80x5x3 70x8\npull-up x8x3"}
          rows={Math.max(4, lines.length + 1)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>

      {readings.length > 0 ? (
        <ul className="plan-lines">
          {readings.map((reading, i) =>
            reading.ok ? (
              <li key={i} className="plan-line">
                <span className="plan-line-name">✓ {reading.exerciseName}</span>
                <span className="plan-line-groups">
                  {reading.groups.map((g, j) => (
                    <span key={j} className="plan-chip">
                      {g.weight === null ? "без веса" : `${showNumber(g.weight)} кг`} × {g.reps}
                      {g.sets > 1 ? ` × ${g.sets} подх.` : ""}
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
      ) : outcome === "failed" ? (
        <p className="plan-message" role="alert">
          План не сохранился: в тренировке уже записаны подходы, и план теперь менять нельзя. Нажмите «Отмена».
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
