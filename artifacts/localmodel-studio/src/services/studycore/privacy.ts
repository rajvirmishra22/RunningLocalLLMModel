// Privacy/processing telemetry + local data management. The processing log
// records METADATA only (never full prompts) so the Privacy Center can show
// "what touched a model" without retaining sensitive content. Also centralizes
// every destructive "delete my data" operation.

import { clearCloudConfig } from "../cloudProviders";
import { storageService } from "../storageService";
import { deleteDocument, listDocuments } from "../rag/rag";
import {
  SC_KEYS,
  assignmentStore,
  canvasConfigStore,
  courseLibraryStore,
  gradeScenarioStore,
  keyBytes,
  materialStore,
  newId,
  nowIso,
  processingHistoryStore,
  rubricReportStore,
  studyPlanStore,
} from "./store";
import type {
  PrivacyBadgeKind,
  ProcessingActionType,
  ProcessingHistoryEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Processing history
// ---------------------------------------------------------------------------

export function logProcessing(entry: {
  actionType: ProcessingActionType;
  modelId: string;
  processingType: "local" | "cloud";
  provider?: "openai" | "anthropic";
  includedFiles?: boolean;
  includedCourseLibraryExcerpts?: boolean;
}): ProcessingHistoryEntry {
  const record: ProcessingHistoryEntry = {
    id: newId("proc"),
    timestamp: nowIso(),
    actionType: entry.actionType,
    modelId: entry.modelId,
    processingType: entry.processingType,
    provider: entry.provider,
    includedFiles: entry.includedFiles ?? false,
    includedCourseLibraryExcerpts: entry.includedCourseLibraryExcerpts ?? false,
  };
  processingHistoryStore.add(record);
  return record;
}

export const PROCESSING_ACTION_LABELS: Record<ProcessingActionType, string> = {
  assignment_help: "Assignment Help",
  rubric_check: "Rubric Check",
  growth_summary: "Growth Summary",
  study_plan: "Study Plan",
  general_chat: "General Chat",
};

/** Cloud requests made this calendar month (count only — no content stored). */
export function cloudRequestsThisMonth(): number {
  const now = new Date();
  return processingHistoryStore
    .list()
    .filter((e) => e.processingType === "cloud")
    .filter((e) => {
      const d = new Date(e.timestamp);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
}

// ---------------------------------------------------------------------------
// Locked cloud-data protections (permanently on, not disableable)
// ---------------------------------------------------------------------------

export const LOCKED_CLOUD_PROTECTIONS: string[] = [
  "Always ask before sending assignment content to cloud AI.",
  "Always ask before sending files to cloud AI.",
  "Always ask before sending teacher feedback to cloud AI.",
  "Always ask before sending Course Knowledge Base excerpts to cloud AI.",
];

// ---------------------------------------------------------------------------
// Privacy badges
// ---------------------------------------------------------------------------

export const PRIVACY_BADGE_LABELS: Record<PrivacyBadgeKind, string> = {
  local_only: "Local Only",
  cloud_processing: "Cloud Processing",
  canvas_synced: "Canvas Synced",
  teams_synced: "Teams Synced",
  stored_on_device: "Stored on Device",
  included_in_ai_context: "Included in AI Context",
  not_included: "Not Included",
};

// ---------------------------------------------------------------------------
// Storage accounting for the dashboard
// ---------------------------------------------------------------------------

export interface StorageSummary {
  cachedFileCount: number;
  cachedFileBytes: number;
  conversationCount: number;
  conversationBytes: number;
  rubricReportCount: number;
  studyPlanCount: number;
  processingEntries: number;
  cloudRequestsThisMonth: number;
}

export function storageSummary(): StorageSummary {
  const materials = materialStore.list();
  const cachedFileBytes = materials.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0);
  return {
    cachedFileCount: materials.length,
    cachedFileBytes: cachedFileBytes || keyBytes(SC_KEYS.MATERIALS),
    conversationCount: storageService.getConversations().length,
    conversationBytes: keyBytes("lms_conversations"),
    rubricReportCount: rubricReportStore.list().length,
    studyPlanCount: studyPlanStore.list().length,
    processingEntries: processingHistoryStore.list().length,
    cloudRequestsThisMonth: cloudRequestsThisMonth(),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Granular + bulk deletion
// ---------------------------------------------------------------------------

export function deleteCachedAssignments(): void {
  assignmentStore.list().forEach((a) => assignmentStore.remove(a.id));
}

export function deleteCachedGrades(): void {
  for (const a of assignmentStore.list()) {
    if (a.pointsEarned != null || a.gradePercent != null) {
      assignmentStore.save({ ...a, pointsEarned: null, gradePercent: null, updatedAt: nowIso() });
    }
  }
}

export function deleteCachedFeedback(): void {
  for (const a of assignmentStore.list()) {
    if (a.feedback) assignmentStore.save({ ...a, feedback: null, updatedAt: nowIso() });
  }
}

export function deleteAllMaterials(): void {
  materialStore.list().forEach((m) => materialStore.remove(m.id));
}

export async function deleteCourseLibrary(): Promise<void> {
  const docs = await listDocuments();
  await Promise.all(docs.map((d) => deleteDocument(d.docId)));
  courseLibraryStore.save({
    ...courseLibraryStore.get(),
    enabled: false,
    indexedCourseIds: [],
    localStorageUsedBytes: 0,
  });
  for (const m of materialStore.list()) {
    if (m.indexedInCourseLibrary) materialStore.save({ ...m, indexedInCourseLibrary: false });
  }
}

export function deleteSavedChats(): void {
  storageService.getConversations().forEach((c) => storageService.deleteConversation(c.id));
}

export function deleteRubricReports(): void {
  rubricReportStore.list().forEach((r) => rubricReportStore.remove(r.id));
}

export function deleteStudyPlans(): void {
  studyPlanStore.list().forEach((p) => studyPlanStore.remove(p.id));
}

export function clearProcessingHistory(): void {
  processingHistoryStore.clear();
}

export function deleteApiCredentials(): void {
  clearCloudConfig();
}

export function deleteCanvasData(): void {
  canvasConfigStore.clear();
}

/** Nuclear option used by "Delete All Local Academic Data". */
export async function deleteAllAcademicData(): Promise<void> {
  await deleteCourseLibrary();
  Object.values(SC_KEYS).forEach((k) => localStorage.removeItem(k));
  gradeScenarioStore.list().forEach((s) => gradeScenarioStore.remove(s.id));
  deleteSavedChats();
  deleteApiCredentials();
}
