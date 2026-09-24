import type { Journal } from "../journal/journal.ts";
import { useRoute } from "./useRoute.ts";
import { useToday } from "./useToday.ts";
import { WorkoutListScreen } from "./WorkoutListScreen.tsx";
import { WorkoutScreen } from "./WorkoutScreen.tsx";

export function App({ journal }: { journal: Journal }) {
  const route = useRoute();
  const today = useToday();

  return route.screen === "workout" ? (
    <WorkoutScreen key={route.workoutId} journal={journal} workoutId={route.workoutId} today={today} />
  ) : (
    <WorkoutListScreen journal={journal} today={today} />
  );
}
