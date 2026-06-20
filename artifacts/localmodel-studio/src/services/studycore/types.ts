// Shared domain types for StudyCore AI. These describe the local-first
// student data model: courses, assignments, materials, study plans, rubric
// reports, grade simulations and the privacy/processing log. Everything here
// is persisted in localStorage by `store.ts` — no data leaves the device
// unless the student explicitly opts into a cloud AI request.

export type ProviderSource = "canvas" | "teams" | "manual";

/** Where a piece of academic data originated. */
export type DataSource = "canvas" | "teams" | "student_upload" | "ai_generated" | "manual";

// ---------------------------------------------------------------------------
// Assignment classification
// ---------------------------------------------------------------------------

/**
 * Coarse assignment type. The `assessment`-family types (quiz/test/exam) are
 * special: AI Help is locked to Study-Guide Mode for them, so the app never
 * helps a student produce answers to a graded assessment.
 */
export type AssignmentType =
  | "essay"
  | "problem_set"
  | "project"
  | "lab"
  | "reading"
  | "discussion"
  | "presentation"
  | "quiz"
  | "test"
  | "exam"
  | "other";

export type AssignmentStatus = "not_started" | "in_progress" | "submitted" | "graded";

// ---------------------------------------------------------------------------
// Course + Assignment
// ---------------------------------------------------------------------------

export interface Course {
  id: string;
  name: string;
  source: ProviderSource;
  /** Remote id from the provider, used to de-dupe on re-sync. */
  remoteId?: string;
  instructor?: string;
  term?: string;
  /** Tailwind/HSL-friendly accent used in the UI. */
  color: string;
  /** Official current grade as a percentage, only when the provider exposes it. */
  currentGrade?: number | null;
  letterGrade?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  instructions: string;
  dueDate?: string | null;
  type: AssignmentType;
  /** True when `type` was inferred from the title rather than set by the user. */
  typeAutoDetected: boolean;
  source: ProviderSource;
  remoteId?: string;
  status: AssignmentStatus;
  pointsPossible?: number | null;
  /** Raw points the student earned (when graded). */
  pointsEarned?: number | null;
  /** Convenience percentage (0-100) when graded. */
  gradePercent?: number | null;
  /** Teacher feedback text, when synced or pasted. */
  feedback?: string | null;
  /** Student-estimated difficulty 1-5, used to weight the planner. */
  difficulty?: number | null;
  /** Optional student estimate of minutes needed; planner falls back to a heuristic. */
  estimatedMinutes?: number | null;
  externalUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Assignment materials (exact shape from the spec, with local-only extras)
// ---------------------------------------------------------------------------

export interface AssignmentMaterial {
  id: string;
  assignmentId: string;
  courseId?: string;
  source: "canvas" | "teams" | "student_upload" | "ai_generated";
  fileName: string;
  fileType: string;
  localPath?: string;
  externalUrl?: string;
  extractedTextAvailable: boolean;
  indexedInCourseLibrary: boolean;
  includedInCurrentAIContext: boolean;
  createdAt: string;
  // --- local-only extras (not sent anywhere) ---
  /** Extracted plain text, when available, used to build AI context. */
  extractedText?: string;
  sizeBytes?: number;
  /** For ai_generated materials: what kind of artifact this is. */
  generatedKind?: GeneratedMaterialKind;
  /** Rendered markdown/plain content for ai_generated materials. */
  content?: string;
}

export type GeneratedMaterialKind =
  | "study_guide"
  | "checklist"
  | "breakdown"
  | "outline"
  | "practice_questions"
  | "summary"
  | "rubric_report"
  | "other";

// ---------------------------------------------------------------------------
// Course Knowledge Base (opt-in local RAG)
// ---------------------------------------------------------------------------

export interface CourseLibrarySettings {
  enabled: boolean;
  defaultUseForLocalRequests: boolean;
  /** Cloud requests never default to using the KB — locked to false. */
  defaultUseForCloudRequests: false;
  indexedCourseIds: string[];
  localStorageUsedBytes: number;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export interface PlannerPreferences {
  configured: boolean;
  /** Study minutes available on a typical weekday. */
  weekdayMinutes: number;
  /** Study minutes available on a typical weekend day. */
  weekendMinutes: number;
  /** Default length of a single study block in minutes. */
  sessionMinutes: number;
  /** Days to avoid scheduling on: 0 = Sunday … 6 = Saturday. */
  avoidDays: number[];
  /** Schedule overdue/closest-due work first. */
  prioritizeUrgent: boolean;
  /** Spread large projects across multiple days instead of one block. */
  spreadProjects: boolean;
}

export interface StudyBlock {
  id: string;
  assignmentId?: string;
  courseId?: string;
  title: string;
  scheduledStart: string;
  durationMinutes: number;
  completed: boolean;
  locked: boolean;
  generatedReason?: string;
}

export interface StudyPlan {
  id: string;
  createdAt: string;
  modelId?: string;
  processingType: "local" | "cloud" | "deterministic";
  blocks: StudyBlock[];
}

// ---------------------------------------------------------------------------
// Rubric checker
// ---------------------------------------------------------------------------

export interface RubricCriterionResult {
  criterionName: string;
  requirementSummary: string;
  evidenceFound: string[];
  missingOrWeakElements: string[];
  revisionSuggestions: string[];
  /** Optional self-rated confidence; UI also offers a "Needs student review" flag. */
  confidence?: "high" | "medium" | "low" | "needs_review";
  /** Student can tick a criterion off once addressed. */
  completed?: boolean;
}

export interface RubricAnalysisReport {
  id: string;
  assignmentId?: string;
  rubricMaterialId: string;
  studentWorkMaterialId: string;
  generatedAt: string;
  generatedByModelId: string;
  processingType: "local" | "cloud";
  criteriaResults: RubricCriterionResult[];
  strengths: string[];
  priorityRevisions: string[];
  finalChecklist: string[];
  /** Optional revised outline / revision plan. */
  revisedOutline?: string;
  /** Human label so multiple drafts of the same assignment can be compared. */
  draftLabel?: string;
}

// ---------------------------------------------------------------------------
// What-If grade calculator
// ---------------------------------------------------------------------------

export type GradeMode = "weighted" | "points_estimate" | "manual";

export interface GradeCategory {
  id: string;
  name: string;
  /** Weight as a percentage of the final grade (0-100). */
  weight: number;
}

export interface HypotheticalScore {
  id: string;
  /** Links to a real assignment when simulating an existing item; absent for invented ones. */
  assignmentId?: string;
  name: string;
  categoryId?: string;
  pointsEarned?: number | null;
  pointsPossible?: number | null;
  /** Direct percentage (0-100) used in manual/weighted mode when points aren't relevant. */
  percentage?: number | null;
  weight?: number | null;
  isHypothetical: boolean;
}

export interface GradeSimulationScenario {
  id: string;
  courseId: string;
  name: string;
  mode: GradeMode;
  categories?: GradeCategory[];
  hypotheticalScores: HypotheticalScore[];
  projectedPercentage?: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Privacy / processing history
// ---------------------------------------------------------------------------

export type ProcessingActionType =
  | "assignment_help"
  | "rubric_check"
  | "growth_summary"
  | "study_plan"
  | "general_chat";

export interface ProcessingHistoryEntry {
  id: string;
  timestamp: string;
  actionType: ProcessingActionType;
  modelId: string;
  processingType: "local" | "cloud";
  provider?: "gemini";
  includedFiles: boolean;
  includedCourseLibraryExcerpts: boolean;
}

// ---------------------------------------------------------------------------
// Connections (school platforms + cloud providers)
// ---------------------------------------------------------------------------

export interface CanvasConfig {
  /** Base URL like https://school.instructure.com. */
  baseUrl: string;
  /** Personal access token. Stored locally only; transits the proxy, never persisted server-side. */
  token: string;
  connected: boolean;
  lastSyncAt?: string | null;
  /** Cached display name from the last successful connection test. */
  userName?: string | null;
}

// ---------------------------------------------------------------------------
// Privacy badge vocabulary (shared across the whole app)
// ---------------------------------------------------------------------------

export type PrivacyBadgeKind =
  | "local_only"
  | "cloud_processing"
  | "canvas_synced"
  | "teams_synced"
  | "stored_on_device"
  | "included_in_ai_context"
  | "not_included";
