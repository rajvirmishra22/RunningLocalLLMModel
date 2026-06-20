// Course Knowledge Base = opt-in local RAG over a student's course materials.
// Thin wrapper over the existing `rag` facade that adds StudyCore semantics:
// enable/disable flow, per-course indexing of materials, and bookkeeping of
// which courses are indexed. Cloud requests NEVER default to using the KB.

import { ensureReady, indexFile, retrieveForQuery } from "../rag/rag";
import type { RagInitProgress, RetrievedChunk } from "../rag/rag";
import { courseLibraryStore, materialStore, totalScBytes } from "./store";
import type { AssignmentMaterial, CourseLibrarySettings } from "./types";

export function getSettings(): CourseLibrarySettings {
  return courseLibraryStore.get();
}

export function saveSettings(s: CourseLibrarySettings): void {
  courseLibraryStore.save(s);
}

export function isEnabled(): boolean {
  return courseLibraryStore.get().enabled;
}

export function enable(): CourseLibrarySettings {
  const next = { ...courseLibraryStore.get(), enabled: true };
  courseLibraryStore.save(next);
  return next;
}

export function disable(): CourseLibrarySettings {
  const next = { ...courseLibraryStore.get(), enabled: false };
  courseLibraryStore.save(next);
  return next;
}

/** Materials with extracted text that are eligible for indexing. */
export function indexableMaterials(courseId?: string): AssignmentMaterial[] {
  return materialStore
    .list()
    .filter((m) => (courseId ? m.courseId === courseId : true))
    .filter((m) => m.extractedTextAvailable && (m.extractedText?.trim().length ?? 0) > 0);
}

/**
 * Index every eligible material for a course into the local RAG store and mark
 * them. Returns the number of newly indexed documents.
 */
export async function indexCourse(
  courseId: string,
  onProgress?: (p: RagInitProgress) => void,
): Promise<number> {
  await ensureReady(onProgress);
  const pending = indexableMaterials(courseId).filter((m) => !m.indexedInCourseLibrary);
  let count = 0;
  for (const m of pending) {
    await indexFile({ name: m.fileName, text: m.extractedText! }, onProgress);
    materialStore.save({ ...m, indexedInCourseLibrary: true });
    count++;
  }
  const settings = courseLibraryStore.get();
  const indexedCourseIds = Array.from(new Set([...settings.indexedCourseIds, courseId]));
  courseLibraryStore.save({
    ...settings,
    indexedCourseIds,
    localStorageUsedBytes: totalScBytes(),
  });
  return count;
}

/** Retrieve relevant excerpts for a query across the indexed knowledge base. */
export async function retrieve(query: string, k?: number): Promise<RetrievedChunk[]> {
  const docs = await import("../rag/rag").then((m) => m.listDocuments());
  if (docs.length === 0) return [];
  return retrieveForQuery(
    docs.map((d) => d.docId),
    query,
    k,
  );
}
