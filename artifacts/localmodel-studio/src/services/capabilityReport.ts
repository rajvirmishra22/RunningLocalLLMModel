/**
 * Hardware → "what can I run" report.
 *
 * Used by the Dashboard's "What can I run?" popup. Deliberately separate from
 * optimizationEngine.ts because that one is tied to the user's saved profiles
 * and answers "which of these models should I be using"; this one answers a
 * lighter, more exploratory question against the full WebLLM catalog.
 *
 * The report is intentionally honest about the browser's blind spots:
 *   - navigator.deviceMemory is capped at 8 GB for privacy, so machines with
 *     more RAM look identical to 8 GB machines here. We flag that.
 *   - The in-browser engine (WebLLM) doesn't expose KV cache quantization,
 *     FlashAttention, or batch size — those are runtime-internal and not
 *     user-tunable. We say so in the report rather than inventing knobs.
 */

import { WEBLLM_MODELS } from "./webllmService";

export interface SystemProbe {
  /** Reported by navigator.deviceMemory (gigabytes). Null when the browser
   *  doesn't expose it (e.g. Safari, Firefox). */
  ramGb: number | null;
  /** True when ramGb is the browser's privacy cap (8). Actual RAM may be
   *  much higher; the recommendation will under-report in that case. */
  ramApproximate: boolean;
  cpuThreads: number | null;
  webgpuAvailable: boolean;
  /** Best-effort GPU label from the WebGPU adapter. Often empty/redacted. */
  gpuLabel: string | null;
}

export interface CapabilityReport {
  hardware: SystemProbe & { ramGb: number };
  comfortableModels: Array<{ label: string; sizeGb: number }>;
  recommended: {
    modelLabel: string;
    modelId: string;
    context: number;
    kvCache: string;
    flashAttention: string;
    backend: string;
    batchSize: string;
  };
  performance: {
    memoryFit: "Safe" | "Tight" | "Risky" | "N/A";
    quality: "Basic" | "Good" | "High" | "Very High" | "N/A";
    speed: "Fast" | "Medium-fast" | "Medium" | "Slow" | "N/A";
  };
  caveats: string[];
}

/** Returned when WebGPU is missing or nothing in the catalog fits — every
 *  downstream field is explicitly "nothing runnable" instead of pretending a
 *  zero-sized model would run fast and basic-quality. */
const UNAVAILABLE_RECOMMENDATION = {
  modelLabel: "None — no model can run in this browser",
  modelId: "",
  context: 0,
  kvCache: "N/A",
  flashAttention: "N/A",
  backend: "Unavailable",
  batchSize: "N/A",
} as const;

/** Reads everything the browser will tell us about the host. WebGPU adapter
 *  probe is async, so this function is async too. */
export async function probeBrowser(): Promise<SystemProbe> {
  const nav =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & {
          deviceMemory?: number;
          gpu?: { requestAdapter?: () => Promise<unknown> };
        })
      : null;

  const rawRam = nav && typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
  const ramApproximate = rawRam !== null && rawRam >= 8;
  const cpuThreads = nav && typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null;

  let webgpuAvailable = false;
  let gpuLabel: string | null = null;
  if (nav?.gpu?.requestAdapter) {
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) {
        webgpuAvailable = true;
        const info = (
          adapter as { info?: { vendor?: string; architecture?: string; description?: string } }
        ).info;
        if (info) {
          const bits = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ").trim();
          gpuLabel = bits.length > 0 ? bits : null;
        }
      }
    } catch {
      // ignore — leave webgpuAvailable false
    }
  }

  return { ramGb: rawRam, ramApproximate, cpuThreads, webgpuAvailable, gpuLabel };
}

export function buildWebReport(probe: SystemProbe): CapabilityReport {
  const caveats: string[] = [];

  let ramGb = probe.ramGb;
  if (ramGb === null) {
    ramGb = 8;
    caveats.push("Your browser doesn't expose RAM size. Assuming 8 GB — adjust expectations if your machine is smaller or much larger.");
  } else if (probe.ramApproximate) {
    caveats.push("Browsers cap RAM reporting at 8 GB for privacy. If your machine has more, you may be able to run larger models than shown here.");
  }
  if (!probe.webgpuAvailable) {
    caveats.push("WebGPU isn't available, so the in-browser engine can't run anything. Use Chrome/Edge 113+ on a supported GPU — or use the desktop build.");
    // Short-circuit: with no WebGPU there's no point recommending models,
    // because none of them will actually load in this browser.
    return {
      hardware: { ...probe, ramGb },
      comfortableModels: [],
      recommended: UNAVAILABLE_RECOMMENDATION,
      performance: { memoryFit: "N/A", quality: "N/A", speed: "N/A" },
      caveats,
    };
  }

  // Each tab gets only a fraction of system RAM in practice — Chrome currently
  // enforces a process memory ceiling, and IndexedDB caching for weights eats
  // into that further. 0.5x is a deliberately conservative budget.
  const budgetGb = ramGb * 0.5;

  const fitting = WEBLLM_MODELS
    .map((m) => ({ id: m.id, label: m.label, sizeGb: m.sizeMb / 1024 }))
    .filter((m) => m.sizeGb * 1.3 <= budgetGb)
    .sort((a, b) => b.sizeGb - a.sizeGb);

  // Recommend the largest model that fits with margin, falling back to the
  // largest that just fits if nothing has margin.
  const top = fitting.find((m) => m.sizeGb * 1.5 <= budgetGb) ?? fitting[0] ?? null;

  if (!top) {
    caveats.push("Nothing in the WebLLM catalog fits comfortably in your browser memory budget. The desktop build has more headroom.");
    return {
      hardware: { ...probe, ramGb },
      comfortableModels: [],
      recommended: {
        ...UNAVAILABLE_RECOMMENDATION,
        modelLabel: "None — your hardware is below the minimum for browser inference",
      },
      performance: { memoryFit: "Risky", quality: "N/A", speed: "N/A" },
      caveats,
    };
  }

  const comfortableModels = fitting.slice(0, 5).map((m) => ({ label: m.label, sizeGb: m.sizeGb }));

  const memoryFit: CapabilityReport["performance"]["memoryFit"] =
    top.sizeGb * 1.4 > budgetGb ? "Tight" : "Safe";

  const sz = top.sizeGb;
  const quality: CapabilityReport["performance"]["quality"] =
    sz >= 4 ? "Very High" : sz >= 2.5 ? "High" : sz >= 1.2 ? "Good" : "Basic";
  const speed: CapabilityReport["performance"]["speed"] =
    sz < 1 ? "Fast" : sz < 2 ? "Medium-fast" : sz < 4 ? "Medium" : "Slow";

  return {
    hardware: { ...probe, ramGb },
    comfortableModels,
    recommended: {
      modelLabel: top.label,
      modelId: top.id,
      context: 4096,
      kvCache: "Not configurable in browser",
      flashAttention: "Not configurable in browser",
      backend: "WebGPU (in-browser)",
      batchSize: "Managed by WebLLM",
    },
    performance: { memoryFit, quality, speed },
    caveats,
  };
}
