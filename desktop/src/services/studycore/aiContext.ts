// Assembles the prompt + a transparent manifest of what's being sent for the
// "Get AI Help" flow. The page does the actual model streaming; this module
// only builds the text and reports exactly which pieces were included so the
// UI can show privacy badges and the cloud-confirmation dialog.

import { buildRagBlock } from "../rag/rag";
import type { RetrievedChunk } from "../rag/rag";
import { isAssessment } from "./assignmentType";
import type { Assignment, AssignmentMaterial, Course } from "./types";

export type HelpMode =
  | "study_guide"
  | "explain"
  | "brainstorm"
  | "outline"
  | "feedback"
  | "check_understanding";

export const HELP_MODE_LABELS: Record<HelpMode, string> = {
  study_guide: "Study Guide",
  explain: "Explain the Concepts",
  brainstorm: "Brainstorm Ideas",
  outline: "Help Me Outline",
  feedback: "Feedback on My Work",
  check_understanding: "Check My Understanding",
};

/** Modes a graded assessment is allowed to use — learning only, never answers. */
export const ASSESSMENT_ALLOWED_MODES: HelpMode[] = ["study_guide", "check_understanding"];

export function allowedModesFor(a: Assignment): HelpMode[] {
  if (isAssessment(a.type)) return ASSESSMENT_ALLOWED_MODES;
  return Object.keys(HELP_MODE_LABELS) as HelpMode[];
}

const MODE_INSTRUCTIONS: Record<HelpMode, string> = {
  study_guide:
    "Create a STUDY GUIDE that helps the student learn the material. Summarize key concepts, provide practice questions WITH explanations, and suggest what to review. Do NOT provide answers the student would submit for a grade.",
  explain:
    "Explain the underlying concepts clearly, with examples and analogies, so the student understands the material themselves.",
  brainstorm:
    "Help the student brainstorm their OWN ideas and approaches. Ask guiding questions and offer angles to consider — do not write the assignment for them.",
  outline:
    "Help the student build an outline or plan in their own words. Provide structure and prompts, not finished prose.",
  feedback:
    "Give constructive feedback on the student's own draft: what works, what's missing, and concrete revision suggestions. Do not rewrite the whole thing.",
  check_understanding:
    "Quiz the student on the material and check their understanding, giving explanations for any gaps.",
};

export interface BuildContextOptions {
  assignment: Assignment;
  course?: Course;
  mode: HelpMode;
  /** Materials the student chose to include (only those with extractedText contribute text). */
  materials: AssignmentMaterial[];
  /** Whether to include the assignment instructions text. */
  includeInstructions: boolean;
  /** Whether to include teacher feedback (only relevant when present). */
  includeFeedback: boolean;
  /** Retrieved Course Knowledge Base excerpts, if the KB toggle was on. */
  ragChunks?: RetrievedChunk[];
  /** The student's own question / what they want help with. */
  userPrompt: string;
}

export interface BuiltContext {
  /** Final prompt to send to the model. */
  prompt: string;
  /** Human-readable list of what's included, for the confirmation dialog + badges. */
  includedItems: string[];
  includedFiles: boolean;
  includedCourseLibraryExcerpts: boolean;
  /** True when the mode was forced to a study-guide-safe mode. */
  assessmentLocked: boolean;
}

export function buildAssignmentContext(opts: BuildContextOptions): BuiltContext {
  const { assignment, course, materials, ragChunks = [] } = opts;
  const assessmentLocked = isAssessment(assignment.type);
  const mode: HelpMode =
    assessmentLocked && !ASSESSMENT_ALLOWED_MODES.includes(opts.mode)
      ? "study_guide"
      : opts.mode;

  const includedItems: string[] = [];
  const parts: string[] = [];

  parts.push(
    "You are StudyCore, a study assistant that helps students learn. " +
      MODE_INSTRUCTIONS[mode],
  );
  if (assessmentLocked) {
    parts.push(
      "IMPORTANT: This is a graded ASSESSMENT (quiz/test/exam). You must operate in Study-Guide Mode only — help the student learn and prepare. Never provide answers they would submit for the assessment.",
    );
  }

  parts.push(
    `Assignment: ${assignment.title}` +
      (course ? `\nCourse: ${course.name}` : "") +
      (assignment.dueDate ? `\nDue: ${new Date(assignment.dueDate).toLocaleString()}` : ""),
  );
  includedItems.push(`Assignment title${course ? " & course" : ""}`);

  if (opts.includeInstructions && assignment.instructions.trim()) {
    parts.push(`Assignment instructions:\n${assignment.instructions.trim()}`);
    includedItems.push("Assignment instructions");
  }

  if (opts.includeFeedback && assignment.feedback?.trim()) {
    parts.push(`Teacher feedback so far:\n${assignment.feedback.trim()}`);
    includedItems.push("Teacher feedback");
  }

  const textMaterials = materials.filter((m) => m.extractedText?.trim());
  let includedFiles = false;
  if (textMaterials.length > 0) {
    includedFiles = true;
    for (const m of textMaterials) {
      parts.push(`=== Material: ${m.fileName} ===\n${m.extractedText!.trim()}`);
    }
    includedItems.push(
      `${textMaterials.length} attached file${textMaterials.length === 1 ? "" : "s"} (${textMaterials
        .map((m) => m.fileName)
        .join(", ")})`,
    );
  }

  let includedCourseLibraryExcerpts = false;
  if (ragChunks.length > 0) {
    const block = buildRagBlock(ragChunks);
    if (block) {
      includedCourseLibraryExcerpts = true;
      parts.push(block.trim());
      includedItems.push(`${ragChunks.length} Course Knowledge Base excerpt(s)`);
    }
  }

  if (opts.userPrompt.trim()) {
    parts.push(`The student asks:\n${opts.userPrompt.trim()}`);
  }

  return {
    prompt: parts.join("\n\n"),
    includedItems,
    includedFiles,
    includedCourseLibraryExcerpts,
    assessmentLocked,
  };
}
