// Assignment type detection + the critical "assessment" rule. Quizzes, tests
// and exams are graded assessments, so AI Help for them is locked to
// Study-Guide Mode — the app helps a student LEARN the material, it never
// produces answers to a graded assessment.

import type { AssignmentType } from "./types";

export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  essay: "Essay",
  problem_set: "Problem Set",
  project: "Project",
  lab: "Lab",
  reading: "Reading",
  discussion: "Discussion",
  presentation: "Presentation",
  quiz: "Quiz",
  test: "Test",
  exam: "Exam",
  other: "Other",
};

export const ASSIGNMENT_TYPE_OPTIONS: { value: AssignmentType; label: string }[] = (
  Object.keys(ASSIGNMENT_TYPE_LABELS) as AssignmentType[]
).map((value) => ({ value, label: ASSIGNMENT_TYPE_LABELS[value] }));

/** Graded assessments — AI Help is restricted to Study-Guide Mode for these. */
const ASSESSMENT_TYPES: ReadonlySet<AssignmentType> = new Set(["quiz", "test", "exam"]);

export function isAssessment(type: AssignmentType): boolean {
  return ASSESSMENT_TYPES.has(type);
}

// Ordered most-specific first so e.g. "lab report" → lab, "final exam" → exam.
const KEYWORD_RULES: { type: AssignmentType; patterns: RegExp[] }[] = [
  { type: "exam", patterns: [/\bexam\b/, /\bmidterm\b/, /\bfinal\b/] },
  { type: "test", patterns: [/\btest\b/, /\bassessment\b/] },
  { type: "quiz", patterns: [/\bquiz\b/] },
  { type: "lab", patterns: [/\blab\b/, /\blaboratory\b/] },
  { type: "essay", patterns: [/\bessay\b/, /\bpaper\b/, /\bwriting\b/, /\bcomposition\b/] },
  { type: "problem_set", patterns: [/\bproblem set\b/, /\bpset\b/, /\bproblems?\b/, /\bhomework\b/, /\bworksheet\b/, /\bexercises?\b/] },
  { type: "presentation", patterns: [/\bpresentation\b/, /\bslides?\b/, /\bspeech\b/] },
  { type: "discussion", patterns: [/\bdiscussion\b/, /\bforum\b/, /\bresponse\b/, /\breflection\b/] },
  { type: "reading", patterns: [/\breading\b/, /\bread chapter\b/, /\bchapter\b/] },
  { type: "project", patterns: [/\bproject\b/, /\bportfolio\b/, /\bbuild\b/] },
];

/** Best-effort classification of an assignment from its title. */
export function detectAssignmentType(title: string): AssignmentType {
  const t = title.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(t))) return rule.type;
  }
  return "other";
}
