import type { LocalDate } from "@gymlog/shared";

const withoutYear = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" });
const withYear = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

/** "чт, 24 сентября", with the year added when it isn't the current one. */
export function formatWorkoutDate(date: LocalDate, today: LocalDate): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const value = new Date(year, month - 1, day);
  return (date.slice(0, 4) === today.slice(0, 4) ? withoutYear : withYear).format(value);
}
