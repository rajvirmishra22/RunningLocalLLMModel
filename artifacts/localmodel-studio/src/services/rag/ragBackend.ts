// Web RAG backend: embeds with @xenova/transformers (ONNX, runs in the
// browser via WASM/WebGPU) and stores everything in process memory. Reloads
// wipe the index — this is the "ephemeral session" mode.
//
// On desktop, this file is OVERLAID by a Tauri-backed implementation in
// `desktop/src/services/rag/ragBackend.ts` that talks to Rust over IPC and
// persists docs to disk. Both files MUST export the same `ragBackend` object
// shape (see `types.ts`).

import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";
import { cosineSim } from "./chunker";
import type { IndexedDoc, RagBackend, RagInitProgress, RetrievedChunk } from "./types";

// Pull weights from HF directly — no local-models lookup.
env.allowLocalModels = false;

// 384-dim, ~25 MB ONNX. Fastest popular sentence-embedding model with broad
// compatibility. Same dim as BGE-small so the two backends can use the same
// retrieval threshold heuristics even though vectors aren't comparable
// across runtimes (they don't need to be — each runtime keeps its own index).
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

type StoredChunk = { text: string; embedding: Float32Array };
type StoredDoc = {
  docId: string;
  name: string;
  createdAt: string;
  chunks: StoredChunk[];
};

const docs = new Map<string, StoredDoc>();

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(
  onProgress?: (p: RagInitProgress) => void,
): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise) return pipelinePromise;
  onProgress?.({ text: "Loading embeddings model…", progress: 0 });
  pipelinePromise = pipeline("feature-extraction", MODEL_ID, {
    // transformers.js fires progress callbacks during weight download.
    progress_callback: (p: unknown) => {
      const rec = p as { status?: string; progress?: number; file?: string };
      if (rec?.status === "progress" && typeof rec.progress === "number") {
        onProgress?.({
          text: `Loading embeddings model… ${Math.round(rec.progress)}%`,
          progress: Math.min(0.99, rec.progress / 100),
        });
      } else if (rec?.status === "done") {
        onProgress?.({ text: "Embeddings model ready.", progress: 1 });
      }
    },
  }) as Promise<FeatureExtractionPipeline>;
  return pipelinePromise;
}

function genDocId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const ragBackend: RagBackend = {
  isPersistent: () => false,

  async ensureModel(onProgress) {
    await getPipeline(onProgress);
  },

  async embed(texts) {
    const pipe = await getPipeline();
    const out: Float32Array[] = [];
    // Process sequentially. Batching would be faster but the API needs an
    // array argument with consistent shape — easier to keep this simple and
    // correct; documents typically have <100 chunks.
    for (const t of texts) {
      const res = await pipe(t, { pooling: "mean", normalize: true });
      // `res.data` is a TypedArray (Float32Array-ish). Copy to a real F32A.
      out.push(new Float32Array(res.data as ArrayLike<number>));
    }
    return out;
  },

  async addDocument(name, chunks, embeddings) {
    const docId = genDocId();
    const stored: StoredDoc = {
      docId,
      name,
      createdAt: new Date().toISOString(),
      chunks: chunks.map((text, i) => ({ text, embedding: embeddings[i] })),
    };
    docs.set(docId, stored);
    return {
      docId,
      name,
      chunkCount: chunks.length,
      createdAt: stored.createdAt,
    };
  },

  async listDocuments() {
    return Array.from(docs.values()).map((d) => ({
      docId: d.docId,
      name: d.name,
      chunkCount: d.chunks.length,
      createdAt: d.createdAt,
    }));
  },

  async deleteDocument(docId) {
    docs.delete(docId);
  },

  async retrieve(docIds, queryEmbedding, k) {
    const scored: RetrievedChunk[] = [];
    for (const docId of docIds) {
      const d = docs.get(docId);
      if (!d) continue;
      d.chunks.forEach((ch, i) => {
        scored.push({
          docId,
          docName: d.name,
          text: ch.text,
          score: cosineSim(queryEmbedding, ch.embedding),
          chunkIndex: i,
        });
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  },
};

export type { IndexedDoc, RetrievedChunk, RagInitProgress };
