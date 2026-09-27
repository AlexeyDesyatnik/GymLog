import { useEffect, useState, type FormEvent } from "react";
import type { SignInProblem } from "@gymlog/shared";
import type { Journal } from "../journal/journal.ts";
import { SignInRefused } from "../sync/sync.ts";
import { workoutsHref } from "./useRoute.ts";

/** What the sign-in screen says when the server sent the browser back without signing it in. */
const PROBLEM_TEXT: Record<SignInProblem, string> = {
  noInvite:
    "Этот аккаунт VK ещё не зарегистрирован в GymLog. Аккаунт создаётся только по приглашению — попросите ссылку у владельца.",
  inviteUsed: "Это приглашение уже использовано. Если у вас уже есть аккаунт, войдите без него.",
  failed: "Не удалось войти через VK ID. Попробуйте ещё раз.",
  unavailable: "Вход через VK ID на этом сервере не настроен.",
};

/**
 * Signing in: on the first launch, before anything is recorded; through an Invite opened from
 * its link; or after the server said why signing in didn't work.
 */
export function SignInScreen({
  journal,
  invite,
  problem,
  firstLaunch,
}: {
  journal: Journal;
  invite?: string;
  problem?: SignInProblem;
  /** Nobody has signed in on this device yet, so there are no Workouts to go back to. */
  firstLaunch: boolean;
}) {
  const inviteUsable = useInviteUsable(journal, invite);
  // A used Invite can't help; someone with an account signs in without it.
  const signInInvite = inviteUsable === false ? undefined : invite;
  const shownProblem = problem ?? (inviteUsable === false ? "inviteUsed" : undefined);

  return (
    <main className="page">
      {!firstLaunch && (
        <a className="back" href={workoutsHref}>
          ← Тренировки
        </a>
      )}
      <h1>GymLog</h1>
      {shownProblem ? (
        <p className="sign-in-problem" role="alert">
          {PROBLEM_TEXT[shownProblem]}
        </p>
      ) : invite !== undefined ? (
        <p className="sign-in-text">Вас пригласили в GymLog. Войдите через VK ID — аккаунт создастся при первом входе.</p>
      ) : (
        <p className="sign-in-text">
          Войдите, чтобы начать. Тренировки хранятся на этом устройстве и синхронизируются с другими вашими
          устройствами. Аккаунт создаётся только по приглашению.
        </p>
      )}
      <SignInButtons
        journal={journal}
        invite={signInInvite}
        // Once in, the list of Workouts; the Invite's link has done its job.
        onSignedIn={() => (window.location.hash = workoutsHref)}
      />
    </main>
  );
}

/** Whether the Invite can still give someone an account; null until known, or when it can't be checked. */
function useInviteUsable(journal: Journal, invite: string | undefined): boolean | null {
  const [usable, setUsable] = useState<{ invite: string; usable: boolean } | null>(null);
  useEffect(() => {
    if (invite === undefined) return;
    let current = true;
    journal.sync.inviteUsable(invite).then(
      (answer) => current && setUsable({ invite, usable: answer }),
      // Offline, say, the sign-in itself will tell.
      () => {},
    );
    return () => {
      current = false;
    };
  }, [journal, invite]);
  return usable !== null && usable.invite === invite ? usable.usable : null;
}

/**
 * The way to sign in, through the Invite if given: VK ID, and in development also the test
 * sign-in by name, so two browsers can act as one user or as two.
 */
export function SignInButtons({
  journal,
  invite,
  onSignedIn,
}: {
  journal: Journal;
  invite?: string;
  onSignedIn?: () => void;
}) {
  return (
    <div className="sign-in">
      {/* A plain link: the browser leaves for VK ID and comes back to the app. */}
      <a className="button primary button-link" href={journal.sync.vkSignInUrl(invite)}>
        Войти через VK ID
      </a>
      {import.meta.env.DEV && <TestSignIn journal={journal} invite={invite} onSignedIn={onSignedIn} />}
    </div>
  );
}

function TestSignIn({ journal, invite, onSignedIn }: { journal: Journal; invite?: string; onSignedIn?: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await journal.sync.testSignIn(name.trim(), invite);
      onSignedIn?.();
    } catch (failure) {
      setError(failure instanceof SignInRefused ? PROBLEM_TEXT[failure.refusal] : String(failure));
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
      {error !== null && (
        <p className="sync-status" role="alert">
          Не удалось войти: {error}
        </p>
      )}
    </form>
  );
}
