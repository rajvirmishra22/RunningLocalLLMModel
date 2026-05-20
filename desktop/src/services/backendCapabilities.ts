/**
 * Backend capability matrix for the in-browser app.
 *
 * The web app only has one backend (WebLLM), so this is a hand-coded constant.
 * It exists as a separate module so the Tuning UI can render an honest table of
 * what we can and cannot change at runtime — instead of pretending every knob
 * exists for every backend.
 *
 * "Capability" here means: can the app actually change this thing right now
 * without loading a completely different model file? If the answer is no, the
 * UI shows the control as unsupported with an explanation.
 */

export type Support = "yes" | "no" | "unknown";
export type ChangeMode = "immediate" | "reload" | "different-file" | "unsupported";

export interface Capability {
  label: string;
  support: Support;
  changeMode: ChangeMode;
  note: string;
}

export interface BackendCapabilities {
  backend: "webllm";
  caps: {
    temperature: Capability;
    topP: Capability;
    topK: Capability;
    maxTokens: Capability;
    contextLength: Capability;
    flashAttention: Capability;
    kvCacheQuantization: Capability;
    gpuOffload: Capability;
    batchSize: Capability;
    modelQuantization: Capability;
  };
}

/**
 * Capability map for WebLLM. Reflects what `@mlc-ai/web-llm`'s
 * `chat.completions.create` and `CreateMLCEngine` actually expose.
 */
export const WEBLLM_CAPABILITIES: BackendCapabilities = {
  backend: "webllm",
  caps: {
    temperature: {
      label: "Temperature",
      support: "yes",
      changeMode: "immediate",
      note: "Passed to each generation call. Takes effect on the next message.",
    },
    topP: {
      label: "Top-p",
      support: "yes",
      changeMode: "immediate",
      note: "Passed to each generation call. Takes effect on the next message.",
    },
    topK: {
      label: "Top-k",
      support: "no",
      changeMode: "unsupported",
      note: "WebLLM's chat completions API does not expose top-k. Use top-p instead.",
    },
    maxTokens: {
      label: "Max output tokens",
      support: "yes",
      changeMode: "immediate",
      note: "Passed to each generation call. Caps how long the model can respond for.",
    },
    contextLength: {
      label: "Context length",
      support: "no",
      changeMode: "different-file",
      note: "Each WebLLM model is published with a fixed context window. Loading a longer-context variant means loading a different model file.",
    },
    flashAttention: {
      label: "FlashAttention",
      support: "no",
      changeMode: "unsupported",
      note: "WebLLM runs through WebGPU shaders; FlashAttention is not user-configurable.",
    },
    kvCacheQuantization: {
      label: "KV cache precision",
      support: "no",
      changeMode: "unsupported",
      note: "KV cache precision is baked into each prebuilt MLC package. Not adjustable from the app.",
    },
    gpuOffload: {
      label: "GPU offload / layers",
      support: "no",
      changeMode: "unsupported",
      note: "WebGPU manages offloading automatically — the browser decides what runs on the GPU.",
    },
    batchSize: {
      label: "Batch size",
      support: "no",
      changeMode: "unsupported",
      note: "WebLLM does not expose batch-size controls.",
    },
    modelQuantization: {
      label: "Model quantization",
      support: "no",
      changeMode: "different-file",
      note: "Quantization is baked into each model file (e.g. q4f16, q4f32). Switching means loading a different model variant.",
    },
  },
};
