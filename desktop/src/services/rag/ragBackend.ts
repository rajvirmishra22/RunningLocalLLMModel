// Desktop RAG backend: native llama.cpp embeddings + persistent JSON store
// on disk. Mirrors the web backend's exported shape so the shared `rag.ts`
// facade and the Chat / Knowledge Base pages compile unchanged on both
// runtimes.
//
// IMPORTANT: this file is the desktop overlay — when the web app's
// `artifacts/localmodel-studio/src/` tree is mirrored over `desktop/src/`,
// preserve this file the same way we preserve `services/webllmService.ts`.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  IndexedDoc,
  RagBackend,
  RagInitProgress,
  RetrievedChunk,
} from "./types";

interface EmbedStatus {
  /** GGUF file present in app-data dir. */
  downloaded: boolean;
  /** Loaded into memory and ready to embed. */
  loaded: boolean;
  /** Size in bytes if downloaded. */
  sizeBytes: number;
}

interface DownloadProgressEvent {
  downloadedBytes: number;
  totalBytes: number;
}

let modelReady = false;
let pendingReady: Promise<void> | null = null;

async function downloadAndLoad(
  onProgress?: (p: RagInitProgress) => void,
): Promise<void> {
  const status = await invoke<EmbedStatus>("embed_status");

  if (!status.downloaded) {
    onProgress?.({
      text: "Downloading embeddings model (~30 MB, one-time)…",
      progress: 0,
    });
    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<DownloadProgressEvent>(
        "embed-download-progress",
        (e) => {
          const { downloadedBytes, totalBytes } = e.payload;
          const pct = totalBytes > 0 ? downloadedBytes / totalBytes : 0;
          const mb = (downloadedBytes / (1024 * 1024)).toFixed(1);
          onProgress?.({
            text: totalBytes > 0
              ? `Downloading embeddings model… ${mb} MB`
              : `Downloading embeddings model… ${mb} MB`,
            // Reserve the last 5% for the load step.
            progress: pct * 0.95,
          });
        },
      );
      await invoke("download_embed_model");
    } finally {
      unlisten?.();
    }
  }

  if (!status.loaded) {
    onProgress?.({ text: "Loading embeddings model into memory…", progress: 0.97 });
    await invoke("init_embed_model");
  }

  onProgress?.({ text: "Embeddings model ready.", progress: 1 });
}

export const ragBackend: RagBackend = {
  isPersistent: () => true,

  async ensureModel(onProgress) {
    if (modelReady) return;
    if (!pendingReady) {
      pendingReady = (async () => {
        try {
          await downloadAndLoad(onProgress);
          modelReady = true;
        } catch (e) {
          pendingReady = null; // allow retry
          throw e;
        }
      })();
    }
    await pendingReady;
  },

  async embed(texts) {
    const result = await invoke<number[][]>("embed_texts", { texts });
    return result.map((arr) => new Float32Array(arr));
  },

  async addDocument(name, chunks, embeddings, meta) {
    return invoke<IndexedDoc>("rag_add_document", {
      name,
      chunks,
      embeddings: embeddings.map((e) => Array.from(e)),
      pageCount: meta?.pageCount ?? null,
    });
  },

  async listDocuments() {
    return invoke<IndexedDoc[]>("rag_list_documents");
  },

  async deleteDocument(docId) {
    await invoke("rag_delete_document", { docId });
  },

  async retrieve(docIds, queryEmbedding, k) {
    return invoke<RetrievedChunk[]>("rag_retrieve", {
      docIds,
      queryEmbedding: Array.from(queryEmbedding),
      k,
    });
  },
};

export type { IndexedDoc, RetrievedChunk, RagInitProgress };
