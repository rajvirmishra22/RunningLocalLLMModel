/**
 * Desktop equivalent of the web capability report.
 *
 * Same shape and intent as artifacts/localmodel-studio/src/services/capabilityReport.ts,
 * but tuned for the native llama.cpp backend:
 *   - The catalog is GGUF quant variants (Q4_K_M, Q5_K_M), not WebLLM model IDs.
 *   - The memory budget is larger (0.7x system RAM vs 0.5x for the browser tab).
 *   - KV cache quantization, FlashAttention, batch size, and context length
 *     are all real recommendations because llama.cpp actually exposes them —
 *     even though the current Tauri command surface only wires temp/top-p/max.
 *     We mark this honestly in caveats.
 *
 * The catalog is intentionally forward-looking. Today the installer bundles
 * one model; the rest are listed so users can see what their hardware could
 * handle once multi-model downloads land.
 */

import { readHardware } from "./tuning";

interface GgufCandidate {
  label: string;
  paramsB: number;
  sizeGb: number;
  quant: "Q4_K_M" | "Q5_K_M";
  bundled?: boolean;
}

const CATALOG: GgufCandidate[] = [
  { label: "Qwen 2.5 0.5B Q4_K_M", paramsB: 0.5, sizeGb: 0.4, quant: "Q4_K_M", bundled: true },
  { label: "TinyLlama 1.1B Q4_K_M", paramsB: 1.1, sizeGb: 0.7, quant: "Q4_K_M" },
  { label: "Qwen 2.5 1.5B Q4_K_M", paramsB: 1.5, sizeGb: 1.0, quant: "Q4_K_M" },
  { label: "Llama 3.2 3B Q4_K_M", paramsB: 3, sizeGb: 2.0, quant: "Q4_K_M" },
  { label: "Phi 3.5 Mini Q4_K_M", paramsB: 3.8, sizeGb: 2.3, quant: "Q4_K_M" },
  { label: "Mistral 7B Q4_K_M", paramsB: 7, sizeGb: 4.4, quant: "Q4_K_M" },
  { label: "Qwen 2.5 7B Q4_K_M", paramsB: 7, sizeGb: 4.4, quant: "Q4_K_M" },
  { label: "Llama 3.1 8B Q4_K_M", paramsB: 8, sizeGb: 4.9, quant: "Q4_K_M" },
  { label: "Mistral 7B Q5_K_M", paramsB: 7, sizeGb: 5.1, quant: "Q5_K_M" },
  { label: "Qwen 2.5 14B Q4_K_M", paramsB: 14, sizeGb: 8.4, quant: "Q4_K_M" },
];

const BUNDLED_LABEL = CATALOG.find((c) => c.bundled)?.label ?? "the bundled model";

export interface DesktopCapabilityReport {
  hardware: {
    ramGb: number;
    ramApproximate: boolean;
    cpuThreads: number | "Unknown";
    platform: string;
  };
  comfortable: Array<{ label: string; sizeGb: number; bundled: boolean }>;
  recommended: {
    modelLabel: string;
    context: number;
    kvCache: string;
    flashAttention: string;
    backend: string;
    batchSize: number;
  };
  performance: {
    memoryFit: "Safe" | "Tight" | "Risky";
    quality: "Basic" | "Good" | "High" | "Very High";
    speed: "Fast" | "Medium-fast" | "Medium" | "Slow";
  };
  caveats: string[];
}

export function buildDesktopReport(): DesktopCapabilityReport {
  const hw = readHardware();
  const caveats: string[] = [];

  let ramGb = hw.ramGb;
  let ramApproximate = false;
  if (ramGb === null) {
    ramGb = 8;
    caveats.push("Couldn't read RAM from the webview — assuming 8 GB. A future update will surface this via the native side, which can read it accurately.");
  } else if (ramGb >= 8) {
    ramApproximate = true;
    caveats.push("The webview caps reported RAM at 8 GB. Your machine may have much more — this recommendation is conservative.");
  }

  // Native processes can use far more of system RAM than a browser tab can.
  const budgetGb = ramGb * 0.7;

  // Sort fitting models by params first (larger = better quality), then by
  // quant precision as a tiebreaker (Q5 > Q4 at same params).
  const fitting = CATALOG
    .filter((m) => m.sizeGb * 1.3 <= budgetGb)
    .sort((a, b) => {
      if (b.paramsB !== a.paramsB) return b.paramsB - a.paramsB;
      return b.sizeGb - a.sizeGb;
    });

  const comfortable = fitting.slice(0, 6).map((m) => ({
    label: m.label,
    sizeGb: m.sizeGb,
    bundled: !!m.bundled,
  }));

  const top = fitting[0] ?? null;

  let memoryFit: DesktopCapabilityReport["performance"]["memoryFit"] = "Safe";
  if (!top) memoryFit = "Risky";
  else if (top.sizeGb * 1.4 > budgetGb) memoryFit = "Tight";

  // Spend remaining headroom on a larger context window and the more precise
  // KV cache type. Both materially affect long-conversation memory.
  const headroom = top ? budgetGb - top.sizeGb * 1.3 : 0;
  const context = headroom >= 4 ? 16384 : headroom >= 2 ? 8192 : 4096;
  const kvCache = headroom >= 2 ? "f16" : "q8_0";
  const batchSize = ramGb >= 16 ? 2048 : ramGb >= 8 ? 1024 : 512;

  const params = top?.paramsB ?? 0;
  const quality: DesktopCapabilityReport["performance"]["quality"] =
    params >= 13 ? "Very High" : params >= 6 ? "High" : params >= 2 ? "Good" : "Basic";
  const speed: DesktopCapabilityReport["performance"]["speed"] =
    params < 2 ? "Fast" : params < 4 ? "Medium-fast" : params < 8 ? "Medium" : "Slow";

  if (top && !top.bundled) {
    caveats.push(`The recommended model isn't bundled with this installer — only "${BUNDLED_LABEL}" is. Downloading additional GGUF variants is a planned feature.`);
  }
  caveats.push("Context, KV cache type, FlashAttention, and batch size are honest recommendations for the llama.cpp backend, but the current build only wires temperature/top-p/max-tokens through. The rest will be respected once those controls land in the Tuning panel.");

  return {
    hardware: {
      ramGb,
      ramApproximate,
      cpuThreads: hw.cpuThreads,
      platform: hw.platform,
    },
    comfortable,
    recommended: {
      modelLabel: top?.label ?? "None — your hardware is below the minimum for native inference",
      context,
      kvCache,
      flashAttention: "Auto",
      backend: "Native (llama.cpp, GPU offload when available)",
      batchSize,
    },
    performance: { memoryFit, quality, speed },
    caveats,
  };
}
