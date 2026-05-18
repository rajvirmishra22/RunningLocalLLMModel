import * as webllm from "@mlc-ai/web-llm";

export interface WebLLMModel {
  id: string;
  label: string;
  sizeMb: number;
  description: string;
  minRamGb: number;
}

export const WEBLLM_MODELS: WebLLMModel[] = [
  {
    id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 1B",
    sizeMb: 700,
    description: "Smallest option. Runs on almost any device with WebGPU.",
    minRamGb: 2,
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 3B",
    sizeMb: 1800,
    description: "Good balance of quality and speed for browser inference.",
    minRamGb: 4,
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
    label: "Qwen 2.5 1.5B",
    sizeMb: 1000,
    description: "Compact multilingual model, strong at instruction following.",
    minRamGb: 3,
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f32_1-MLC",
    label: "Qwen 2.5 3B",
    sizeMb: 2000,
    description: "Solid quality with good reasoning and code capability.",
    minRamGb: 4,
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 Mini",
    sizeMb: 2200,
    description: "Microsoft's efficient small model, great instruction following.",
    minRamGb: 4,
  },
  {
    id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
    label: "Mistral 7B",
    sizeMb: 4000,
    description: "Strong general-purpose model. Needs a capable GPU.",
    minRamGb: 6,
  },
  {
    id: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
    label: "Llama 3.1 8B",
    sizeMb: 4700,
    description: "Meta's flagship 8B — excellent quality in the browser.",
    minRamGb: 6,
  },
];

export interface InitProgress {
  text: string;
  progress: number; // 0-1
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
    abortController: AbortController
  ): Promise<void> {
    if (!engineCache || engineCache.modelId !== modelId) {
      onError(new Error("Model not loaded. Load the model first."));
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
