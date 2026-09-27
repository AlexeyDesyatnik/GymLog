import { useEffect, useState, type FormEvent } from "react";
import {
  LOGIN_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SIGN_IN_LOCK_MINUTES,
  type SignInRefusal,
} from "@gymlog/shared";
import type { Journal } from "../journal/journal.ts";
import { SignInRefused } from "../sync/api.ts";
import { workoutsHref } from "./useRoute.ts";

/** What each refusal from the server says. */
const REFUSAL_TEXT: Record<SignInRefusal, string> = {
  inviteUnusable: "Это приглашение уже использовано или недействительно. Если у вас уже есть аккаунт, войдите.",
  loginTaken: "Этот логин уже занят, выберите другой.",
  wrongPassword: "Неверный логин или пароль.",
  tooManyAttempts: `Слишком много неверных паролей подряд. Попробуйте через ${SIGN_IN_LOCK_MINUTES} минут.`,
  resetUnusable: "Эта ссылка для нового пароля уже использована или устарела. Попросите у владельца новую.",
};

/** On the first launch, before anything is recorded: signing in with a login and a password. */
export function SignInScreen({ journal }: { journal: Journal }) {
  return (
    <main className="page">
      <h1>GymLog</h1>
      <p className="sign-in-text">
        Войдите, чтобы начать. Тренировки хранятся на этом устройстве и синхронизируются с другими вашими
        устройствами. Аккаунт создаётся только по приглашению владельца.
      </p>
      <SignInForm journal={journal} />
    </main>
  );
}

/** Signing in with a login and a password: on the first launch, and when the session on this device has ended. */
export function SignInForm({ journal }: { journal: Journal }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, attempt } = useAttempt();

  function submit(event: FormEvent) {
    event.preventDefault();
    void attempt(() => journal.account.signIn(login, password));
  }

  return (
    <form className="sign-in" onSubmit={submit}>
      <LoginField value={login} onChange={setLogin} autoComplete="username" />
      <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="current-password" />
      <button className="button primary" type="submit" disabled={busy || !login.trim() || !password}>
        Войти
      </button>
      <AttemptError error={error} />
    </form>
  );
}

/** Creating an account through an Invite opened from its link: the person chooses a login and a password. */
export function SignUpScreen({
  journal,
  invite,
  firstLaunch,
}: {
  journal: Journal;
  invite: string;
  firstLaunch: boolean;
}) {
  const usable = useChecked(journal, invite, (token) => journal.account.inviteUsable(token));
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, attempt } = useAttempt();

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Once in, the list of Workouts; the Invite's link has done its job.
    if (await attempt(() => journal.account.signUp(invite, login, password))) window.location.hash = workoutsHref;
  }

  return (
    <main className="page">
      {!firstLaunch && <BackToWorkouts />}
      <h1>GymLog</h1>
      {usable === false ? (
        <>
          <p className="sign-in-problem" role="alert">
            {REFUSAL_TEXT.inviteUnusable}
          </p>
          {/* Where a device nobody has signed in on shows the sign-in form. */}
          {firstLaunch && (
            <a className="button primary button-link" href={workoutsHref}>
              Войти
            </a>
          )}
        </>
      ) : (
        <form className="sign-in" onSubmit={(event) => void submit(event)}>
          <p className="sign-in-text">
            Вас пригласили в GymLog. Придумайте логин и пароль — по ним вы будете входить на любом устройстве.
          </p>
          <LoginField value={login} onChange={setLogin} autoComplete="username" />
          <NewPasswordField value={password} onChange={setPassword} />
          <button
            className="button primary"
            type="submit"
            disabled={busy || !login.trim() || password.length < PASSWORD_MIN_LENGTH}
          >
            Создать аккаунт
          </button>
          <AttemptError error={error} />
        </form>
      )}
    </main>
  );
}

/** Setting a new password through the owner's link, for a user who forgot theirs. */
export function PasswordResetScreen({
  journal,
  reset,
  firstLaunch,
}: {
  journal: Journal;
  reset: string;
  firstLaunch: boolean;
}) {
  const login = useChecked(journal, reset, (token) => journal.account.passwordResetLogin(token));
  const [password, setPassword] = useState("");
  const { busy, error, attempt } = useAttempt();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await attempt(() => journal.account.resetPassword(reset, password))) window.location.hash = workoutsHref;
  }

  return (
    <main className="page">
      {!firstLaunch && <BackToWorkouts />}
      <h1>Новый пароль</h1>
      {login === null ? (
        <p className="sign-in-problem" role="alert">
          {REFUSAL_TEXT.resetUnusable}
        </p>
      ) : (
        <form className="sign-in" onSubmit={(event) => void submit(event)}>
          {login !== undefined && <p className="sign-in-text">Логин: {login}</p>}
          <NewPasswordField value={password} onChange={setPassword} />
          <button
            className="button primary"
            type="submit"
            disabled={busy || password.length < PASSWORD_MIN_LENGTH}
          >
            Сохранить пароль
          </button>
          <AttemptError error={error} />
        </form>
      )}
    </main>
  );
}

function BackToWorkouts() {
  return (
    <a className="back" href={workoutsHref}>
      ← Тренировки
    </a>
  );
}

function LoginField({
  value,
  onChange,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="field">
      <span className="field-label">Логин</span>
      <input
        className="text-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={LOGIN_MAX_LENGTH}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
    </label>
  );
}

function NewPasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <PasswordField
      label="Пароль"
      hint={`Не меньше ${PASSWORD_MIN_LENGTH} символов.`}
      value={value}
      onChange={onChange}
      autoComplete="new-password"
    />
  );
}

/** A password, hidden as it is typed unless the user asks to see it, which helps on a phone keyboard. */
function PasswordField({
  label,
  hint,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-field">
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          className="text-input"
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <div className="password-extra">
        {hint !== undefined && <span className="hint">{hint}</span>}
        <button className="button quiet" type="button" onClick={() => setShown(!shown)}>
          {shown ? "Скрыть пароль" : "Показать пароль"}
        </button>
      </div>
    </div>
  );
}

function AttemptError({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <p className="sign-in-problem" role="alert">
      {error}
    </p>
  );
}

/** An attempt at the server, with whether it is under way and what went wrong with the last one. */
function useAttempt() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Resolves with whether it worked; a failure is kept to be shown, never thrown. */
  async function attempt(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(failure instanceof SignInRefused ? REFUSAL_TEXT[failure.refusal] : `Не удалось: ${String(failure)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, attempt };
}

/** What the server says about a link's token; undefined until it answers, or when it can't be asked. */
function useChecked<T>(journal: Journal, token: string, check: (token: string) => Promise<T>): T | undefined {
  const [checked, setChecked] = useState<{ token: string; value: T } | null>(null);
  useEffect(() => {
    let current = true;
    check(token).then(
      (value) => current && setChecked({ token, value }),
      // Offline, say, the form itself will tell.
      () => {},
    );
    return () => {
      current = false;
    };
    // The check is the same for the same Journal and token.
  }, [journal, token]);
  return checked !== null && checked.token === token ? checked.value : undefined;
}
