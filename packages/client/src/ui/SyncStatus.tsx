import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { Journal } from "../journal/journal.ts";

/** Whether this device's records reach the user's other devices, and the way to sign in. */
export function SyncStatus({ journal }: { journal: Journal }) {
  const state = useSyncExternalStore(journal.sync.onStateChange, journal.sync.state);
  switch (state.status) {
    case "off":
    case "starting":
      return null;
    case "signedOut":
      // Only the dev server has the test sign-in; VK ID sign-in comes later.
      return import.meta.env.DEV ? (
        <TestSignIn journal={journal} />
      ) : (
        <p className="sync-status">Вы не вошли: тренировки хранятся только на этом устройстве.</p>
      );
    case "synced":
      return <p className="sync-status">Синхронизировано с другими устройствами.</p>;
    case "otherUser":
      return (
        <p className="sync-status">
          На этом устройстве тренировки другого пользователя, поэтому они не синхронизируются.
        </p>
      );
    case "failed":
      return (
        <p className="sync-status">
          Нет связи с сервером. Всё записанное сохранено на этом устройстве и отправится, когда связь появится.
        </p>
      );
  }
}

/** Sign-in by name alone, so two browsers can act as one user or as two, in development only. */
function TestSignIn({ journal }: { journal: Journal }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await journal.sync.testSignIn(name.trim());
    } catch (failure) {
      setError(String(failure));
    }
  }

  return (
    <form className="create sync-sign-in" onSubmit={signIn}>
      <label className="field">
        <span className="field-label">Тестовый вход: имя пользователя</span>
        <input
          className="text-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <button className="button" type="submit" disabled={!name.trim()}>
        Войти
      </button>
      {error === null ? (
        <p className="sync-status">Вы не вошли: тренировки хранятся только на этом устройстве.</p>
      ) : (
        <p className="sync-status" role="alert">
          Не удалось войти: {error}
        </p>
      )}
    </form>
  );
}
