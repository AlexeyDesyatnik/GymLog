/**
 * The Plan editor's unfinished text, kept on this device so a locked phone or a
 * closed app doesn't lose it. Only the Journal's structure is the Plan; this is
 * just a draft, and browser storage may be unavailable, so every access is guarded.
 */

const key = (workoutId: string) => `gymlog.plan-draft.${workoutId}`;

export function loadPlanDraft(workoutId: string): string | null {
  try {
    return localStorage.getItem(key(workoutId));
  } catch {
    return null;
  }
}

export function savePlanDraft(workoutId: string, text: string): void {
  try {
    localStorage.setItem(key(workoutId), text);
  } catch {
    // Without storage the draft lives only in the open editor.
  }
}

export function clearPlanDraft(workoutId: string): void {
  try {
    localStorage.removeItem(key(workoutId));
  } catch {
    // Nothing to clear.
  }
}
