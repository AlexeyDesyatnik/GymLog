import { useEffect, useState, useSyncExternalStore } from "react";
import type { Journal } from "../journal/journal.ts";
import { StoreProblem } from "./StoreProblem.tsx";
import { useRoute } from "./useRoute.ts";
import { useToday } from "./useToday.ts";
import { WorkoutListScreen } from "./WorkoutListScreen.tsx";
import { WorkoutScreen } from "./WorkoutScreen.tsx";

export function App({ journal }: { journal: Journal }) {
  const route = useRoute();
  const today = useToday();
  const store = useSyncExternalStore(journal.onStoreStateChange, journal.storeState);
  const slowOpening = useSlowOpening(store.status === "opening");

  // Opening takes a moment; screens come once the data can be used. A copy of the app
  // frozen in the background (a tab, a window opened from Telegram) can hold the store
  // without the browser ever reporting it blocked, so a long opening is shown as blocked.
  if (store.status === "opening") return slowOpening ? <StoreProblem problem={{ status: "blocked" }} /> : null;
  if (store.status !== "ready") return <StoreProblem problem={store} />;

  return route.screen === "workout" ? (
    <WorkoutScreen key={route.workoutId} journal={journal} workoutId={route.workoutId} today={today} />
  ) : (
    <WorkoutListScreen journal={journal} today={today} />
  );
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
