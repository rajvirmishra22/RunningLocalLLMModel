import * as webllm from "@mlc-ai/web-llm";

/**
 * Kept in lockstep with the desktop overlay so the shared Models.tsx UI
 * compiles unchanged. On the web build the family field is informational —
 * WebLLM uses its own bundled chat template per MLC model id.
 */
export type ModelFamily = "llama3" | "qwen" | "phi3" | "mistral";
export type ModelCategory = "general" | "coding" | "reasoning" | "vision";

export interface WebLLMModel {
  id: string;
  label: string;
  sizeMb: number;
  description: string;
  minRamGb: number;
  family?: ModelFamily;
  url?: string | null;
  custom?: boolean;
  /** Grouping shown on the Models page; defaults to "general". */
  category?: ModelCategory;
  /** True if this model can accept images alongside text. */
  vision?: boolean;
  /**
   * Companion vision projector (CLIP). Only meaningful for vision models on
   * the desktop build — the in-browser build doesn't run native vision yet.
   */
  mmprojUrl?: string;
  mmprojSizeMb?: number;
}

export const WEBLLM_MODELS: WebLLMModel[] = [
  {
    id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 1B",
    sizeMb: 700,
    description: "Smallest option. Runs on almost any device with WebGPU.",
    minRamGb: 2,
    category: "general",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 3B",
    sizeMb: 1800,
    description: "Good balance of quality and speed for browser inference.",
    minRamGb: 4,
    category: "general",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
    label: "Qwen 2.5 1.5B",
    sizeMb: 1000,
    description: "Compact multilingual model, strong at instruction following.",
    minRamGb: 3,
    category: "general",
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f32_1-MLC",
    label: "Qwen 2.5 3B",
    sizeMb: 2000,
    description: "Solid quality with good reasoning and code capability.",
    minRamGb: 4,
    category: "general",
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 Mini",
    sizeMb: 2200,
    description: "Microsoft's efficient small model, great instruction following.",
    minRamGb: 4,
    category: "general",
  },
  {
    id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 Coder 1.5B",
    sizeMb: 950,
    description: "Tiny code-focused model. Great for autocomplete-style help in the browser.",
    minRamGb: 3,
    category: "coding",
  },
  {
    id: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 Coder 7B",
    sizeMb: 4400,
    description: "Strong open coding model. Best-in-class for browser-side dev help.",
    minRamGb: 8,
    category: "coding",
  },
  {
    id: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
    label: "DeepSeek R1 Distill 7B",
    sizeMb: 4400,
    description: "Reasoning-tuned distill. Thinks step-by-step before answering.",
    minRamGb: 8,
    category: "reasoning",
  },
  {
    id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
    label: "Mistral 7B",
    sizeMb: 4000,
    description: "Strong general-purpose model. Needs a capable GPU.",
    minRamGb: 6,
    category: "general",
  },
  {
    id: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
    label: "Llama 3.1 8B",
    sizeMb: 4700,
    description: "Meta's flagship 8B — excellent quality in the browser.",
    minRamGb: 6,
    category: "general",
  },
];

export interface InitProgress {
  text: string;
  progress: number; // 0-1
}

// ---------------------------------------------------------------------------
// Custom-catalog API — desktop-only feature. Stubbed here so the shared
// Models.tsx UI compiles for the web build. The UI gates the custom-model
// section on `isCustomCatalogSupported()`, so these throwers never run in
// practice.
// ---------------------------------------------------------------------------

export interface AddCustomModelInput {
  label: string;
  url: string;
  sizeMb: number;
  minRamGb: number;
  family: ModelFamily;
  description?: string;
  vision?: boolean;
  mmprojUrl?: string;
  mmprojSizeMb?: number;
}

export interface ProbeResult {
  sizeBytes: number;
  contentType: string | null;
  finalUrl: string;
}

export function isCustomCatalogSupported(): boolean {
  return false;
}

export function getCatalog(): WebLLMModel[] {
  return WEBLLM_MODELS;
}

export function listCustomModels(): WebLLMModel[] {
  return [];
}

export function detectFamily(_text: string): ModelFamily {
  return "llama3";
}

export function addCustomModel(_input: AddCustomModelInput): WebLLMModel {
  throw new Error(
    "Custom Hugging Face models are only supported in the desktop app.",
  );
}

export function removeCustomModel(_modelId: string): void {
  /* no-op on web */
}

export async function probeModelUrl(_url: string): Promise<ProbeResult> {
  throw new Error(
    "Probing remote model URLs is only supported in the desktop app.",
  );
}

type EngineCache = {
  engine: webllm.MLCEngine;
  modelId: string;
};

let engineCache: EngineCache | null = null;

export const webllmService = {
  checkWebGPU(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator;
  },

  getLoadedModelId(): string | null {
    return engineCache?.modelId ?? null;
  },

  /**
   * Web stub for the desktop overlay's `deleteDownloaded`. The web build
   * caches model weights in IndexedDB via WebLLM, not as discrete files we
   * own; the Models UI calls this when removing a custom catalog entry but
   * on web there's nothing for us to clean up here.
   */
  async deleteDownloaded(_modelId: string): Promise<void> {
    /* no-op on web */
  },

  async loadModel(
    modelId: string,
    onProgress: (p: InitProgress) => void
  ): Promise<webllm.MLCEngine> {
    if (engineCache?.modelId === modelId) {
      onProgress({ text: "Model already loaded.", progress: 1 });
      return engineCache.engine;
    }

    if (engineCache) {
      engineCache.engine.unload();
      engineCache = null;
    }

    const engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report: webllm.InitProgressReport) => {
        onProgress({
          text: report.text,
          progress: report.progress,
        });
      },
    });

    engineCache = { engine, modelId };
    return engine;
  },

  async streamChat(
    modelId: string,
    messages: { role: "user" | "assistant" | "system"; content: string }[],
    options: { temperature?: number; maxTokens?: number; topP?: number },
    onToken: (token: string) => void,
    onDone: (stats: { tokensPerSec: number; totalTimeMs: number; modelUsed: string; runtimeUsed: string }) => void,
    onError: (err: Error) => void,
    abortController: AbortController,
    /**
     * Optional image attachments for vision-capable models. The in-browser
     * WebLLM runtime does not currently support image inputs, so this is
     * accepted for API parity with the desktop build and ignored. If you
     * try to chat with images against a web model, an error is surfaced so
     * the user knows to switch to a cloud or desktop vision model.
     */
    images?: string[]
  ): Promise<void> {
    if (!engineCache || engineCache.modelId !== modelId) {
      onError(new Error("Model not loaded. Load the model first."));
      return;
    }

    if (images && images.length > 0) {
      onError(
        new Error(
          "Image input isn't supported by the in-browser models yet. Pick a vision-capable Gemini cloud model, or use the desktop build for local vision."
        )
      );
      return;
    }

    const startTime = Date.now();
    let totalTokens = 0;

    try {
      const reply = await engineCache.engine.chat.completions.create({
        messages,
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        top_p: options.topP ?? 0.9,
      });

      for await (const chunk of reply) {
        if (abortController.signal.aborted) break;
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          totalTokens++;
          onToken(delta);
        }
      }

      const totalTimeMs = Date.now() - startTime;
      onDone({
        tokensPerSec: totalTokens > 0 ? (totalTokens / totalTimeMs) * 1000 : 0,
        totalTimeMs,
        modelUsed: modelId,
        runtimeUsed: "webllm",
      });
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  },

  unload() {
    if (engineCache) {
      engineCache.engine.unload();
      engineCache = null;
    }
  },
};
