import { useEffect, useState, useSyncExternalStore } from "react";
import { ChangeNotSaved, type Journal } from "../journal/journal.ts";
import { ResetLinkScreen, SignInScreen, SignUpScreen } from "./SignIn.tsx";
import { StoreProblem, type StoreProblemState } from "./StoreProblem.tsx";
import { useRoute } from "./useRoute.ts";
import { useToday } from "./useToday.ts";
import { WorkoutListScreen } from "./WorkoutListScreen.tsx";
import { WorkoutScreen } from "./WorkoutScreen.tsx";

export function App({ journal }: { journal: Journal }) {
  const route = useRoute();
  const today = useToday();
  const store = useSyncExternalStore(journal.onStoreStateChange, journal.storeState);
  const sync = useSyncExternalStore(journal.sync.onStateChange, journal.sync.state);
  const slowOpening = useSlowOpening(store.status === "opening");
  const failure = useUnhandledFailure();

  // Opening takes a moment; screens come once the data can be used. A copy of the app
  // frozen in the background (a tab, a window opened from Telegram) can hold the store
  // without the browser ever reporting it blocked, so a long opening is shown as blocked.
  if (store.status === "opening") return slowOpening ? <StoreProblem problem={{ status: "blocked" }} /> : null;
  if (store.status !== "ready") return <StoreProblem problem={store} />;
  if (failure !== null) return <StoreProblem problem={failure} />;
  // A moment, while the store says whether anyone has signed in here.
  if (sync.status === "checking") return null;

  // Nothing is recorded before the first sign-in, so every record has an owner.
  const firstLaunch = sync.status === "neverSignedIn";
  if (route.screen === "signUp") {
    return <SignUpScreen journal={journal} invite={route.invite} firstLaunch={firstLaunch} />;
  }
  if (route.screen === "resetLink") {
    return <ResetLinkScreen journal={journal} resetLink={route.resetLink} firstLaunch={firstLaunch} />;
  }
  if (firstLaunch) return <SignInScreen journal={journal} />;
  return route.screen === "workout" ? (
    <WorkoutScreen key={route.workoutId} journal={journal} workoutId={route.workoutId} today={today} />
  ) : (
    <WorkoutListScreen journal={journal} today={today} />
  );
}

/**
 * The first failure nobody handled: a read or change the store couldn't carry out, or a
 * refusal the UI should never have asked for. Screens leave these unhandled on purpose,
 * so none of them can end in a button that does nothing.
 */
function useUnhandledFailure(): StoreProblemState | null {
  const [failure, setFailure] = useState<StoreProblemState | null>(null);
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => setFailure((first) => first ?? failureOf(event.reason));
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return failure;
}

/** A failed change says it wasn't saved; anything else, that the data couldn't be used. */
function failureOf(reason: unknown): StoreProblemState {
  return reason instanceof ChangeNotSaved
    ? { status: "notSaved", error: String(reason.cause) }
    : { status: "failed", error: String(reason) };
}

/** Opening has gone on for longer than it ever takes on its own. */
function useSlowOpening(opening: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => setSlow(true), 2000);
    return () => clearTimeout(timer);
  }, [opening]);
  return slow;
}
