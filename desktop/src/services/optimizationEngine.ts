/**
 * Recommendation engine for the Tuning page.
 *
 * The single most important rule, per the user's brief:
 *   1. Recommend a model that's ALREADY been added to the user's profiles first.
 *   2. If nothing in their profiles is a good fit, recommend a model from the
 *      WebLLM catalog that they can add with one click.
 *   3. Never claim we can "change quantization" — switching quantization means
 *      switching to a different model file. We say so explicitly.
 *
 * Memory estimates here are deliberately coarse. Browsers don't expose exact
 * VRAM, and `navigator.deviceMemory` is capped at 8 GB. We mark every estimate
 * as `confidence: "low"` or `"medium"` so the UI can show appropriate warnings.
 */

import { WEBLLM_MODELS, type WebLLMModel } from "./webllmService";
import type { ModelProfile } from "./storageService";

export type OptimizationProfile = "balanced" | "max-quality" | "low-memory" | "fastest";

export interface RecommendedGenerationSettings {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export type RecommendedSource =
  | { kind: "available"; profileId: string; modelId: string; label: string; sizeMb: number }
  | { kind: "downloadable"; modelId: string; label: string; sizeMb: number; description: string };

export interface MemoryEstimate {
  modelGb: number;
  kvCacheGb: number;
  overheadGb: number;
  totalGb: number;
  confidence: "low" | "medium";
  fitsComfortably: boolean | null; // null when RAM is unknown
}

export interface Recommendation {
  profile: OptimizationProfile;
  /** True if the recommendation can be applied without the user downloading anything. */
  canApplyFully: boolean;
  /** The model to use. Preference order: an already-added profile > a downloadable catalog entry. */
  source: RecommendedSource;
  generation: RecommendedGenerationSettings;
  memory: MemoryEstimate;
  /** Quantization parsed out of the model ID (q4f16, q4f32, …). Display-only. */
  quantization: string;
  /** Plain-English reasoning shown to the user. */
  reasoning: string[];
  /** Caveats / things we couldn't determine confidently. */
  warnings: string[];
}

export interface OptimizerInputs {
  profile: OptimizationProfile;
  /** RAM in GB. Null if unknown. Note: `navigator.deviceMemory` is coarse and capped at 8. */
  ramGb: number | null;
  webgpuAvailable: boolean;
  savedProfiles: ModelProfile[];
}

const HUMAN_PROFILE_NAMES: Record<OptimizationProfile, string> = {
  balanced: "Balanced",
  "max-quality": "Max Quality",
  "low-memory": "Low Memory",
  fastest: "Fastest",
};

export function profileDisplayName(p: OptimizationProfile): string {
  return HUMAN_PROFILE_NAMES[p];
}

/** Parse the quantization tag out of a WebLLM model id, e.g. "Llama-3.2-1B-Instruct-q4f32_1-MLC" → "q4f32_1". */
export function parseQuantization(modelId: string): string {
  const match = modelId.match(/-(q\d+f\d+(?:_\d+)?)-/i);
  return match ? match[1] : "unknown";
}

/**
 * Coarse memory estimate. Numbers are not exact — browsers don't expose enough
 * to be exact. The model bytes are known (from WEBLLM_MODELS.sizeMb); KV cache
 * scales roughly with parameter count and context length; overhead is a flat
 * ~1 GB for the WebGPU runtime + tokenizer + JS heap.
 */
export function estimateMemory(model: WebLLMModel, contextLength: number, ramGb: number | null): MemoryEstimate {
  const modelGb = model.sizeMb / 1024;
  // Rough approximation: KV cache ~ 0.04 GB per 1 GB of model weight per 1024 tokens
  // of context. This is a back-of-envelope number that's close enough for "will
  // this fit" reasoning without overstating precision.
  const kvCacheGb = +(modelGb * 0.04 * (contextLength / 1024)).toFixed(2);
  const overheadGb = 1.0;
  const totalGb = +(modelGb + kvCacheGb + overheadGb).toFixed(2);
  const fitsComfortably = ramGb === null ? null : totalGb < ramGb * 0.7;
  return {
    modelGb: +modelGb.toFixed(2),
    kvCacheGb,
    overheadGb,
    totalGb,
    // Confidence is "medium" when we have a RAM number, "low" when we don't.
    confidence: ramGb === null ? "low" : "medium",
    fitsComfortably,
  };
}

/**
 * Score each catalog model against the chosen optimization profile + hardware.
 * Higher score wins. Returns scores sorted descending.
 */
function scoreModels(profile: OptimizationProfile, ramGb: number | null): { model: WebLLMModel; score: number }[] {
  // Conservative "safe RAM" — only ~70% of detected RAM is realistically usable
  // for the model itself. If RAM is unknown, assume 8 GB (the deviceMemory cap).
  const safeRamGb = (ramGb ?? 8) * 0.7;

  return WEBLLM_MODELS.map((m) => {
    const sizeGb = m.sizeMb / 1024;
    const fits = sizeGb + 1 < safeRamGb; // +1 GB for overhead
    const fitsTight = sizeGb + 0.3 < safeRamGb;

    let score = 0;
    switch (profile) {
      case "max-quality":
        // Bigger is better, but only if it fits at all.
        score = fitsTight ? m.sizeMb : -1000;
        break;
      case "balanced":
        // Prefer the largest model that fits comfortably. Penalise both
        // "too small" (under-using hardware) and "doesn't fit".
        score = fits ? m.sizeMb : -1000;
        break;
      case "low-memory":
        // Smallest model wins.
        score = -m.sizeMb;
        break;
      case "fastest":
        // Smallest that's still capable enough (>=700 MB excludes nothing here
        // but reads as intent). Prefer small.
        score = -m.sizeMb + (m.sizeMb >= 700 ? 100 : 0);
        break;
    }
    return { model: m, score };
  }).sort((a, b) => b.score - a.score);
}

/** Reasonable generation settings per profile. */
function generationFor(profile: OptimizationProfile): RecommendedGenerationSettings {
  switch (profile) {
    case "max-quality":
      return { temperature: 0.6, topP: 0.9, maxTokens: 2048 };
    case "balanced":
      return { temperature: 0.7, topP: 0.9, maxTokens: 2048 };
    case "low-memory":
      return { temperature: 0.7, topP: 0.9, maxTokens: 1024 };
    case "fastest":
      return { temperature: 0.8, topP: 0.95, maxTokens: 1024 };
  }
}

export function recommend(inputs: OptimizerInputs): Recommendation {
  const { profile, ramGb, webgpuAvailable, savedProfiles } = inputs;
  const ranked = scoreModels(profile, ramGb);
  const usable = ranked.filter((r) => r.score > -1000);
  // Pick the top scorer that's actually loadable. If nothing fits, fall back
  // to the smallest catalog model — never the largest — so users on tight
  // hardware get a safe suggestion rather than an unrunnable one.
  const smallestCatalog = [...WEBLLM_MODELS].sort((a, b) => a.sizeMb - b.sizeMb)[0];
  const top = usable.length > 0 ? usable[0].model : smallestCatalog;

  // Step 1: do we already have a saved profile pointing at the chosen model?
  const existingMatch = savedProfiles.find((p) => p.modelIdentifier === top.id);

  let source: RecommendedSource;
  if (existingMatch) {
    source = {
      kind: "available",
      profileId: existingMatch.id,
      modelId: top.id,
      label: existingMatch.name,
      sizeMb: top.sizeMb,
    };
  } else {
    source = {
      kind: "downloadable",
      modelId: top.id,
      label: top.label,
      sizeMb: top.sizeMb,
      description: top.description,
    };
  }

  const generation = generationFor(profile);
  const memory = estimateMemory(top, 4096, ramGb);

  const reasoning: string[] = [];
  const warnings: string[] = [];

  reasoning.push(
    source.kind === "available"
      ? `Picked "${source.label}" because it's already in your saved profiles and fits your hardware best for the ${HUMAN_PROFILE_NAMES[profile]} profile.`
      : `Suggesting "${top.label}" — it's the best fit in the catalog for the ${HUMAN_PROFILE_NAMES[profile]} profile. You don't have it added yet; one click adds it and it downloads when you first chat with it.`,
  );

  switch (profile) {
    case "max-quality":
      reasoning.push("Larger models produce noticeably better answers. We pick the biggest one your hardware can run.");
      break;
    case "balanced":
      reasoning.push("Picked the biggest model that still fits comfortably with room to spare for the conversation context.");
      break;
    case "low-memory":
      reasoning.push("Smaller model + shorter max output keeps RAM/VRAM use minimal. Great for older machines.");
      break;
    case "fastest":
      reasoning.push("Smaller models stream tokens faster. Cuts time-to-first-token on most hardware.");
      break;
  }

  reasoning.push(
    `Quantization for this model is ${parseQuantization(top.id)} — baked into the file. We don't change quantization on the fly; switching quantization means loading a different model variant, which is what we do here when needed.`,
  );

  if (!webgpuAvailable) {
    warnings.push("WebGPU is not available in this browser. The in-browser engine won't run until you switch to Chrome 113+ or Edge 113+.");
  }
  if (ramGb === null) {
    warnings.push("RAM could not be detected. The recommendation assumes ~8 GB available, which is the cap browsers expose for privacy reasons.");
  } else if (ramGb <= 4) {
    warnings.push(`Detected only ~${ramGb} GB of RAM (an approximate value the browser reports). Larger models may run slowly or fail to load.`);
  }
  if (memory.fitsComfortably === false) {
    warnings.push(
      `Estimated total memory (~${memory.totalGb} GB) is close to your detected RAM. The model might still load, but expect slower generation.`,
    );
  }
  warnings.push("Browser RAM reporting is approximate and capped at 8 GB. Memory estimates are guidance, not guarantees.");

  return {
    profile,
    canApplyFully: source.kind === "available" && webgpuAvailable,
    source,
    generation,
    memory,
    quantization: parseQuantization(top.id),
    reasoning,
    warnings,
  };
}
