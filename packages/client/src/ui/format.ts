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

/** "в 1 тренировке", "в 3 тренировках". */
export function formatWorkoutUse(count: number): string {
  return `в ${count} ${plural.select(count) === "one" ? "тренировке" : "тренировках"}`;
}

/** "записано в 3 тренировках", or "не записано" for an Exercise with no history. */
export function formatRecordedIn(count: number): string {
  return count > 0 ? `записано ${formatWorkoutUse(count)}` : "не записано";
}
