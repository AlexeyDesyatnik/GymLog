import { TARGET_RPE_SCALE } from "./validation.ts";

/**
 * Plan notation (ADR 0003): one line per Entry, the Exercise name followed by weight x reps x sets
 * groups, each optionally with a Target RPE for its first Set after "@". The reps may be a Rep
 * range, e.g. 10-12.
 */

export interface PlanGroup {
  /** kg; null for a bodyweight Set. */
  weight: number | null;
  /** The planned reps, or the lowest count of a Rep range. */
  reps: number;
  /** The highest count of a Rep range; null when the reps are one count. */
  maxReps: number | null;
  sets: number;
  /** The RPE the group's first Set aims for; null when not given. */
  targetRpe: number | null;
}

export type PlanLineProblem =
  /** No weight x reps group after the name. */
  | "no-groups"
  /** Groups but no Exercise name before them. */
  | "no-name"
  /** Something in the name looks like a mistyped group, e.g. "80x". */
  | "broken-group"
  /** A Planned Set needs at least 1 rep, and a group at least 1 set. */
  | "zero-reps-or-sets"
  /** A Target RPE off TARGET_RPE_SCALE, or one not right after a group. */
  | "bad-target-rpe"
  /** A Rep range whose highest count isn't above its lowest, e.g. "12-10". */
  | "bad-rep-range";

export type PlanLine =
  | { ok: true; exerciseName: string; groups: PlanGroup[] }
  | { ok: false; problem: PlanLineProblem };

/** Latin and Cyrillic x in both cases, the multiplication sign, an asterisk and a slash. */
const SEP = "[xXхХ×*/]";

/**
 * weight x reps x sets @ Target RPE; the weight may be empty or decimal, the reps may be a Rep
 * range with a hyphen or the dash a phone keyboard puts in its place, and the sets and the RPE
 * may be left out.
 */
const GROUP = new RegExp(
  `^(\\d+(?:[.,]\\d+)?)?${SEP}(\\d+)(?:[-–—](\\d+))?(?:${SEP}(\\d+))?(?:@(\\d+(?:[.,]\\d+)?))?$`,
);

/** A digit touching a separator: part of a group, never of an Exercise name. */
const GROUP_FRAGMENT = new RegExp(`\\d${SEP}|${SEP}\\d`);

/** A separator typed as a token of its own, as in "80 x 5". */
const LONE_SEP = new RegExp(`^${SEP}$`);
/** A token that starts a group with its separator, as in "x5". */
const SEP_THEN_DIGIT = new RegExp(`^${SEP}\\d`);

/**
 * The paper habit "80 x 5 x 3" and "x 8 x 3" becomes "80x5x3" and "x8x3", and so does a
 * stray space before a separator ("100 x5"). A space before a separator is kept when the
 * token typed before it is a whole group, so "x8x2 x6" and "x8 x6" stay two groups. A space
 * only after one ("80x 70x8") is a missing number, so it isn't joined and the line reads as
 * a mistyped group. The price: a name ending in a number right before a bodyweight group
 * ("dips 2 x8") reads as a weight, which is far rarer than the typo.
 */
function joinSpacedGroups(tokens: string[]): string[] {
  const joined: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    // The token as typed, not as joined: in "80 x 5 x 3" the last "x3" follows "5", not "80x5".
    const typedBefore = tokens[i - 1];
    let token = tokens[i]!;
    if (LONE_SEP.test(token) && /^\d/.test(tokens[i + 1] ?? "")) token += tokens[++i];
    const continuesGroup = typedBefore !== undefined && /\d$/.test(typedBefore) && !GROUP.test(typedBefore);
    if (SEP_THEN_DIGIT.test(token) && continuesGroup) joined[joined.length - 1] += token;
    else joined.push(token);
  }
  return joined;
}

/**
 * A Target RPE may be typed as "@7", "@ 7", "rpe7" or "рпе 7" in any case, also after a space;
 * it becomes "@7" joined to the group before it. The words count only where no letter touches
 * them from the front, so they are never cut out of an Exercise name.
 */
const RPE_MARK = /\s*(?:@|(?<!\p{L})(?:rpe|рпе))\s*(?=\d)/giu;

/** An "@" touching a digit or standing alone, or a bare RPE word ending the line: a misplaced Target RPE. */
const STRAY_RPE_MARK = /(^|\d)@|@(\d|$)/;
const BARE_RPE_WORD = /^(?:rpe|рпе)$/iu;

/** Every non-empty line of a Plan, read one by one. */
export function parsePlan(notation: string): PlanLine[] {
  return notation
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map(parsePlanLine);
}

export function parsePlanLine(line: string): PlanLine {
  const tokens = joinSpacedGroups(line.replace(RPE_MARK, "@").trim().split(/\s+/));
  if (BARE_RPE_WORD.test(tokens.at(-1) ?? "")) return { ok: false, problem: "bad-target-rpe" };
  const groups: PlanGroup[] = [];
  // Groups are recognised from the end of the line; whatever is left is the name.
  for (let match = GROUP.exec(tokens.at(-1) ?? ""); match; match = GROUP.exec(tokens.at(-1) ?? "")) {
    tokens.pop();
    groups.unshift({
      weight: match[1] ? Number(match[1].replace(",", ".")) : null,
      reps: Number(match[2]),
      maxReps: match[3] ? Number(match[3]) : null,
      sets: match[4] ? Number(match[4]) : 1,
      targetRpe: match[5] ? Number(match[5].replace(",", ".")) : null,
    });
  }
  if (tokens.some((token) => STRAY_RPE_MARK.test(token))) return { ok: false, problem: "bad-target-rpe" };
  if (groups.length === 0) return { ok: false, problem: "no-groups" };
  if (tokens.length === 0 || tokens.join("") === "") return { ok: false, problem: "no-name" };
  if (tokens.some((token) => GROUP_FRAGMENT.test(token))) return { ok: false, problem: "broken-group" };
  if (groups.some((g) => g.reps < 1 || g.sets < 1)) return { ok: false, problem: "zero-reps-or-sets" };
  if (groups.some((g) => g.maxReps !== null && g.maxReps <= g.reps)) return { ok: false, problem: "bad-rep-range" };
  if (groups.some((g) => g.targetRpe !== null && !TARGET_RPE_SCALE.includes(g.targetRpe))) {
    return { ok: false, problem: "bad-target-rpe" };
  }
  return { ok: true, exerciseName: tokens.join(" "), groups };
}

type PlannedSetValues = { weight: number | null; reps: number; maxReps: number | null; targetRpe: number | null };

/** One Plan line from an Exercise name and its Planned Sets. */
export function formatPlanLine(exerciseName: string, sets: PlannedSetValues[]): string {
  return `${exerciseName} ${formatPlanSets(sets)}`;
}

/**
 * Planned Sets as groups, e.g. "80x5x3@7 70x8"; a Set joins the group before it when it has
 * the same weight and reps (or Rep range) and no Target RPE of its own.
 */
export function formatPlanSets(sets: PlannedSetValues[]): string {
  const groups: PlanGroup[] = [];
  for (const set of sets) {
    const last = groups.at(-1);
    const same = last && last.weight === set.weight && last.reps === set.reps && last.maxReps === set.maxReps;
    if (same && set.targetRpe === null) last.sets++;
    else groups.push({ weight: set.weight, reps: set.reps, maxReps: set.maxReps, sets: 1, targetRpe: set.targetRpe });
  }
  return groups.map(formatGroup).join(" ");
}

function formatGroup({ weight, reps, maxReps, sets, targetRpe }: PlanGroup): string {
  const shownWeight = weight === null ? "" : withComma(weight);
  const shownRpe = targetRpe === null ? "" : `@${withComma(targetRpe)}`;
  return `${shownWeight}x${formatReps(reps, maxReps)}${sets > 1 ? `x${sets}` : ""}${shownRpe}`;
}

/** Planned reps as written: "5", or a Rep range "10-12". */
export function formatReps(reps: number, maxReps: number | null): string {
  return maxReps === null ? String(reps) : `${reps}-${maxReps}`;
}

/** 82.5 → "82,5": numbers in Plan notation use a decimal comma. */
function withComma(value: number): string {
  return String(value).replace(".", ",");
}
