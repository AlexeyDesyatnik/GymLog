import { useSyncExternalStore } from "react";
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

  // Opening takes a moment; screens come once the data can be used.
  if (store.status === "opening") return null;
  if (store.status !== "ready") return <StoreProblem problem={store} />;

  return route.screen === "workout" ? (
    <WorkoutScreen key={route.workoutId} journal={journal} workoutId={route.workoutId} today={today} />
  ) : (
    <WorkoutListScreen journal={journal} today={today} />
  );
}
