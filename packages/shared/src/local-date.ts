/** A calendar date in the user's own time zone, written as YYYY-MM-DD. */
export type LocalDate = string & { readonly __brand: "LocalDate" };

export function localDate(value: string): LocalDate {
  return value as LocalDate;
}

export function localDateOf(date: Date): LocalDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return localDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
}
