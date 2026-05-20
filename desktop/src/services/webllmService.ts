/**
 * Drop-in replacement for the web app's webllmService, backed by the native
 * llama.cpp engine on the Rust side via Tauri `invoke`.
 *
 * The shape of every export here MUST stay identical to the web version so
 * pages (Chat / Dashboard / Models / Tuning / Settings) compile unchanged.
 *
 * Multi-turn conversation history is formatted client-side using Llama 3's
 * header-token template, then sent as a single raw prompt to the Rust
 * `chat` command. The Rust side tokenizes verbatim — no extra wrapping.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface WebLLMModel {
  id: string;
  label: string;
  sizeMb: number;
  description: string;
  minRamGb: number;
}

/**
 * Same catalog as the web build so the Models page UI is identical. Only the
 * bundled model is actually runnable in this build; the others surface a
 * friendly "download manager coming soon" error when selected.
 */
export const WEBLLM_MODELS: WebLLMModel[] = [
  {
    id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 1B",
    sizeMb: 700,
    description: "Bundled with this app. Runs instantly — no download.",
    minRamGb: 2,
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 3B",
    sizeMb: 1800,
    description: "Better quality. Requires the in-app downloader (coming soon).",
    minRamGb: 4,
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
    label: "Qwen 2.5 1.5B",
    sizeMb: 1000,
    description: "Compact multilingual model. Downloader coming soon.",
    minRamGb: 3,
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f32_1-MLC",
    label: "Qwen 2.5 3B",
    sizeMb: 2000,
    description: "Strong reasoning and code. Downloader coming soon.",
    minRamGb: 4,
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 Mini",
    sizeMb: 2200,
    description: "Microsoft's efficient instruct model. Downloader coming soon.",
    minRamGb: 4,
  },
  {
    id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
    label: "Mistral 7B",
    sizeMb: 4000,
    description: "Strong general model. Downloader coming soon.",
    minRamGb: 6,
  },
  {
    id: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
    label: "Llama 3.1 8B",
    sizeMb: 4700,
    description: "Flagship 8B. Downloader coming soon.",
    minRamGb: 6,
  },
];

export interface InitProgress {
  text: string;
  progress: number; // 0-1
}

/** The id of the single model we actually bundle with the installer. */
const BUNDLED_MODEL_ID = "Llama-3.2-1B-Instruct-q4f32_1-MLC";

interface RustModelInfo {
  name: string;
  path: string;
  loaded: boolean;
}

let loadedModelId: string | null = null;
let initPromise: Promise<RustModelInfo> | null = null;

/**
 * Format a list of chat messages using Llama 3 Instruct's official chat
 * template. `<|begin_of_text|>` is added by the Rust tokenizer (AddBos),
 * so we do NOT include it here.
 */
function formatLlama3Chat(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
): string {
  let out = "";
  for (const m of messages) {
    out += `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`;
  }
  // Prompt the assistant for its next turn.
  out += `<|start_header_id|>assistant<|end_header_id|>\n\n`;
  return out;
}

export const webllmService = {
  /**
   * In the desktop build we always have a working local engine (llama.cpp).
   * Keeping the WebGPU-shaped name lets the existing UI ("WebGPU detected ✓")
   * light up without changes — it's checking "can I run locally?".
   */
  checkWebGPU(): boolean {
    return true;
  },

  getLoadedModelId(): string | null {
    return loadedModelId;
  },

  /**
   * "Loading" the model on desktop = telling Rust to load the bundled GGUF
   * (which only actually happens once — subsequent calls are no-ops).
   * Progress is faked since there's no network download.
   */
  async loadModel(
    modelId: string,
    onProgress: (p: InitProgress) => void,
  ): Promise<unknown> {
    if (modelId !== BUNDLED_MODEL_ID) {
      throw new Error(
        `${modelId} isn't bundled with this build. ` +
          `An in-app downloader for other models is coming in a future update — ` +
          `for now please use the bundled Llama 3.2 1B model.`,
      );
    }

    if (loadedModelId === modelId) {
      onProgress({ text: "Model already loaded.", progress: 1 });
      return {};
    }

    onProgress({ text: "Loading bundled model into memory…", progress: 0.1 });

    // Cache the in-flight init so concurrent callers share one load.
    if (!initPromise) {
      initPromise = invoke<RustModelInfo>("init_model").catch((e) => {
        initPromise = null;
        throw e;
      });
    }

    try {
      const info = await initPromise;
      loadedModelId = modelId;
      onProgress({
        text: `Loaded ${info.name}.`,
        progress: 1,
      });
      return info;
    } catch (e) {
      throw new Error(`Failed to load bundled model: ${String(e)}`);
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

      const prompt = formatLlama3Chat(messages);

      await invoke<string>("chat", {
        prompt,
        maxTokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
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
   * No-op on desktop — the model stays resident for the life of the process.
   * (Unloading mid-session would force a multi-second reload on the next
   * message.) Kept for API parity with the web build.
   */
  unload() {
    loadedModelId = null;
  },
};
