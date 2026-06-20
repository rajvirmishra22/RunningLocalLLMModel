// One-time demo data so a brand-new install isn't an empty shell. Everything
// is realistic, fully local, and tagged `source: "manual"` so it's clear none
// of it came from a real Canvas/Teams account. Re-running is a no-op once the
// onboarding flag is set.

import { detectAssignmentType } from "./assignmentType";
import {
  assignmentStore,
  courseStore,
  materialStore,
  newId,
  nowIso,
  onboardingStore,
} from "./store";
import type { Assignment, AssignmentMaterial, Course } from "./types";

function daysFromNow(days: number, hour = 23, minute = 59): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const COURSE_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899"];

export function seedStudyCore(): void {
  if (onboardingStore.isOnboarded()) return;
  if (courseStore.list().length > 0) return;

  const now = nowIso();

  const courses: Course[] = [
    {
      id: newId("course"),
      name: "Introduction to Psychology",
      source: "manual",
      instructor: "Dr. Alvarez",
      term: "Fall 2026",
      color: COURSE_COLORS[0],
      currentGrade: 88.5,
      letterGrade: "B+",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: newId("course"),
      name: "Calculus II",
      source: "manual",
      instructor: "Prof. Chen",
      term: "Fall 2026",
      color: COURSE_COLORS[1],
      currentGrade: 91.2,
      letterGrade: "A-",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: newId("course"),
      name: "English Composition",
      source: "manual",
      instructor: "Ms. Patel",
      term: "Fall 2026",
      color: COURSE_COLORS[2],
      currentGrade: null,
      letterGrade: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  courses.forEach((c) => courseStore.save(c));
  const [psych, calc, english] = courses;

  function mkAssignment(
    courseId: string,
    title: string,
    instructions: string,
    dueInDays: number,
    overrides: Partial<Assignment> = {},
  ): Assignment {
    const detected = detectAssignmentType(title);
    return {
      id: newId("asg"),
      courseId,
      title,
      instructions,
      dueDate: daysFromNow(dueInDays),
      type: detected,
      typeAutoDetected: true,
      source: "manual",
      status: "not_started",
      pointsPossible: 100,
      pointsEarned: null,
      gradePercent: null,
      feedback: null,
      difficulty: null,
      estimatedMinutes: null,
      externalUrl: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  const assignments: Assignment[] = [
    mkAssignment(
      psych.id,
      "Reading Response: Chapter 4 — Memory",
      "Read Chapter 4 and write a 1-page response connecting two concepts from the chapter to a personal experience.",
      2,
      { type: "reading", typeAutoDetected: true },
    ),
    mkAssignment(
      psych.id,
      "Midterm Exam",
      "In-class midterm covering Chapters 1-5. Closed book.",
      9,
      { type: "exam", typeAutoDetected: true, pointsPossible: 150 },
    ),
    mkAssignment(
      psych.id,
      "Quiz 3: Conditioning",
      "Short quiz on classical and operant conditioning.",
      -3,
      {
        type: "quiz",
        status: "graded",
        pointsPossible: 20,
        pointsEarned: 18,
        gradePercent: 90,
        feedback: "Solid work — review the difference between negative reinforcement and punishment.",
      },
    ),
    mkAssignment(
      calc.id,
      "Problem Set 6: Integration by Parts",
      "Complete problems 1-20 in section 7.1. Show all work.",
      4,
      { type: "problem_set", pointsPossible: 50 },
    ),
    mkAssignment(
      calc.id,
      "Problem Set 5: Trig Substitution",
      "Complete problems 1-15 in section 6.4.",
      -2,
      {
        type: "problem_set",
        status: "graded",
        pointsPossible: 50,
        pointsEarned: 46,
        gradePercent: 92,
        feedback: "Great job. Watch your bounds when substituting.",
      },
    ),
    mkAssignment(
      english.id,
      "Argumentative Essay: Technology & Society",
      "Write a 1200-1500 word argumentative essay taking a clear position on how a specific technology has reshaped society. Use at least 3 sources, MLA format. Include a counterargument and rebuttal.",
      6,
      { type: "essay", pointsPossible: 100, difficulty: 4 },
    ),
    mkAssignment(
      english.id,
      "Group Presentation: Rhetorical Analysis",
      "In groups of 3, present a 10-minute rhetorical analysis of an assigned speech.",
      13,
      { type: "presentation", pointsPossible: 75 },
    ),
  ];
  assignments.forEach((a) => assignmentStore.save(a));

  // A couple of synced-style materials on the essay so the Materials panel and
  // Rubric Checker have something to demonstrate against out of the box.
  const essay = assignments.find((a) => a.title.startsWith("Argumentative Essay"));
  if (essay) {
    const materials: AssignmentMaterial[] = [
      {
        id: newId("mat"),
        assignmentId: essay.id,
        courseId: essay.courseId,
        source: "teams",
        fileName: "Essay Prompt & Rubric.pdf",
        fileType: "application/pdf",
        extractedTextAvailable: true,
        extractedText:
          "Argumentative Essay Rubric\n\n" +
          "Thesis & Position (20 pts): Clear, arguable thesis stated in the introduction.\n" +
          "Evidence & Sources (25 pts): At least three credible sources, integrated and cited in MLA.\n" +
          "Counterargument & Rebuttal (20 pts): Fairly represents an opposing view and responds to it.\n" +
          "Organization (15 pts): Logical paragraph structure with strong transitions.\n" +
          "Style & Mechanics (20 pts): College-level prose, minimal grammatical errors, MLA formatting.",
        indexedInCourseLibrary: false,
        includedInCurrentAIContext: false,
        createdAt: now,
        sizeBytes: 48_000,
      },
    ];
    materials.forEach((m) => materialStore.save(m));
  }

  onboardingStore.markOnboarded();
}
