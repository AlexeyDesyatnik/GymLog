import { useEffect, useState } from "react";

export type Route = { screen: "workouts" } | { screen: "workout"; workoutId: string };

/** Screens live in the URL hash, so the phone's back button and a reload keep the user in place. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));

  useEffect(() => {
    const update = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return route;
}

export function workoutHref(workoutId: string): string {
  return `#/workout/${workoutId}`;
}

export const workoutsHref = "#/";

function parse(hash: string): Route {
  const match = /^#\/workout\/([^/]+)$/.exec(hash);
  return match ? { screen: "workout", workoutId: decodeURIComponent(match[1]!) } : { screen: "workouts" };
}
