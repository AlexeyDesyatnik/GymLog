import type { StoreState } from "../journal/journal.ts";

/** Why the data on this device can't be used right now. */
export type StoreProblemState = Exclude<StoreState, { status: "opening" | "ready" }>;

/**
 * Shown in place of the screens while the data on this device can't be used, so the app
 * never sits empty with buttons that do nothing. An installed app has no reload button of
 * its own, hence the one here.
 */
export function StoreProblem({ problem }: { problem: StoreProblemState }) {
  return (
    <main className="page">
      <div className="store-problem" role="alert">
        {problem.status === "blocked" ? (
          <>
            <p className="store-problem-text">
              <strong>Закройте другие вкладки и окна GymLog на этом устройстве и обновите страницу.</strong>
            </p>
            <p className="hint">
              GymLog обновился, а его старая копия, открытая где-то ещё, не даёт подготовить данные. Как только
              она закроется, всё продолжится само.
            </p>
          </>
        ) : problem.status === "upgradedElsewhere" ? (
          <p className="store-problem-text">
            <strong>GymLog обновился в другой вкладке — обновите страницу.</strong>
          </p>
        ) : (
          <>
            <p className="store-problem-text">
              <strong>Не удалось открыть данные на этом устройстве.</strong>
            </p>
            <p className="hint">Ничего не удалено. Если ошибка повторяется, сообщите о ней, приложив этот текст:</p>
            <pre className="store-problem-error">{problem.error}</pre>
          </>
        )}
        <button className="button primary" type="button" onClick={() => window.location.reload()}>
          Обновить страницу
        </button>
      </div>
    </main>
  );
}
