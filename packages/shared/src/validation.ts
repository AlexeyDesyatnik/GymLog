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

/** RPE is 1 to 10 in steps of 0.5, or null when not given. */
export function checkRpe(rpe: number | null): void {
  if (rpe !== null && !(Number.isInteger(rpe * 2) && rpe >= 1 && rpe <= 10)) {
    throw new RangeError(`RPE must be 1 to 10 in steps of 0.5, not ${rpe}`);
  }
}

/** Exercise names match ignoring case and extra spaces. */
export function exerciseNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}
