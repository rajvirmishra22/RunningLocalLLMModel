/**
 * Desktop tuning + optimizer logic.
 *
 * The desktop backend (llama.cpp via llama-cpp-2) can technically expose much
 * more than the in-browser WebLLM backend — context length, GPU offload, KV
 * cache precision, FlashAttention — but the current Tauri command surface only
 * accepts temperature/top_p/max_tokens. Anything not yet wired through to
 * Rust is marked "future" here so the UI is honest about scope.
 *
 * The optimizer recommends generation settings tuned for one of four
 * intent profiles. Because the installer bundles exactly one model, the
 * optimizer doesn't suggest swapping the model file — instead it picks
 * sampling params and an output length that suit the chosen intent.
 */

import type { DesktopGenSettings } from "./storage";

export type OptProfile = "balanced" | "max-quality" | "low-memory" | "fastest";

export interface DesktopCapability {
  label: string;
  /** "yes" — wired through to Rust today.
   *  "future" — backend supports it, UI not wired yet.
   *  "no" — out of scope for this build. */
  supported: "yes" | "future" | "no";
  note: string;
}

export const DESKTOP_CAPS: DesktopCapability[] = [
  { label: "Temperature", supported: "yes", note: "Applied per request via the chat command." },
  { label: "Top-p", supported: "yes", note: "Applied per request via the chat command." },
  { label: "Max output tokens", supported: "yes", note: "Hard cap on response length, per request." },
  { label: "Context length", supported: "future", note: "llama.cpp supports it; the model is currently loaded with a fixed 4096-token context. A UI control will land with model reload support." },
  { label: "GPU offload / layers", supported: "future", note: "The Rust side already requests maximum GPU offload; an explicit knob will land alongside CUDA/Vulkan build variants." },
  { label: "FlashAttention", supported: "future", note: "Available in the underlying llama.cpp build; not yet exposed through the Tauri command surface." },
  { label: "KV cache precision", supported: "future", note: "llama.cpp can quantize the KV cache (f16/q8_0/q4_0); not yet exposed." },
  { label: "Model variant / quantization", supported: "no", note: "The installer bundles exactly one model. Switching quantization will require a second download step, which isn't built yet." },
];

export interface DesktopRecommendation {
  profile: OptProfile;
  gen: { temperature: number; topP: number; maxTokens: number };
  reasoning: string[];
  warnings: string[];
}

const PROFILE_LABELS: Record<OptProfile, string> = {
  balanced: "Balanced",
  "max-quality": "Max Quality",
  "low-memory": "Low Memory",
  fastest: "Fastest",
};

export function profileLabel(p: OptProfile): string {
  return PROFILE_LABELS[p];
}

export function recommendDesktop(profile: OptProfile): DesktopRecommendation {
  const reasoning: string[] = [];
  const warnings: string[] = [];
  let gen: DesktopRecommendation["gen"];

  switch (profile) {
    case "balanced":
      gen = { temperature: 0.7, topP: 0.9, maxTokens: 1024 };
      reasoning.push("Temperature 0.7 with top-p 0.9 — a focused-but-not-robotic default that works well for general chat.");
      reasoning.push("Max output 1024 keeps responses concise while leaving room for longer answers when needed.");
      break;
    case "max-quality":
      gen = { temperature: 0.5, topP: 0.85, maxTokens: 2048 };
      reasoning.push("Lower temperature (0.5) and tighter top-p (0.85) make the model more deterministic — usually reads as higher quality.");
      reasoning.push("Higher max output (2048) lets the model fully complete reasoning-heavy answers.");
      break;
    case "low-memory":
      gen = { temperature: 0.7, topP: 0.9, maxTokens: 512 };
      reasoning.push("Shorter responses (max 512) reduce KV cache growth, which is the dominant memory cost across a long conversation.");
      reasoning.push("Good fit for machines with under 8 GB of RAM or no dedicated GPU.");
      break;
    case "fastest":
      gen = { temperature: 0.8, topP: 0.95, maxTokens: 512 };
      reasoning.push("Shorter responses arrive faster end-to-end. Slightly higher temperature for snappier, less repetitive output.");
      reasoning.push("Best for quick back-and-forth turns.");
      break;
  }

  reasoning.push("Switching quantization isn't part of this build — the desktop installer ships with exactly one bundled model. Multi-model downloads are a planned addition.");
  warnings.push("Memory and VRAM aren't directly readable from the webview, so the optimizer can't size for your hardware here. Switch to Low Memory if things feel slow.");

  return { profile, gen, reasoning, warnings };
}

/** Apply a recommendation to the user's stored settings. Flips `useCustom` to
 *  true because the user explicitly asked for tuned values. */
export function applyRecommendation(rec: DesktopRecommendation): DesktopGenSettings {
  return {
    useCustom: true,
    temperature: rec.gen.temperature,
    topP: rec.gen.topP,
    maxTokens: rec.gen.maxTokens,
  };
}

/** Coarse hardware probe via the webview. Mirrors what the in-browser app
 *  shows so users see the same level of honesty about what's detectable. */
export interface DesktopHardwareInfo {
  cpuThreads: number | "Unknown";
  ramGb: number | null;
  platform: string;
}

export function readHardware(): DesktopHardwareInfo {
  const cpuThreads =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : ("Unknown" as const);
  const ramGb =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null)
      : null;
  const platform = typeof navigator !== "undefined" ? navigator.platform || "Unknown" : "Unknown";
  return { cpuThreads, ramGb, platform };
}
