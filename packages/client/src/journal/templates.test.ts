import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import type { Journal } from "./journal.ts";
import { freshJournal } from "./testing.ts";

/** A Workout on this date planned as this Plan notation. */
async function plannedWorkout(journal: Journal, date: string, plan = "squat 100x5x3") {
  const workout = await journal.createWorkout(localDate(date));
  await journal.setPlan(workout.id, plan);
  return workout;
}

test("the Template offered is the last Workout on the new one's weekday, however many weeks back", async () => {
  const journal = freshJournal();
  // Last week trained Tuesday, Thursday and Saturday; this week nothing yet.
  const lastTuesday = await plannedWorkout(journal, "2026-09-22");
  await plannedWorkout(journal, "2026-09-24");
  await plannedWorkout(journal, "2026-09-26");

  // Next week's Tuesday.
  const { offered } = await journal.templatesFor(localDate("2026-10-06"));

  expect(offered).toBe(lastTuesday.id);
});

test("of several Workouts on the new one's weekday, the most recent before its date is offered", async () => {
  const journal = freshJournal();
  await plannedWorkout(journal, "2026-09-08");
  const mostRecent = await plannedWorkout(journal, "2026-09-22");
  await plannedWorkout(journal, "2026-09-15");
  await plannedWorkout(journal, "2026-10-13");

  const { offered } = await journal.templatesFor(localDate("2026-10-06"));

  expect(offered).toBe(mostRecent.id);
});

test("with no earlier Workout on the new one's weekday, none is offered, not the most recent on another", async () => {
  const journal = freshJournal();
  await plannedWorkout(journal, "2026-09-24");
  await plannedWorkout(journal, "2026-09-26");

  const { offered } = await journal.templatesFor(localDate("2026-10-06"));

  expect(offered).toBeNull();
});

test("with no Workout before the new one's date, none is offered", async () => {
  const journal = freshJournal();
  await plannedWorkout(journal, "2026-09-29");
  await plannedWorkout(journal, "2026-09-30");

  const { offered } = await journal.templatesFor(localDate("2026-09-29"));

  expect(offered).toBeNull();
});

test("a Workout with neither a Plan nor Performed Sets has nothing to copy and can't be chosen", async () => {
  const journal = freshJournal();
  // All Tuesdays: the two most recent have nothing to copy, so the improvised one before them is offered.
  const planned = await plannedWorkout(journal, "2026-09-08");
  const improvised = await journal.createWorkout(localDate("2026-09-15"));
  const pullUp = await journal.addEntry(improvised.id, "pull-up");
  await journal.addPerformedSet(pullUp.id, { weight: null, reps: 8 });
  await journal.createWorkout(localDate("2026-09-22"));
  const onlyEntries = await journal.createWorkout(localDate("2026-09-22"));
  await journal.addEntry(onlyEntries.id, "plank");

  const { offered, templates } = await journal.templatesFor(localDate("2026-09-29"));

  expect(offered).toBe(improvised.id);
  expect(templates.map((t) => t.id)).toEqual([improvised.id, planned.id]);
});

test("every Workout with something to copy can be chosen, newest first, whatever its date", async () => {
  const journal = freshJournal();
  const older = await plannedWorkout(journal, "2026-09-15");
  const lastWeek = await plannedWorkout(journal, "2026-09-22");
  const later = await plannedWorkout(journal, "2026-10-01");

  const { templates } = await journal.templatesFor(localDate("2026-09-29"));

  expect(templates.map((t) => [t.id, t.date])).toEqual([
    [later.id, "2026-10-01"],
    [lastWeek.id, "2026-09-22"],
    [older.id, "2026-09-15"],
  ]);
});

test("a Template names the Exercises its copy plans: not its Substitutes or Entries added on the fly", async () => {
  const journal = freshJournal();
  const planned = await plannedWorkout(journal, "2026-09-21", "squat 100x5x3\nbench press 80x5x3");
  const [squat] = (await journal.getWorkout(planned.id))!.entries;
  await journal.substituteEntry(squat!.id, "leg press");
  await journal.addEntry(planned.id, "plank");
  const improvised = await journal.createWorkout(localDate("2026-09-22"));
  const dips = await journal.addEntry(improvised.id, "dips");
  await journal.addPerformedSet(dips.id, { weight: 10, reps: 8 });
  await journal.addEntry(improvised.id, "plank");

  const { templates } = await journal.templatesFor(localDate("2026-09-29"));

  expect(templates.map((t) => t.exerciseNames)).toEqual([["dips"], ["squat", "bench press"]]);
});

test("a Workout created from a Template, on its own date, has the Template's Plan", async () => {
  const journal = freshJournal();
  const template = await journal.createWorkout(localDate("2026-09-22"));
  await journal.setPlan(template.id, "squat 100x5x3@7 90x8\nbicep curl 15x10-12x3\npull-up x8x2");

  const created = await journal.createFromTemplate(template.id, localDate("2026-09-29"));

  const read = (await journal.getWorkout(created.id))!;
  expect([read.date, read.finished]).toEqual(["2026-09-29", false]);
  expect(read.planNotation).toBe("squat 100x5x3@7 90x8\nbicep curl 15x10-12x3\npull-up x8x2");
  expect(read.entries.flatMap((e) => e.performedSets)).toEqual([]);
});

test("from a Template with no Plan, its Performed Sets become Planned Sets, weight and reps only", async () => {
  const journal = freshJournal();
  const template = await journal.createWorkout(localDate("2026-09-22"));
  const pullUp = await journal.addEntry(template.id, "pull-up");
  const first = await journal.addPerformedSet(pullUp.id, { weight: null, reps: 8 });
  await journal.setRpe(first.id, 8);
  await journal.addPerformedSet(pullUp.id, { weight: null, reps: 7 });
  await journal.addEntry(template.id, "plank");
  const bench = await journal.addEntry(template.id, "bench press");
  await journal.addPerformedSet(bench.id, { weight: 80, reps: 5 });
  const last = await journal.addPerformedSet(bench.id, { weight: 80, reps: 5 });
  await journal.setComment(last.id, "тяжело");

  const created = await journal.createFromTemplate(template.id, localDate("2026-09-29"));

  const read = (await journal.getWorkout(created.id))!;
  expect(read.planNotation).toBe("pull-up x8 x7\nbench press 80x5x2");
  expect(read.entries.flatMap((e) => e.plannedSets.map((s) => s.targetRpe))).toEqual([null, null, null, null]);
  expect(read.entries.flatMap((e) => e.performedSets)).toEqual([]);
});

test("only the Plan is copied: no Substitutes, Entries added on the fly, Performed Sets, RPE or Comments", async () => {
  const journal = freshJournal();
  const template = await journal.createWorkout(localDate("2026-09-22"));
  await journal.setPlan(template.id, "bench press 80x5x3\nsquat 100x5x3");
  const [bench, squat] = (await journal.getWorkout(template.id))!.entries;
  const confirmed = await journal.confirmPlannedSet(bench!.id);
  await journal.setRpe(confirmed.id, 8);
  await journal.setComment(confirmed.id, "тяжело");
  const legPress = await journal.substituteEntry(squat!.id, "leg press");
  await journal.addPerformedSet(legPress.id, { weight: 150, reps: 10 });
  const plank = await journal.addEntry(template.id, "plank");
  await journal.addPerformedSet(plank.id, { weight: null, reps: 60 });
  await journal.finishWorkout(template.id);

  const created = await journal.createFromTemplate(template.id, localDate("2026-09-29"));

  const read = (await journal.getWorkout(created.id))!;
  expect(read.entries.map((e) => [e.exercise.primaryName, e.plannedSets.length, e.performedSets.length])).toEqual([
    ["bench press", 3, 0],
    ["squat", 3, 0],
  ]);
  expect(read.entries.map((e) => [e.replacedBy, e.replaces])).toEqual([
    [null, null],
    [null, null],
  ]);
});
