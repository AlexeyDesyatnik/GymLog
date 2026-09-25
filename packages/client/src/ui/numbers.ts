/** Parsing and showing Set numbers the way they are typed on a Russian phone keyboard. */

export type Parsed<T> = { ok: true; value: T } | { ok: false };

/** Weight in kg: empty for a bodyweight Set; a decimal comma or point. */
export function parseWeight(text: string): Parsed<number | null> {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed.replace(",", ".")) };
}

/** Completed repetitions: a whole number from 0. */
export function parseReps(text: string): Parsed<number> {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed) };
}

/** 82.5 → "82,5"; null → "". */
export function showNumber(value: number | null): string {
  return value === null ? "" : String(value).replace(".", ",");
}

/** RPE_BELOW_5 → "<5"; 7.5 → "7,5". Values below 5 left from the older scale show as "<5" too. */
export function showRpe(rpe: number): string {
  return rpe < 5 ? "<5" : showNumber(rpe);
}
