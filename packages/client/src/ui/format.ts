import { localDateToDate, type LocalDate } from "@gymlog/shared";

const withoutYear = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" });
const withYear = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

/** "чт, 24 сентября", with the year added when it isn't the current one. */
export function formatWorkoutDate(date: LocalDate, today: LocalDate): string {
  const value = localDateToDate(date);
  const sameYear = value.getFullYear() === localDateToDate(today).getFullYear();
  return (sameYear ? withoutYear : withYear).format(value);
}

const setWords: Record<string, string> = { one: "подход", few: "подхода", many: "подходов", other: "подхода" };
const plural = new Intl.PluralRules("ru-RU");

/** "1 подход", "3 подхода", "5 подходов". */
export function formatSetCount(count: number): string {
  return `${count} ${setWords[plural.select(count)]}`;
}
