// Deterministic study-plan generator. Produces editable StudyBlocks from
// assignments + due dates + the student's availability. No AI required — the
// scheduler is a transparent, explainable heuristic. (The Planner page may
// optionally re-narrate a plan with a model, but the schedule itself is local.)

import { newId, nowIso } from "./store";
import type { Assignment, PlannerPreferences, StudyBlock, StudyPlan } from "./types";

/** Rough minutes of work a type implies, before difficulty scaling. */
const BASE_MINUTES: Record<Assignment["type"], number> = {
  essay: 240,
  project: 300,
  problem_set: 120,
  lab: 150,
  reading: 90,
  presentation: 180,
  discussion: 45,
  quiz: 90,
  test: 180,
  exam: 300,
  other: 90,
};

function estimateMinutes(a: Assignment): number {
  if (a.estimatedMinutes && a.estimatedMinutes > 0) return a.estimatedMinutes;
  const base = BASE_MINUTES[a.type] ?? 90;
  const difficultyFactor = a.difficulty ? 0.6 + a.difficulty * 0.2 : 1; // 1→0.8 … 5→1.6
  return Math.round(base * difficultyFactor);
}

function dailyCapacity(date: Date, prefs: PlannerPreferences): number {
  const day = date.getDay();
  if (prefs.avoidDays.includes(day)) return 0;
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? prefs.weekendMinutes : prefs.weekdayMinutes;
}

function atHour(date: Date, hour: number): string {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

interface GenerateOptions {
  /** Horizon in days to schedule across. */
  horizonDays?: number;
  /** Preserve these locked blocks from a prior plan. */
  lockedBlocks?: StudyBlock[];
}

/**
 * Greedy scheduler: walk assignments by urgency, slicing each into
 * session-sized blocks, filling each day up to the student's capacity, never
 * scheduling work past its due date when avoidable.
 */
export function generateStudyPlan(
  assignments: Assignment[],
  prefs: PlannerPreferences,
  opts: GenerateOptions = {},
): StudyPlan {
  const horizon = opts.horizonDays ?? 21;
  const lockedBlocks = opts.lockedBlocks ?? [];

  const pending = assignments
    .filter((a) => a.status !== "submitted" && a.status !== "graded")
    .filter((a) => a.dueDate)
    .sort((a, b) => {
      if (prefs.prioritizeUrgent) {
        return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      }
      return estimateMinutes(b) - estimateMinutes(a);
    });

  // Pre-fill capacity used by locked blocks, keyed by yyyy-mm-dd.
  const usedByDay = new Map<string, number>();
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  for (const b of lockedBlocks) {
    const k = b.scheduledStart.slice(0, 10);
    usedByDay.set(k, (usedByDay.get(k) ?? 0) + b.durationMinutes);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const blocks: StudyBlock[] = [...lockedBlocks];

  for (const a of pending) {
    let remaining = estimateMinutes(a);
    const due = a.dueDate ? new Date(a.dueDate) : null;
    const session = prefs.sessionMinutes;
    // How many distinct days are we willing to spread this across?
    const wantSpread = prefs.spreadProjects && (a.type === "project" || a.type === "essay" || remaining > session * 2);

    for (let dayOffset = 0; dayOffset < horizon && remaining > 0; dayOffset++) {
      const date = new Date(today);
      date.setDate(today.getDate() + dayOffset);
      if (due && date > due) break; // don't schedule past the due date
      const cap = dailyCapacity(date, prefs);
      if (cap === 0) continue;
      const k = dayKey(date);
      const used = usedByDay.get(k) ?? 0;
      let free = cap - used;
      if (free <= 0) continue;

      // When spreading, cap one day's contribution to a single session so the
      // work is distributed instead of dumped on the first open day.
      const perDayCap = wantSpread ? Math.min(free, session) : free;

      let placedToday = 0;
      let startHour = 16 + Math.floor(used / 60); // start mid-afternoon, push later as the day fills
      while (remaining > 0 && placedToday < perDayCap) {
        const dur = Math.min(session, remaining, perDayCap - placedToday);
        if (dur < 15) break; // don't create tiny slivers
        blocks.push({
          id: newId("block"),
          assignmentId: a.id,
          courseId: a.courseId,
          title: a.title,
          scheduledStart: atHour(date, Math.min(startHour, 21)),
          durationMinutes: dur,
          completed: false,
          locked: false,
          generatedReason: due
            ? `Due ${due.toLocaleDateString()} — scheduled ${dayOffset === 0 ? "today" : `${dayOffset}d ahead`}.`
            : "Scheduled from your assignment list.",
        });
        remaining -= dur;
        placedToday += dur;
        startHour += 1;
      }
      usedByDay.set(k, used + placedToday);
      if (wantSpread && placedToday > 0) {
        // move to next day for the next chunk
        continue;
      }
    }
  }

  blocks.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));

  return {
    id: newId("plan"),
    createdAt: nowIso(),
    processingType: "deterministic",
    blocks,
  };
}
