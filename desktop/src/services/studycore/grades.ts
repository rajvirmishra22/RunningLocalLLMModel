// Deterministic What-If grade calculator. NO AI is involved — grade math is
// exact and runs entirely locally, so no grade data is ever sent anywhere.
// All projections are explicitly UNOFFICIAL.

import type {
  Assignment,
  GradeCategory,
  GradeMode,
  GradeSimulationScenario,
  HypotheticalScore,
} from "./types";
import { newId } from "./store";

export function pct(earned: number, possible: number): number | null {
  return possible > 0 ? (earned / possible) * 100 : null;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A score's effective percentage, preferring explicit `percentage`. */
function scorePercent(s: HypotheticalScore): number | null {
  if (s.percentage != null) return s.percentage;
  if (s.pointsEarned != null && s.pointsPossible != null && s.pointsPossible > 0) {
    return (s.pointsEarned / s.pointsPossible) * 100;
  }
  return null;
}

/** Points-based projection: total earned / total possible across all scored items. */
export function projectPointsBased(scores: HypotheticalScore[]): number | null {
  let earned = 0;
  let possible = 0;
  for (const s of scores) {
    if (s.pointsEarned != null && s.pointsPossible != null) {
      earned += s.pointsEarned;
      possible += s.pointsPossible;
    } else if (s.percentage != null && s.pointsPossible != null) {
      earned += (s.percentage / 100) * s.pointsPossible;
      possible += s.pointsPossible;
    }
  }
  return pct(earned, possible);
}

/** Weighted projection: each category contributes (avg % of its scores) × weight. */
export function projectWeighted(
  categories: GradeCategory[],
  scores: HypotheticalScore[],
): number | null {
  let weightedSum = 0;
  let usedWeight = 0;
  for (const cat of categories) {
    const catScores = scores
      .filter((s) => s.categoryId === cat.id)
      .map(scorePercent)
      .filter((p): p is number => p != null);
    if (catScores.length === 0) continue;
    const avg = catScores.reduce((a, b) => a + b, 0) / catScores.length;
    weightedSum += avg * (cat.weight / 100);
    usedWeight += cat.weight / 100;
  }
  if (usedWeight === 0) return null;
  // Re-normalize so missing categories don't deflate the projection.
  return weightedSum / usedWeight;
}

export function projectScenario(scenario: GradeSimulationScenario): number | null {
  if (scenario.mode === "weighted" || scenario.mode === "manual") {
    return projectWeighted(scenario.categories ?? [], scenario.hypotheticalScores);
  }
  return projectPointsBased(scenario.hypotheticalScores);
}

/**
 * Score needed on ONE upcoming item to reach a target overall percentage,
 * holding every other score fixed. Returns the needed percentage (may be >100,
 * meaning the target is unreachable with this single item, or <0 meaning it's
 * already guaranteed). `null` when the math is undefined.
 */
export function neededForTarget(opts: {
  mode: GradeMode;
  targetPercent: number;
  lockedScores: HypotheticalScore[];
  categories?: GradeCategory[];
  /** The upcoming item's points possible (points modes) or its category (weighted). */
  targetPointsPossible?: number | null;
  targetCategoryId?: string;
}): number | null {
  const { mode, targetPercent, lockedScores } = opts;

  if (mode === "points_estimate") {
    let earned = 0;
    let possible = 0;
    for (const s of lockedScores) {
      if (s.pointsEarned != null && s.pointsPossible != null) {
        earned += s.pointsEarned;
        possible += s.pointsPossible;
      }
    }
    const tp = opts.targetPointsPossible ?? 0;
    if (tp <= 0) return null;
    const neededPoints = (targetPercent / 100) * (possible + tp) - earned;
    return (neededPoints / tp) * 100;
  }

  // weighted / manual
  const categories = opts.categories ?? [];
  const targetCat = categories.find((c) => c.id === opts.targetCategoryId);
  if (!targetCat) return null;

  let fixedWeighted = 0;
  let totalWeight = 0;
  for (const cat of categories) {
    totalWeight += cat.weight / 100;
    const catScores = lockedScores
      .filter((s) => s.categoryId === cat.id)
      .map(scorePercent)
      .filter((p): p is number => p != null);
    if (cat.id === targetCat.id) {
      // Average of existing locked scores in this category + the unknown x.
      // (x + sum)/(n+1) is the category average. Solve below.
      const sum = catScores.reduce((a, b) => a + b, 0);
      const n = catScores.length;
      // contribution = ((x + sum)/(n+1)) * weight
      // target = (fixedWeighted + contribution) / totalWeight  → solve for x
      // Defer: handle after loop using captured sum/n.
      (targetCat as GradeCategory & { _sum?: number; _n?: number })._sum = sum;
      (targetCat as GradeCategory & { _sum?: number; _n?: number })._n = n;
      continue;
    }
    if (catScores.length > 0) {
      const avg = catScores.reduce((a, b) => a + b, 0) / catScores.length;
      fixedWeighted += avg * (cat.weight / 100);
    }
  }
  const meta = targetCat as GradeCategory & { _sum?: number; _n?: number };
  const sum = meta._sum ?? 0;
  const n = meta._n ?? 0;
  const w = targetCat.weight / 100;
  // target * totalWeight = fixedWeighted + ((x + sum)/(n+1)) * w
  const rhs = (targetPercent / 100) * totalWeight - fixedWeighted;
  const x = (rhs / w) * (n + 1) - sum;
  return x;
}

/** Build a fresh scenario seeded from a course's real graded + ungraded assignments. */
export function scenarioFromAssignments(
  courseId: string,
  name: string,
  assignments: Assignment[],
  mode: GradeMode = "points_estimate",
): GradeSimulationScenario {
  const now = new Date().toISOString();
  const scores: HypotheticalScore[] = assignments
    .filter((a) => a.pointsPossible != null)
    .map((a) => ({
      id: newId("score"),
      assignmentId: a.id,
      name: a.title,
      pointsEarned: a.pointsEarned ?? null,
      pointsPossible: a.pointsPossible ?? null,
      percentage: a.gradePercent ?? null,
      isHypothetical: a.pointsEarned == null,
    }));
  return {
    id: newId("scenario"),
    courseId,
    name,
    mode,
    categories: [],
    hypotheticalScores: scores,
    createdAt: now,
    updatedAt: now,
  };
}

export const GRADE_MODE_DISCLAIMERS: Record<GradeMode, string> = {
  weighted: "Calculated using synced assignment category weights.",
  points_estimate:
    "Estimated using visible assignment points. Your class may use weighting, dropped scores, extra credit, or other grading policies not included here.",
  manual: "Based on values you entered manually.",
};

export const UNOFFICIAL_DISCLAIMER =
  "Unofficial Projection — Your actual course grade is determined by your teacher and your school platform.";
