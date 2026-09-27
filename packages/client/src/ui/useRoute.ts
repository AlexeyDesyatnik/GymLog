import { useEffect, useState } from "react";

export type Route =
  | { screen: "workouts" }
  | { screen: "workout"; workoutId: string }
  /** Creating an account through an Invite opened from its link. */
  | { screen: "signUp"; invite: string }
  /** Setting a new password through the owner's link. */
  | { screen: "passwordReset"; reset: string };

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

/** The link for a new password, to send to the user who forgot theirs. */
export function passwordResetLink(reset: string): string {
  return new URL(`#/reset/${reset}`, window.location.href).href;
}

function parse(hash: string): Route {
  const workout = /^#\/workout\/([^/]+)$/.exec(hash);
  if (workout) return { screen: "workout", workoutId: decodeURIComponent(workout[1]!) };
  const invite = /^#\/invite\/([^/]+)$/.exec(hash);
  if (invite) return { screen: "signUp", invite: decodeURIComponent(invite[1]!) };
  const reset = /^#\/reset\/([^/]+)$/.exec(hash);
  if (reset) return { screen: "passwordReset", reset: decodeURIComponent(reset[1]!) };
  return { screen: "workouts" };
}
