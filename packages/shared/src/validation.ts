/** Rules for record values, shared so the client and the server check them the same way. */

/** Weight is optional and never negative; reps are completed repetitions, a whole number from 0. */
export function checkSetValues({ weight, reps }: { weight: number | null; reps: number }): void {
  if (weight !== null && !(Number.isFinite(weight) && weight >= 0)) {
    throw new RangeError(`Weight must be a number of kg from 0, not ${weight}`);
  }
  if (!(Number.isInteger(reps) && reps >= 0)) {
    throw new RangeError(`Reps must be a whole number from 0, not ${reps}`);
  }
}

/** RPE "below 5" is stored as 4, which never means exactly 4. */
export const RPE_BELOW_5 = 4;

/** Every RPE value, in order: below 5, whole numbers to 7, then half steps to 10. */
export const RPE_SCALE: readonly number[] = [RPE_BELOW_5, 5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** RPE is a value on the scale, or null when not given. */
export function checkRpe(rpe: number | null): void {
  if (rpe !== null && !RPE_SCALE.includes(rpe)) {
    throw new RangeError(`RPE must be one of below 5, 5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10, not ${rpe}`);
  }
}

/** Exercise names match ignoring case and extra spaces. */
export function exerciseNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}
