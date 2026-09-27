import { useEffect, useState } from "react";
import { SIGN_IN_PROBLEMS, type SignInProblem } from "@gymlog/shared";

export type Route =
  | { screen: "workouts" }
  | { screen: "workout"; workoutId: string }
  /** Signing in: through an Invite opened from its link, or after the server said why it didn't work. */
  | { screen: "signIn"; invite?: string; problem?: SignInProblem };

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

/** The link of an Invite, to send to the person invited. */
export function inviteLink(invite: string): string {
  return new URL(`#/invite/${invite}`, window.location.href).href;
}

function parse(hash: string): Route {
  const workout = /^#\/workout\/([^/]+)$/.exec(hash);
  if (workout) return { screen: "workout", workoutId: decodeURIComponent(workout[1]!) };
  const invite = /^#\/invite\/([^/]+)$/.exec(hash);
  if (invite) return { screen: "signIn", invite: decodeURIComponent(invite[1]!) };
  const problem = /^#\/sign-in\/([^/]+)$/.exec(hash)?.[1];
  if (isSignInProblem(problem)) return { screen: "signIn", problem };
  return { screen: "workouts" };
}

/** One of the problems the server names when it sends the browser back to the app without signing it in. */
function isSignInProblem(text: string | undefined): text is SignInProblem {
  return (SIGN_IN_PROBLEMS as readonly (string | undefined)[]).includes(text);
}
