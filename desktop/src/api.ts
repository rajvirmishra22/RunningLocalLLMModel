import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ModelInfo {
  name: string;
  path: string;
  loaded: boolean;
}

/**
 * Initialise the inference backend (loads the bundled model into RAM).
 * Resolves once the model is ready. Safe to call multiple times.
 */
export async function initModel(): Promise<ModelInfo> {
  return await invoke<ModelInfo>("init_model");
}

/**
 * Run a chat completion. Tokens stream back via the "token" event.
 * Resolves with the full response string when generation completes.
 */
export async function chat(prompt: string, opts?: {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}): Promise<string> {
  return await invoke<string>("chat", {
    prompt,
    maxTokens: opts?.maxTokens ?? 512,
    temperature: opts?.temperature ?? 0.7,
    topP: opts?.topP ?? 0.9,
  });
}

/** Subscribe to streamed tokens. Returns an unlisten function. */
export async function onToken(cb: (token: string) => void): Promise<UnlistenFn> {
  return await listen<string>("token", (event) => cb(event.payload));
}

/** Cancel an in-flight chat. */
export async function cancelChat(): Promise<void> {
  await invoke("cancel_chat");
}
