/**
 * The Plan editor's unfinished notation, kept on this device so a locked phone or a
 * closed app doesn't lose it. Only the Journal's structure is the Plan; this is just a
 * draft. It remembers the Plan it started from, so a draft made stale by a later change
 * to the Plan is dropped rather than shown over it. Browser storage may be unavailable,
 * so every access is guarded.
 */

export interface PlanDraft {
  notation: string;
  /** The Plan notation the editor opened with. */
  basedOn: string;
}

const key = (workoutId: string) => `gymlog.plan-draft.${workoutId}`;

export function loadPlanDraft(workoutId: string): PlanDraft | null {
  try {
    const stored = localStorage.getItem(key(workoutId));
    if (stored === null) return null;
    const draft = JSON.parse(stored) as Partial<PlanDraft>;
    return typeof draft.notation === "string" && typeof draft.basedOn === "string"
      ? { notation: draft.notation, basedOn: draft.basedOn }
      : null;
  } catch {
    return null;
  }
}

export function savePlanDraft(workoutId: string, draft: PlanDraft): void {
  try {
    localStorage.setItem(key(workoutId), JSON.stringify(draft));
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
