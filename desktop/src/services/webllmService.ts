/**
 * Drop-in replacement for the web app's webllmService, backed by the native
 * llama.cpp engine on the Rust side via Tauri `invoke`.
 *
 * The shape of every export here MUST stay identical to the web version so
 * pages (Chat / Dashboard / Models / Tuning / Settings) compile unchanged.
 *
 * Multi-turn conversation history is formatted client-side using each model
 * family's chat template, then sent as a single raw prompt to the Rust
 * `chat` command. The Rust side tokenizes verbatim — no extra wrapping.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Supported chat-template families. Each catalog entry picks one. */
export type ModelFamily = "llama3" | "qwen" | "phi3" | "mistral";

export interface WebLLMModel {
  id: string;
  label: string;
  sizeMb: number;
  description: string;
  minRamGb: number;
  /** Which chat template / stop-tokens to use. */
  family: ModelFamily;
  /**
   * Where the GGUF lives on Hugging Face. `null` means the model is bundled
   * with the installer and never needs to be downloaded.
   */
  url: string | null;
}

/**
 * Same labels/order as the web build so the Models page UI stays familiar.
 * Each non-bundled entry has a public Hugging Face URL to a Q4_K_M GGUF
 * (the bartowski conversions are the de-facto community standard).
 */
export const WEBLLM_MODELS: WebLLMModel[] = [
  {
    id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 1B",
    sizeMb: 770,
    description: "Bundled with this app. Runs instantly — no download.",
    minRamGb: 2,
    family: "llama3",
    url: null,
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 3B",
    sizeMb: 2020,
    description: "Stronger reasoning. Same Llama family, more parameters.",
    minRamGb: 4,
    family: "llama3",
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
    label: "Qwen 2.5 1.5B",
    sizeMb: 1000,
    description: "Compact multilingual model. Good for non-English chat.",
    minRamGb: 3,
    family: "qwen",
    url: "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f32_1-MLC",
    label: "Qwen 2.5 3B",
    sizeMb: 1930,
    description: "Strong reasoning and code, multilingual.",
    minRamGb: 4,
    family: "qwen",
    url: "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 Mini",
    sizeMb: 2390,
    description: "Microsoft's efficient instruct model. Tight footprint, sharp answers.",
    minRamGb: 4,
    family: "phi3",
    url: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
  },
  {
    id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
    label: "Mistral 7B",
    sizeMb: 4370,
    description: "Strong general model. Best on 8+ GB of RAM.",
    minRamGb: 6,
    family: "mistral",
    url: "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
  },
  {
    id: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
    label: "Llama 3.1 8B",
    sizeMb: 4920,
    description: "Flagship 8B. Best quality of any model here; needs the most RAM.",
    minRamGb: 8,
    family: "llama3",
    url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
  },
];

export interface InitProgress {
  text: string;
  progress: number; // 0-1
}

export interface DownloadProgressEvent {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
}

interface RustModelInfo {
  name: string;
  path: string;
  loaded: boolean;
}

interface RustDownloadedModel {
  modelId: string;
  path: string;
  sizeBytes: number;
}

/** The id of the single model we actually bundle with the installer. */
const BUNDLED_MODEL_ID = "Llama-3.2-1B-Instruct-q4f32_1-MLC";

/** On disk the bundled model is referenced by its sanitized id. */
function getModelById(modelId: string): WebLLMModel | undefined {
  return WEBLLM_MODELS.find((m) => m.id === modelId);
}

/** Stop strings the Rust generation loop should break on. */
function stopTokensFor(family: ModelFamily): string[] {
  switch (family) {
    case "llama3":
      return ["<|eot_id|>", "<|end_of_text|>"];
    case "qwen":
      return ["<|im_end|>", "<|endoftext|>"];
    case "phi3":
      return ["<|end|>", "<|endoftext|>"];
    case "mistral":
      return ["</s>"];
  }
}

/** Build a chat prompt the model family will recognise. */
function formatPrompt(
  family: ModelFamily,
  messages: { role: "user" | "assistant" | "system"; content: string }[],
): string {
  switch (family) {
    case "llama3": {
      let out = "";
      for (const m of messages) {
        out += `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`;
      }
      out += `<|start_header_id|>assistant<|end_header_id|>\n\n`;
      return out;
    }
    case "qwen": {
      // ChatML.
      let out = "";
      for (const m of messages) {
        out += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
      }
      out += `<|im_start|>assistant\n`;
      return out;
    }
    case "phi3": {
      let out = "";
      for (const m of messages) {
        out += `<|${m.role}|>\n${m.content}<|end|>\n`;
      }
      out += `<|assistant|>\n`;
      return out;
    }
    case "mistral": {
      // Mistral's `[INST]` template doesn't carry a `system` role natively —
      // we fold it into the first user turn.
      let out = "";
      let pendingSystem = "";
      for (const m of messages) {
        if (m.role === "system") {
          pendingSystem += (pendingSystem ? "\n\n" : "") + m.content;
          continue;
        }
        if (m.role === "user") {
          const userText = pendingSystem
            ? `${pendingSystem}\n\n${m.content}`
            : m.content;
          pendingSystem = "";
          out += `[INST] ${userText} [/INST]`;
        } else {
          out += ` ${m.content}</s>`;
        }
      }
      // If the conversation ended on a user message, we're ready for the
      // assistant to respond — nothing more to append.
      return out;
    }
  }
}

let loadedModelId: string | null = null;
/** Cache of one in-flight load per model id so concurrent callers share work. */
const initPromises = new Map<string, Promise<RustModelInfo>>();
/** Last-known set of downloaded model ids. Refreshed by `refreshDownloaded`. */
let downloadedIds = new Set<string>();

async function refreshDownloaded(): Promise<Set<string>> {
  try {
    const list = await invoke<RustDownloadedModel[]>("list_downloaded_models");
    downloadedIds = new Set(list.map((m) => m.modelId));
  } catch {
    /* Rust side not ready yet — treat as empty. */
  }
  return downloadedIds;
}

export const webllmService = {
  /**
   * Desktop always has a working native engine. Kept under this name so the
   * existing UI's "WebGPU detected ✓" branch lights up unchanged.
   */
  checkWebGPU(): boolean {
    return true;
  },

  getLoadedModelId(): string | null {
    return loadedModelId;
  },

  /**
   * Refresh + return the set of model ids currently downloaded to disk.
   * Frontend pages call this on mount.
   */
  async listDownloaded(): Promise<string[]> {
    const set = await refreshDownloaded();
    // The bundled model is "always available" from the user's POV.
    return Array.from(new Set([BUNDLED_MODEL_ID, ...Array.from(set)]));
  },

  /**
   * True iff this model is ready to load right now (bundled OR already on
   * disk).
   */
  isAvailable(modelId: string): boolean {
    if (modelId === BUNDLED_MODEL_ID) return true;
    return downloadedIds.has(modelId);
  },

  /**
   * Download a model's GGUF from Hugging Face into the app's data dir.
   * Surfaces progress via `onProgress` until done. Throws on cancel/failure.
   */
  async downloadModel(
    modelId: string,
    onProgress: (p: InitProgress) => void,
  ): Promise<void> {
    const model = getModelById(modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    if (!model.url) {
      throw new Error(`${model.label} is bundled and doesn't need a download.`);
    }
    if (downloadedIds.has(modelId)) {
      onProgress({ text: "Already downloaded.", progress: 1 });
      return;
    }

    onProgress({ text: "Connecting to Hugging Face…", progress: 0 });

    const unlisten = await listen<DownloadProgressEvent>(
      "download-progress",
      (event) => {
        if (event.payload.modelId !== modelId) return;
        const { downloadedBytes, totalBytes } = event.payload;
        const pct = totalBytes > 0 ? downloadedBytes / totalBytes : 0;
        const mb = (downloadedBytes / (1024 * 1024)).toFixed(0);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(0);
        onProgress({
          text: totalBytes > 0
            ? `Downloading… ${mb} / ${totalMb} MB`
            : `Downloading… ${mb} MB`,
          progress: pct,
        });
      },
    );

    try {
      await invoke("download_model", { modelId, url: model.url });
      downloadedIds.add(modelId);
      onProgress({ text: "Download complete.", progress: 1 });
    } finally {
      unlisten();
    }
  },

  /** Cancel an in-progress download for this model. */
  async cancelDownload(modelId: string): Promise<void> {
    try {
      await invoke("cancel_download", { modelId });
    } catch {
      /* best-effort */
    }
  },

  /** Delete a downloaded model from disk. No-op for the bundled model. */
  async deleteDownloaded(modelId: string): Promise<void> {
    if (modelId === BUNDLED_MODEL_ID) {
      throw new Error("The bundled model can't be deleted — it ships with the app.");
    }
    await invoke("delete_downloaded_model", { modelId });
    downloadedIds.delete(modelId);
    if (loadedModelId === modelId) {
      loadedModelId = null;
    }
  },

  /**
   * Load a model into the engine so it's ready to answer messages.
   * - Bundled model: instant (already on disk inside the install dir).
   * - Downloaded model: load the GGUF from the app's data dir.
   * - Anything else: throw with a clear message pointing the user at Models.
   */
  async loadModel(
    modelId: string,
    onProgress: (p: InitProgress) => void,
  ): Promise<unknown> {
    if (loadedModelId === modelId) {
      onProgress({ text: "Model already loaded.", progress: 1 });
      return {};
    }

    const isBundled = modelId === BUNDLED_MODEL_ID;
    if (!isBundled) {
      await refreshDownloaded();
      if (!downloadedIds.has(modelId)) {
        const model = getModelById(modelId);
        const label = model?.label ?? modelId;
        throw new Error(
          `${label} hasn't been downloaded yet. Open the Models page and click Download.`,
        );
      }
    }

    onProgress({
      text: isBundled
        ? "Loading bundled model into memory…"
        : "Loading model into memory…",
      progress: 0.1,
    });

    let pending = initPromises.get(modelId);
    if (!pending) {
      pending = (isBundled
        ? invoke<RustModelInfo>("init_model")
        : invoke<RustModelInfo>("init_downloaded_model", { modelId })
      ).catch((e) => {
        initPromises.delete(modelId);
        throw e;
      });
      initPromises.set(modelId, pending);
    }

    try {
      const info = await pending;
      loadedModelId = modelId;
      onProgress({ text: `Loaded ${info.name}.`, progress: 1 });
      return info;
    } catch (e) {
      throw new Error(`Failed to load model: ${String(e)}`);
    }
  },

  async streamChat(
    modelId: string,
    messages: { role: "user" | "assistant" | "system"; content: string }[],
    options: { temperature?: number; maxTokens?: number; topP?: number },
    onToken: (token: string) => void,
    onDone: (stats: {
      tokensPerSec: number;
      totalTimeMs: number;
      modelUsed: string;
      runtimeUsed: string;
    }) => void,
    onError: (err: Error) => void,
    abortController: AbortController,
  ): Promise<void> {
    if (loadedModelId !== modelId) {
      onError(new Error("Model not loaded. Load the model first."));
      return;
    }

    const model = getModelById(modelId);
    const family: ModelFamily = model?.family ?? "llama3";

    const startTime = Date.now();
    let totalTokens = 0;
    let unlisten: UnlistenFn | undefined;

    const onAbort = () => {
      void invoke("cancel_chat").catch(() => {
        /* best-effort */
      });
    };
    abortController.signal.addEventListener("abort", onAbort);

    try {
      unlisten = await listen<string>("token", (event) => {
        if (abortController.signal.aborted) return;
        totalTokens++;
        onToken(event.payload);
      });

      const prompt = formatPrompt(family, messages);

      await invoke<string>("chat", {
        prompt,
        maxTokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
        stopStrings: stopTokensFor(family),
      });

      const totalTimeMs = Date.now() - startTime;
      onDone({
        tokensPerSec: totalTokens > 0 ? (totalTokens / totalTimeMs) * 1000 : 0,
        totalTimeMs,
        modelUsed: modelId,
        runtimeUsed: "llama.cpp",
      });
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      unlisten?.();
      abortController.signal.removeEventListener("abort", onAbort);
    }
  },

  /**
   * Drops the in-memory engine handle so the next `loadModel` triggers a
   * fresh load. Doesn't touch on-disk weights.
   */
  unload() {
    loadedModelId = null;
    initPromises.clear();
  },
};
