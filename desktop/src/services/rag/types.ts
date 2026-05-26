// Shared types for the RAG pipeline. Same shape on both runtimes — the
// web backend stores everything in memory, the desktop backend persists to
// disk under the Tauri app-data dir.

export interface IndexedDoc {
  /** Unique id assigned at index time. */
  docId: string;
  /** Original filename (as shown in chips / Knowledge Base list). */
  name: string;
  /** Number of chunks the doc was split into. */
  chunkCount: number;
  /** ISO timestamp the doc was indexed. */
  createdAt: string;
  /** PDF page count (undefined for non-PDF docs). */
  pageCount?: number;
}

export interface RetrievedChunk {
  docId: string;
  docName: string;
  text: string;
  /** Cosine similarity in [-1, 1]. Higher = more relevant. */
  score: number;
  /** 0-based position of this chunk inside its source document. */
  chunkIndex: number;
}

export interface RagInitProgress {
  text: string;
  /** 0..1. May be undefined when progress is indeterminate. */
  progress: number;
}

/**
 * Runtime-specific backend. The facade in `rag.ts` calls this; the two
 * overlay files (`ragBackend.ts` in web vs desktop) provide different
 * implementations.
 */
export interface RagBackend {
  /** True if documents survive across reloads (desktop only). */
  isPersistent(): boolean;

  /**
   * Ensure the embeddings model is ready. Idempotent. On first call this
   * may download the model on desktop (~30 MB) or load it on web (~25 MB
   * ONNX). Subsequent calls are no-ops.
   */
  ensureModel(onProgress?: (p: RagInitProgress) => void): Promise<void>;

  /** Embed an array of texts. Returns one Float32Array per input. */
  embed(texts: string[]): Promise<Float32Array[]>;

  /**
   * Persist a new document. The facade calls this after chunking + embedding
   * the source text; the backend just stores the supplied pairs.
   */
  addDocument(
    name: string,
    chunks: string[],
    embeddings: Float32Array[],
    meta?: { pageCount?: number },
  ): Promise<IndexedDoc>;

  listDocuments(): Promise<IndexedDoc[]>;
  deleteDocument(docId: string): Promise<void>;

  /**
   * Top-k cosine search across the given document ids. The query is already
   * embedded by the facade so the backend doesn't need to re-embed.
   */
  retrieve(
    docIds: string[],
    queryEmbedding: Float32Array,
    k: number,
  ): Promise<RetrievedChunk[]>;
}
