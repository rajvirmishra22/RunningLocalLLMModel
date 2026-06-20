// localStorage-backed persistence for the StudyCore domain model. Each entity
// collection lives under its own `sc_*` key. All reads are defensive (corrupt
// JSON degrades to an empty collection) and all writes are synchronous.
//
// This is intentionally a thin, dependency-free CRUD layer so the pure-logic
// services (planner, grades, rubric, privacy) and the React pages can share a
// single source of truth without any network or framework coupling.

import type {
  Assignment,
  AssignmentMaterial,
  CanvasConfig,
  Course,
  CourseLibrarySettings,
  GradeSimulationScenario,
  PlannerPreferences,
  ProcessingHistoryEntry,
  RubricAnalysisReport,
  StudyPlan,
} from "./types";

export const SC_KEYS = {
  COURSES: "sc_courses",
  ASSIGNMENTS: "sc_assignments",
  MATERIALS: "sc_materials",
  STUDY_PLANS: "sc_study_plans",
  RUBRIC_REPORTS: "sc_rubric_reports",
  GRADE_SCENARIOS: "sc_grade_scenarios",
  PROCESSING_HISTORY: "sc_processing_history",
  PLANNER_PREFS: "sc_planner_prefs",
  COURSE_LIBRARY: "sc_course_library",
  CANVAS_CONFIG: "sc_canvas_config",
  ONBOARDED: "sc_onboarded",
} as const;

export type ScCollectionKey = (typeof SC_KEYS)[keyof typeof SC_KEYS];

function readArray<T>(key: string): T[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function readObject<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

/** Generic upsert by `id` for any collection of `{ id }` records. */
function upsert<T extends { id: string }>(key: string, record: T): T {
  const items = readArray<T>(key);
  const idx = items.findIndex((i) => i.id === record.id);
  if (idx >= 0) items[idx] = record;
  else items.push(record);
  writeArray(key, items);
  return record;
}

function removeById<T extends { id: string }>(key: string, id: string): void {
  writeArray(
    key,
    readArray<T>(key).filter((i) => i.id !== id),
  );
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export const courseStore = {
  list: () => readArray<Course>(SC_KEYS.COURSES),
  get: (id: string) => readArray<Course>(SC_KEYS.COURSES).find((c) => c.id === id),
  getByRemote: (source: Course["source"], remoteId: string) =>
    readArray<Course>(SC_KEYS.COURSES).find((c) => c.source === source && c.remoteId === remoteId),
  save: (c: Course) => upsert(SC_KEYS.COURSES, c),
  remove: (id: string) => removeById<Course>(SC_KEYS.COURSES, id),
  replaceAll: (list: Course[]) => writeArray(SC_KEYS.COURSES, list),
};

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export const assignmentStore = {
  list: () => readArray<Assignment>(SC_KEYS.ASSIGNMENTS),
  listByCourse: (courseId: string) =>
    readArray<Assignment>(SC_KEYS.ASSIGNMENTS).filter((a) => a.courseId === courseId),
  get: (id: string) => readArray<Assignment>(SC_KEYS.ASSIGNMENTS).find((a) => a.id === id),
  getByRemote: (source: Assignment["source"], remoteId: string) =>
    readArray<Assignment>(SC_KEYS.ASSIGNMENTS).find(
      (a) => a.source === source && a.remoteId === remoteId,
    ),
  save: (a: Assignment) => upsert(SC_KEYS.ASSIGNMENTS, a),
  remove: (id: string) => removeById<Assignment>(SC_KEYS.ASSIGNMENTS, id),
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const materialStore = {
  list: () => readArray<AssignmentMaterial>(SC_KEYS.MATERIALS),
  listByAssignment: (assignmentId: string) =>
    readArray<AssignmentMaterial>(SC_KEYS.MATERIALS).filter((m) => m.assignmentId === assignmentId),
  listByCourse: (courseId: string) =>
    readArray<AssignmentMaterial>(SC_KEYS.MATERIALS).filter((m) => m.courseId === courseId),
  get: (id: string) => readArray<AssignmentMaterial>(SC_KEYS.MATERIALS).find((m) => m.id === id),
  save: (m: AssignmentMaterial) => upsert(SC_KEYS.MATERIALS, m),
  remove: (id: string) => removeById<AssignmentMaterial>(SC_KEYS.MATERIALS, id),
};

// ---------------------------------------------------------------------------
// Study plans
// ---------------------------------------------------------------------------

export const studyPlanStore = {
  list: () => readArray<StudyPlan>(SC_KEYS.STUDY_PLANS),
  get: (id: string) => readArray<StudyPlan>(SC_KEYS.STUDY_PLANS).find((p) => p.id === id),
  /** The most recently created plan, if any. */
  latest: () => {
    const plans = readArray<StudyPlan>(SC_KEYS.STUDY_PLANS);
    return plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  },
  save: (p: StudyPlan) => upsert(SC_KEYS.STUDY_PLANS, p),
  remove: (id: string) => removeById<StudyPlan>(SC_KEYS.STUDY_PLANS, id),
};

// ---------------------------------------------------------------------------
// Rubric reports
// ---------------------------------------------------------------------------

export const rubricReportStore = {
  list: () => readArray<RubricAnalysisReport>(SC_KEYS.RUBRIC_REPORTS),
  listByAssignment: (assignmentId: string) =>
    readArray<RubricAnalysisReport>(SC_KEYS.RUBRIC_REPORTS).filter(
      (r) => r.assignmentId === assignmentId,
    ),
  get: (id: string) => readArray<RubricAnalysisReport>(SC_KEYS.RUBRIC_REPORTS).find((r) => r.id === id),
  save: (r: RubricAnalysisReport) => upsert(SC_KEYS.RUBRIC_REPORTS, r),
  remove: (id: string) => removeById<RubricAnalysisReport>(SC_KEYS.RUBRIC_REPORTS, id),
};

// ---------------------------------------------------------------------------
// Grade scenarios
// ---------------------------------------------------------------------------

export const gradeScenarioStore = {
  list: () => readArray<GradeSimulationScenario>(SC_KEYS.GRADE_SCENARIOS),
  listByCourse: (courseId: string) =>
    readArray<GradeSimulationScenario>(SC_KEYS.GRADE_SCENARIOS).filter((s) => s.courseId === courseId),
  get: (id: string) =>
    readArray<GradeSimulationScenario>(SC_KEYS.GRADE_SCENARIOS).find((s) => s.id === id),
  save: (s: GradeSimulationScenario) => upsert(SC_KEYS.GRADE_SCENARIOS, s),
  remove: (id: string) => removeById<GradeSimulationScenario>(SC_KEYS.GRADE_SCENARIOS, id),
};

// ---------------------------------------------------------------------------
// Processing history (privacy log)
// ---------------------------------------------------------------------------

export const processingHistoryStore = {
  list: () =>
    readArray<ProcessingHistoryEntry>(SC_KEYS.PROCESSING_HISTORY).sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    ),
  add: (e: ProcessingHistoryEntry) => upsert(SC_KEYS.PROCESSING_HISTORY, e),
  clear: () => writeArray(SC_KEYS.PROCESSING_HISTORY, []),
};

// ---------------------------------------------------------------------------
// Planner preferences (singleton)
// ---------------------------------------------------------------------------

export const DEFAULT_PLANNER_PREFS: PlannerPreferences = {
  configured: false,
  weekdayMinutes: 120,
  weekendMinutes: 180,
  sessionMinutes: 45,
  avoidDays: [],
  prioritizeUrgent: true,
  spreadProjects: true,
};

export const plannerPrefsStore = {
  get: () => readObject<PlannerPreferences>(SC_KEYS.PLANNER_PREFS, DEFAULT_PLANNER_PREFS),
  save: (p: PlannerPreferences) => localStorage.setItem(SC_KEYS.PLANNER_PREFS, JSON.stringify(p)),
};

// ---------------------------------------------------------------------------
// Course Library settings (singleton)
// ---------------------------------------------------------------------------

export const DEFAULT_COURSE_LIBRARY: CourseLibrarySettings = {
  enabled: false,
  defaultUseForLocalRequests: true,
  defaultUseForCloudRequests: false,
  indexedCourseIds: [],
  localStorageUsedBytes: 0,
};

export const courseLibraryStore = {
  get: () => readObject<CourseLibrarySettings>(SC_KEYS.COURSE_LIBRARY, DEFAULT_COURSE_LIBRARY),
  save: (s: CourseLibrarySettings) =>
    localStorage.setItem(SC_KEYS.COURSE_LIBRARY, JSON.stringify(s)),
};

// ---------------------------------------------------------------------------
// Canvas connection config (singleton)
// ---------------------------------------------------------------------------

export const canvasConfigStore = {
  get: (): CanvasConfig | null => {
    const raw = localStorage.getItem(SC_KEYS.CANVAS_CONFIG);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CanvasConfig;
    } catch {
      return null;
    }
  },
  save: (c: CanvasConfig) => localStorage.setItem(SC_KEYS.CANVAS_CONFIG, JSON.stringify(c)),
  clear: () => localStorage.removeItem(SC_KEYS.CANVAS_CONFIG),
};

// ---------------------------------------------------------------------------
// Onboarding flag
// ---------------------------------------------------------------------------

export const onboardingStore = {
  isOnboarded: () => localStorage.getItem(SC_KEYS.ONBOARDED) === "true",
  markOnboarded: () => localStorage.setItem(SC_KEYS.ONBOARDED, "true"),
};

// ---------------------------------------------------------------------------
// Bulk helpers used by the Privacy Center
// ---------------------------------------------------------------------------

/** Approximate bytes used by a given localStorage key. */
export function keyBytes(key: string): number {
  const raw = localStorage.getItem(key);
  return raw ? new Blob([raw]).size : 0;
}

/** Total bytes used across all StudyCore keys. */
export function totalScBytes(): number {
  return Object.values(SC_KEYS).reduce((sum, k) => sum + keyBytes(k), 0);
}
