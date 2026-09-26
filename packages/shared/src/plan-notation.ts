import { TARGET_RPE_SCALE } from "./validation.ts";

/**
 * Plan notation (ADR 0003): one line per Entry, the Exercise name followed by weight x reps x sets
 * groups, each optionally with a Target RPE for its first Set after "@".
 */

export interface PlanGroup {
  /** kg; null for a bodyweight Set. */
  weight: number | null;
  reps: number;
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
  /** A Target RPE off TARGET_RPE_SCALE, or an "@" not right after a group. */
  | "bad-target-rpe";

export type PlanLine =
  | { ok: true; exerciseName: string; groups: PlanGroup[] }
  | { ok: false; problem: PlanLineProblem };

/** Latin and Cyrillic x in both cases, the multiplication sign, an asterisk and a slash. */
const SEP = "[xXхХ×*/]";

/** weight x reps x sets @ Target RPE; the weight may be empty or decimal, the sets and the RPE may be left out. */
const GROUP = new RegExp(`^(\\d+(?:[.,]\\d+)?)?${SEP}(\\d+)(?:${SEP}(\\d+))?(?:@(\\d+(?:[.,]\\d+)?))?$`);

/** A digit touching a separator: part of a group, never of an Exercise name. */
const GROUP_FRAGMENT = new RegExp(`\\d${SEP}|${SEP}\\d`);

/**
 * The paper habit "80 x 5 x 3" and "x 8 x 3" becomes "80x5x3" and "x8x3", and so does a
 * stray space before a separator ("100 x5"). A space only after one ("80x 70x8") is a
 * missing number, so it isn't joined and the line reads as a mistyped group. The price:
 * a name ending in a number right before a bodyweight group ("dips 2 x8") reads as a
 * weight, which is far rarer than the typo.
 */
const SEP_BEFORE_DIGIT = new RegExp(`(^|\\s)(${SEP})\\s+(?=\\d)`, "g");
const SPACED_SEP_BETWEEN_DIGITS = new RegExp(`(\\d)\\s+(${SEP})\\s+(?=\\d)`, "g");
const SPACE_BEFORE_SEP = new RegExp(`(\\d)\\s+(${SEP})(?=\\d)`, "g");

/**
 * A Target RPE may be typed as "@7", "@ 7", "rpe7" or "рпе 7" in any case, also after a space;
 * it becomes "@7" joined to the group before it. The words count only where no letter touches
 * them from the front, so they are never cut out of an Exercise name.
 */
const RPE_MARK = /\s*(?:@|(?<!\p{L})(?:rpe|рпе))\s*(?=\d)/giu;

/** Every non-empty line of a Plan, read one by one. */
export function parsePlan(notation: string): PlanLine[] {
  return notation
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map(parsePlanLine);
}

export function parsePlanLine(line: string): PlanLine {
  const joined = line
    .replace(RPE_MARK, "@")
    .replace(SEP_BEFORE_DIGIT, "$1$2")
    .replace(SPACED_SEP_BETWEEN_DIGITS, "$1$2")
    .replace(SPACE_BEFORE_SEP, "$1$2");
  const tokens = joined.trim().split(/\s+/);
  const groups: PlanGroup[] = [];
  // Groups are recognised from the end of the line; whatever is left is the name.
  for (let match = GROUP.exec(tokens.at(-1) ?? ""); match; match = GROUP.exec(tokens.at(-1) ?? "")) {
    tokens.pop();
    groups.unshift({
      weight: match[1] ? Number(match[1].replace(",", ".")) : null,
      reps: Number(match[2]),
      sets: match[3] ? Number(match[3]) : 1,
      targetRpe: match[4] ? Number(match[4].replace(",", ".")) : null,
    });
  }
  if (tokens.some((token) => token.includes("@"))) return { ok: false, problem: "bad-target-rpe" };
  if (groups.length === 0) return { ok: false, problem: "no-groups" };
  if (tokens.length === 0 || tokens.join("") === "") return { ok: false, problem: "no-name" };
  if (tokens.some((token) => GROUP_FRAGMENT.test(token))) return { ok: false, problem: "broken-group" };
  if (groups.some((g) => g.reps < 1 || g.sets < 1)) return { ok: false, problem: "zero-reps-or-sets" };
  if (groups.some((g) => g.targetRpe !== null && !TARGET_RPE_SCALE.includes(g.targetRpe))) {
    return { ok: false, problem: "bad-target-rpe" };
  }
  return { ok: true, exerciseName: tokens.join(" "), groups };
}

type PlannedSetValues = { weight: number | null; reps: number; targetRpe: number | null };

/** One Plan line from an Exercise name and its Planned Sets. */
export function formatPlanLine(exerciseName: string, sets: PlannedSetValues[]): string {
  return `${exerciseName} ${formatPlanSets(sets)}`;
}

/**
 * Planned Sets as groups, e.g. "80x5x3@7 70x8"; a Set joins the group before it when it has
 * the same weight and reps and no Target RPE of its own.
 */
export function formatPlanSets(sets: PlannedSetValues[]): string {
  const groups: PlanGroup[] = [];
  for (const set of sets) {
    const last = groups.at(-1);
    if (last && last.weight === set.weight && last.reps === set.reps && set.targetRpe === null) last.sets++;
    else groups.push({ weight: set.weight, reps: set.reps, sets: 1, targetRpe: set.targetRpe });
  }
  return groups.map(formatGroup).join(" ");
}

function formatGroup({ weight, reps, sets, targetRpe }: PlanGroup): string {
  const shownWeight = weight === null ? "" : String(weight).replace(".", ",");
  const shownRpe = targetRpe === null ? "" : `@${String(targetRpe).replace(".", ",")}`;
  return `${shownWeight}x${reps}${sets > 1 ? `x${sets}` : ""}${shownRpe}`;
}
