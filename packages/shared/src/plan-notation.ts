/** Plan notation (ADR 0003): one line per Entry, the Exercise name followed by weight x reps x sets groups. */

export interface PlanGroup {
  /** kg; null for a bodyweight Set. */
  weight: number | null;
  reps: number;
  sets: number;
}

export type PlanLineProblem =
  /** No weight x reps group after the name. */
  | "no-groups"
  /** Groups but no Exercise name before them. */
  | "no-name"
  /** Something in the name looks like a mistyped group, e.g. "80x". */
  | "broken-group"
  /** A Planned Set needs at least 1 rep, and a group at least 1 set. */
  | "zero-reps-or-sets";

export type PlanLine =
  | { ok: true; exerciseName: string; groups: PlanGroup[] }
  | { ok: false; problem: PlanLineProblem };

/** Latin and Cyrillic x in both cases, the multiplication sign, an asterisk and a slash. */
const SEP = "[xXхХ×*/]";

/** weight x reps x sets; the weight may be empty or decimal, the sets may be left out. */
const GROUP = new RegExp(`^(\\d+(?:[.,]\\d+)?)?${SEP}(\\d+)(?:${SEP}(\\d+))?$`);

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

/** Every non-empty line of a Plan, read one by one. */
export function parsePlan(notation: string): PlanLine[] {
  return notation
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map(parsePlanLine);
}

export function parsePlanLine(line: string): PlanLine {
  const joined = line
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
    });
  }
  if (groups.length === 0) return { ok: false, problem: "no-groups" };
  if (tokens.length === 0 || tokens.join("") === "") return { ok: false, problem: "no-name" };
  if (tokens.some((token) => GROUP_FRAGMENT.test(token))) return { ok: false, problem: "broken-group" };
  if (groups.some((g) => g.reps < 1 || g.sets < 1)) return { ok: false, problem: "zero-reps-or-sets" };
  return { ok: true, exerciseName: tokens.join(" "), groups };
}

/** One Plan line from an Exercise name and its Planned Sets. */
export function formatPlanLine(exerciseName: string, sets: { weight: number | null; reps: number }[]): string {
  return `${exerciseName} ${formatPlanSets(sets)}`;
}

/** Planned Sets as groups, e.g. "80x5x3 70x8"; consecutive equal Sets merge into one group. */
export function formatPlanSets(sets: { weight: number | null; reps: number }[]): string {
  const groups: PlanGroup[] = [];
  for (const set of sets) {
    const last = groups.at(-1);
    if (last && last.weight === set.weight && last.reps === set.reps) last.sets++;
    else groups.push({ weight: set.weight, reps: set.reps, sets: 1 });
  }
  return groups.map(formatGroup).join(" ");
}

function formatGroup({ weight, reps, sets }: PlanGroup): string {
  const shownWeight = weight === null ? "" : String(weight).replace(".", ",");
  return `${shownWeight}x${reps}${sets > 1 ? `x${sets}` : ""}`;
}
