// High-level RAG facade used by Chat + the Knowledge Base page. Wraps the
// runtime-specific `ragBackend` with all the orchestration logic (chunking,
// query embedding, prompt-block formatting). Identical on web and desktop —
// it's mirror-safe.

import { CHUNK_OVERLAP, CHUNK_SIZE, chunkText } from "./chunker";
import { ragBackend } from "./ragBackend";
import type {
  IndexedDoc,
  RagInitProgress,
  RetrievedChunk,
} from "./types";

/**
 * Files smaller than this go straight inline as before — RAG would be pure
 * overhead. Above this, we chunk + embed + retrieve so the model sees only
 * the relevant excerpts.
 */
export const RAG_THRESHOLD_CHARS = 4000;

/** How many chunks to retrieve per question by default. */
export const DEFAULT_TOP_K = 6;

/** BGE-style query prefix improves retrieval quality on asymmetric search. */
const QUERY_PREFIX = "";

export type { IndexedDoc, RetrievedChunk, RagInitProgress } from "./types";

/** True iff the runtime persists docs across reloads (desktop only). */
export function isPersistent(): boolean {
  return ragBackend.isPersistent();
}

/** True if this attachment is big enough to benefit from RAG. */
export function shouldIndex(file: { chars: number }): boolean {
  return file.chars > RAG_THRESHOLD_CHARS;
}

/** Pre-warm the embeddings model. Safe to call multiple times. */
export async function ensureReady(
  onProgress?: (p: RagInitProgress) => void,
): Promise<void> {
  await ragBackend.ensureModel(onProgress);
}

/**
 * Chunk + embed + persist a file. Returns the new doc's metadata. The caller
 * keeps the returned `docId` and passes it back to `retrieveForQuery` when
 * sending a chat message.
 */
export async function indexFile(
  file: { name: string; text: string },
  onProgress?: (p: RagInitProgress) => void,
): Promise<IndexedDoc> {
  await ragBackend.ensureModel(onProgress);
  onProgress?.({ text: "Splitting document into chunks…", progress: 0.6 });
  const chunks = chunkText(file.text, CHUNK_SIZE, CHUNK_OVERLAP);
  if (chunks.length === 0) {
    throw new Error("Document has no extractable text.");
  }
  onProgress?.({
    text: `Embedding ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}…`,
    progress: 0.7,
  });
  const embeddings = await ragBackend.embed(chunks);
  onProgress?.({ text: "Saving to knowledge base…", progress: 0.95 });
  const doc = await ragBackend.addDocument(file.name, chunks, embeddings);
  onProgress?.({ text: "Indexed.", progress: 1 });
  return doc;
}

export async function listDocuments(): Promise<IndexedDoc[]> {
  return ragBackend.listDocuments();
}

export async function deleteDocument(docId: string): Promise<void> {
  await ragBackend.deleteDocument(docId);
}

/**
 * Embed the question and return the top-k most relevant chunks across the
 * given documents. Returns `[]` for empty `docIds` or empty query.
 */
export async function retrieveForQuery(
  docIds: string[],
  query: string,
  k: number = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  if (docIds.length === 0 || !query.trim()) return [];
  await ragBackend.ensureModel();
  const [queryEmbedding] = await ragBackend.embed([QUERY_PREFIX + query]);
  return ragBackend.retrieve(docIds, queryEmbedding, k);
}

/**
 * Format retrieved chunks into a labeled context block ready to prepend
 * to the user's message. Grouped by source document so the model sees
 * clearly which file each excerpt came from.
 */
export function buildRagBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  const byDoc = new Map<string, RetrievedChunk[]>();
  for (const c of chunks) {
    if (!byDoc.has(c.docName)) byDoc.set(c.docName, []);
    byDoc.get(c.docName)!.push(c);
  }
  const parts: string[] = [];
  for (const [name, cs] of byDoc) {
    parts.push(`=== Relevant excerpts from ${name} ===`);
    cs.forEach((c, i) => {
      parts.push(
        `[excerpt ${i + 1}, relevance ${c.score.toFixed(2)}]\n${c.text}`,
      );
    });
    parts.push(`=== End of excerpts from ${name} ===`);
  }
  return parts.join("\n\n") + "\n\n";
}
