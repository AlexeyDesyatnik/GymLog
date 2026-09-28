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

/** Every Planned Set of the Workout's Entries: weight, reps, highest reps and Target RPE. */
async function plannedSetsOf(journal: Awaited<ReturnType<typeof journalWithWorkout>>["journal"], workoutId: string) {
  const workout = await journal.getWorkout(workoutId);
  return workout!.entries.flatMap((e) => e.plannedSets.map((s) => [s.weight, s.reps, s.maxReps, s.targetRpe]));
}

test("a Plan line becomes an Entry with as many Planned Sets as the group says", async () => {
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

test.each([
  ["pull-up x8x2 x6", "pull-up", [[null, 8], [null, 8], [null, 6]]],
  ["pull-up x8 x8 x8", "pull-up", [[null, 8], [null, 8], [null, 8]]],
  ["dips 20x8 x6", "dips", [[20, 8], [null, 6]]],
])("a bodyweight group after another group stays its own group: %j", async (line, name, sets) => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, line);

  expect(await planOf(journal, workout.id)).toEqual([[name, sets]]);
});

test.each(["pull-up x8x2 x6", "pull-up x8@8 x8 x6x2", "pull-up x8-10x2 x6", "dips 20x8 x6x2", "dips x8 20x6 x5"])(
  "the Plan notation read back from %j sets the same Planned Sets again",
  async (line) => {
    const { journal, workout } = await journalWithWorkout();
    await journal.setPlan(workout.id, line);
    const first = (await journal.getWorkout(workout.id))!;
    const firstSets = await plannedSetsOf(journal, workout.id);

    await journal.setPlan(workout.id, first.planNotation);

    expect(firstSets).not.toEqual([]);
    expect(await plannedSetsOf(journal, workout.id)).toEqual(firstSets);
    expect((await journal.getWorkout(workout.id))!.planNotation).toBe(first.planNotation);
  },
);

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

test("the Plan reads back in Plan notation with x and a decimal comma", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "bench press 80x5x2 70x8\npull-up x8x3\ndumbbell press 22.5x10");

  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("bench press 80x5x2 70x8\npull-up x8x3\ndumbbell press 22,5x10");
});

test("reading back tidies the notation: repeated groups merge, separators become x, names become Primary names", async () => {
  const journal = freshJournal();
  const earlier = await journal.createWorkout(localDate("2026-09-21"));
  await journal.addEntry(earlier.id, "Bench Press");
  const workout = await journal.createWorkout(localDate("2026-09-24"));

  await journal.setPlan(workout.id, "squat 100x5 100x5 100x3\nbench   PRESS 80 / 5 / 3");

  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("squat 100x5x2 100x3\nBench Press 80x5x3");
});

test("a Workout with no Plan reads back as empty Plan notation", async () => {
  const { journal, workout } = await journalWithWorkout();

  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("");
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

test("a bodyweight group may leave out the sets and may use a slash", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "dips x8\npull-up /8/2");

  expect(await planOf(journal, workout.id)).toEqual([
    ["dips", [[null, 8]]],
    [
      "pull-up",
      [
        [null, 8],
        [null, 8],
      ],
    ],
  ]);
});

test("a mistyped group isn't taken as part of the Exercise name", async () => {
  const { journal, workout } = await journalWithWorkout();

  const lines = await journal.setPlan(workout.id, "bench press 80x 70x8\nrow 60x8x3x2 70x8");

  expect(lines.map((l) => (l.ok ? "ok" : l.problem))).toEqual(["broken-group", "broken-group"]);
  expect(await planOf(journal, workout.id)).toEqual([]);
});

test("a stray space before a separator still joins the group", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "squat 100 x5 90 x 5");

  expect(await planOf(journal, workout.id)).toEqual([
    [
      "squat",
      [
        [100, 5],
        [90, 5],
      ],
    ],
  ]);
});

test("a Target RPE belongs to the first Planned Set of its group, and reads back after @", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "squat 100x5x3@7");

  const read = (await journal.getWorkout(workout.id))!;
  expect(read.entries[0]!.plannedSets.map((s) => s.targetRpe)).toEqual([7, null, null]);
  expect(read.planNotation).toBe("squat 100x5x3@7");
});

test.each([
  ["squat 100x5x3@7", "squat 100x5x3@7"],
  ["squat 100x5x3@ 7", "squat 100x5x3@7"],
  ["squat 100x5x3 @7", "squat 100x5x3@7"],
  ["squat 100x5x3 @ 7", "squat 100x5x3@7"],
  ["squat 100x5x3rpe7", "squat 100x5x3@7"],
  ["squat 100x5x3 RPE 7", "squat 100x5x3@7"],
  ["squat 100x5x3 рпе 7", "squat 100x5x3@7"],
  ["squat 100x5x3 РПЕ7,5", "squat 100x5x3@7,5"],
  ["bench press 80x5@8 70x8x2 rpe 7.5", "bench press 80x5@8 70x8x2@7,5"],
  ["pull-up x8x3@8", "pull-up x8x3@8"],
])("a Target RPE typed as %j reads back as %j", async (typed, readBack) => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, typed);

  expect((await journal.getWorkout(workout.id))!.planNotation).toBe(readBack);
});

test.each([
  "squat 100x5x3@6.5",
  "squat 100x5x3@4",
  "squat 100x5x3@11",
  "squat 100x5x3@",
  "squat 100x5x3@7@8",
  "squat @7 100x5x3",
  "squat 100x5x3 rpe",
])(
  "%j has a Target RPE off the list or out of place and isn't understood",
  async (line) => {
    const { journal, workout } = await journalWithWorkout();

    const [reading] = await journal.setPlan(workout.id, line);

    expect(reading).toEqual({ ok: false, problem: "bad-target-rpe" });
    expect(await planOf(journal, workout.id)).toEqual([]);
  },
);

test.each([
  ["squat 100x5@7 100x5x2", "squat 100x5x3@7"],
  ["squat 100x5@7 100x5@7", "squat 100x5@7 100x5@7"],
  ["squat 100x5x2 100x5@8", "squat 100x5x2 100x5@8"],
])("reading back %j merges a Set into the group before it only without its own Target RPE: %j", async (typed, readBack) => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, typed);

  expect((await journal.getWorkout(workout.id))!.planNotation).toBe(readBack);
});

test("a Planned Set's Target RPE can't be changed as if it were a Performed Set's RPE", async () => {
  const { journal, workout } = await journalWithWorkout();
  await journal.setPlan(workout.id, "squat 100x5x3@7");
  const [planned] = (await journal.getWorkout(workout.id))!.entries[0]!.plannedSets;

  await expect(journal.setRpe(planned!.id, 4)).rejects.toThrow();
  expect((await journal.getWorkout(workout.id))!.planNotation).toBe("squat 100x5x3@7");
});

test("an @ inside an Exercise name, away from digits, stays part of the name", async () => {
  const { journal, workout } = await journalWithWorkout();

  await journal.setPlan(workout.id, "жим@лёжа 80x5");

  expect(await planOf(journal, workout.id)).toEqual([["жим@лёжа", [[80, 5]]]]);
});
