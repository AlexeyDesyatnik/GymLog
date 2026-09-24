import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { freshJournal } from "./testing.ts";

async function journalWithWorkout() {
  const journal = freshJournal();
  const workout = await journal.createWorkout(localDate("2026-09-24"));
  return { journal, workout };
}

/** The Plan as read back from the Workout: Exercise name and [weight, reps] per Planned Set. */
async function planOf(journal: Awaited<ReturnType<typeof journalWithWorkout>>["journal"], workoutId: string) {
  const workout = await journal.getWorkout(workoutId);
  return workout!.entries.map((e) => [e.exercise.primaryName, e.plannedSets.map((s) => [s.weight, s.reps])]);
}

test("a Plan line becomes an Entry with one Planned Set per set", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "bench press 80x5x3");

  expect(await planOf(journal, workout.id)).toEqual([
    [
      "bench press",
      [
        [80, 5],
        [80, 5],
        [80, 5],
      ],
    ],
  ]);
});

test("several groups in a line add their Planned Sets in order, and each line is an Entry", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "bench press 80x5x2 70x8\n\nsquat 100x5x1\n");

  expect(await planOf(journal, workout.id)).toEqual([
    [
      "bench press",
      [
        [80, 5],
        [80, 5],
        [70, 8],
      ],
    ],
    ["squat", [[100, 5]]],
  ]);
});

test("a group with no weight plans a bodyweight Set", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "pull-up x8x2");

  expect(await planOf(journal, workout.id)).toEqual([
    [
      "pull-up",
      [
        [null, 8],
        [null, 8],
      ],
    ],
  ]);
});

test("a weight may have a decimal comma or point, and a group without sets is one Set", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "dumbbell press 22,5x10\ncable row 17.5x12");

  expect(await planOf(journal, workout.id)).toEqual([
    ["dumbbell press", [[22.5, 10]]],
    ["cable row", [[17.5, 12]]],
  ]);
});

test.each(["bench press 80/5/3", "bench press 80х5х3", "bench press 80×5×3", "bench press 80*5*3", "bench press 80X5X3", "bench press 80 x 5 x 3"])(
  "%s is understood like 80x5x3",
  async (line) => {
    const { journal, workout } = await journalWithWorkout();

    await journal.setPlan(workout.id, line);

    expect(await planOf(journal, workout.id)).toEqual([
      [
        "bench press",
        [
          [80, 5],
          [80, 5],
          [80, 5],
        ],
      ],
    ]);
  },
);

test("the paper form with spaces works for a bodyweight group too", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "pull-up x 8 x 2");

  expect(await planOf(journal, workout.id)).toEqual([
    [
      "pull-up",
      [
        [null, 8],
        [null, 8],
      ],
    ],
  ]);
});

test("digits inside the Exercise name stay part of the name", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "bench press 3 sec pause 80x5\nжим с паузой 3 сек 75х4");

  expect(await planOf(journal, workout.id)).toEqual([
    ["bench press 3 sec pause", [[80, 5]]],
    ["жим с паузой 3 сек", [[75, 4]]],
  ]);
});

test("lines that aren't understood create nothing, and each line reports how it was understood", async () => {
  const { journal, workout } = await journalWithWorkout();

  const lines = await journal.setPlan(
    workout.id,
    "squat 100x5\nbench press 80\n80x5x3\ncurl 20x0x3\ncurl 20x5x0\ndeadlift 180x1",
  );

  expect(lines.map((l) => (l.ok ? "ok" : l.problem))).toEqual([
    "ok",
    "no-groups",
    "no-name",
    "zero-reps-or-sets",
    "zero-reps-or-sets",
    "ok",
  ]);
  expect(await planOf(journal, workout.id)).toEqual([
    ["squat", [[100, 5]]],
    ["deadlift", [[180, 1]]],
  ]);
});

test("the Plan reads back as text with x and a decimal comma", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "bench press 80x5x2 70x8\npull-up x8x3\ndumbbell press 22.5x10");

  expect(await journal.getPlanText(workout.id)).toBe("bench press 80x5x2 70x8\npull-up x8x3\ndumbbell press 22,5x10");
});

test("reading back tidies the text: repeated groups merge, separators become x, names become Primary names", async () => {
  const journal = freshJournal();
  const earlier = await journal.createWorkout(localDate("2026-09-21"));
  await journal.addEntry(earlier.id, "Bench Press");
  const workout = await journal.createWorkout(localDate("2026-09-24"));

  await journal.setPlan(workout.id, "squat 100x5 100x5 100x3\nbench   PRESS 80 / 5 / 3");

  expect(await journal.getPlanText(workout.id)).toBe("squat 100x5x2 100x3\nBench Press 80x5x3");
});

test("a Workout with no Plan reads back as empty text", async () => {
  const { journal, workout } = await journalWithWorkout();

  expect(await journal.getPlanText(workout.id)).toBe("");
});

test("setting the Plan again replaces it, and Entries added outside the Plan stay after it", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "squat 100x5x3\nbench press 80x5x3");
  await journal.addEntry(workout.id, "plank");

  await journal.setPlan(workout.id, "deadlift 180x1\nsquat 90x8");

  expect(await planOf(journal, workout.id)).toEqual([
    ["deadlift", [[180, 1]]],
    ["squat", [[90, 8]]],
    ["plank", []],
  ]);
});

test("the Plan can't be set once the Workout has Performed Sets", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "squat 100x5x3");
  const entry = (await journal.getWorkout(workout.id))!.entries[0]!;
  await journal.addPerformedSet(entry.id, { weight: 100, reps: 5 });

  await expect(journal.setPlan(workout.id, "squat 110x5x3")).rejects.toThrow();
  expect(await journal.getPlanText(workout.id)).toBe("squat 100x5x3");
});
