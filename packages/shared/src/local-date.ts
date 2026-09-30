/** A calendar date in the user's own time zone, written as YYYY-MM-DD. */
export type LocalDate = string & { readonly __brand: "LocalDate" };

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Throws a RangeError unless the value is a real calendar date in YYYY-MM-DD form. */
export function localDate(value: string): LocalDate {
  const match = PATTERN.exec(value);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return value as LocalDate;
    }
  }
  throw new RangeError(`Not a calendar date: "${value}"`);
}

export function localDateOf(date: Date): LocalDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return localDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
}

/** The same day of the month that many months earlier, or that month's last day when it is shorter. */
export function monthsBefore(date: LocalDate, months: number): LocalDate {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(year, month - 1 - months + 1, 0).getDate();
  return localDateOf(new Date(year, month - 1 - months, Math.min(day, lastDay)));
}

/** The date that many days earlier. */
export function daysBefore(date: LocalDate, days: number): LocalDate {
  const value = localDateToDate(date);
  value.setDate(value.getDate() - days);
  return localDateOf(value);
}

/** Midnight of that date in the user's own time zone. */
export function localDateToDate(date: LocalDate): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}
