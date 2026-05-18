export interface SystemInfo {
  os: string;
  cpuCores: number | "Unknown";
  ram: number | null; // navigator.deviceMemory is capped at 8 GB for privacy
  ramIsApproximate: boolean;
  userAgent: string;
  hardwareConcurrency: number | "Unknown";
}

export interface GpuInfo {
  webgpuAvailable: boolean;
  adapterName: string | null; // browsers usually hide this for privacy
  vendor: string | null;
  architecture: string | null;
  maxBufferSizeMb: number | null;
  maxStorageBufferBindingSizeMb: number | null;
}

export function getSystemInfo(): SystemInfo {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let os = "Unknown";
  if (userAgent.indexOf("Win") !== -1) os = "Windows";
  if (userAgent.indexOf("Mac") !== -1) os = "MacOS";
  if (userAgent.indexOf("X11") !== -1) os = "UNIX";
  if (userAgent.indexOf("Linux") !== -1) os = "Linux";

  const cpuCores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : ("Unknown" as const);

  const ram =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null)
      : null;

  return {
    os,
    cpuCores,
    ram,
    // navigator.deviceMemory is intentionally coarse and capped at 8 GB.
    ramIsApproximate: true,
    userAgent,
    hardwareConcurrency: cpuCores,
  };
}

/**
 * Best-effort GPU info via the WebGPU adapter. Browsers redact most fields
 * (vendor/architecture often empty strings) for privacy. We return whatever
 * we can get and the UI marks the rest as Unknown.
 */
export async function getGpuInfo(): Promise<GpuInfo> {
  const defaults: GpuInfo = {
    webgpuAvailable: false,
    adapterName: null,
    vendor: null,
    architecture: null,
    maxBufferSizeMb: null,
    maxStorageBufferBindingSizeMb: null,
  };

  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return defaults;
  }

  // Minimal local types — full @webgpu/types isn't needed for our read-only probe.
  type AdapterInfoShape = { vendor?: string; architecture?: string; device?: string; description?: string };
  type AdapterLimitsShape = { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
  type AdapterShape = {
    info?: AdapterInfoShape;
    requestAdapterInfo?: () => Promise<AdapterInfoShape>;
    limits?: AdapterLimitsShape;
  };
  type NavigatorGpu = { requestAdapter: () => Promise<AdapterShape | null> };

  try {
    const gpu = (navigator as Navigator & { gpu: NavigatorGpu }).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ...defaults, webgpuAvailable: true };

    // `requestAdapterInfo()` is the older API; `adapter.info` is the new one. Try both.
    let info: AdapterInfoShape = {};
    if (adapter.info) {
      info = adapter.info;
    } else if (typeof adapter.requestAdapterInfo === "function") {
      try {
        info = await adapter.requestAdapterInfo();
      } catch {
        // ignore — some browsers gate this behind a flag
      }
    }

    const limits = adapter.limits ?? {};
    return {
      webgpuAvailable: true,
      adapterName: info.device || info.description || null,
      vendor: info.vendor || null,
      architecture: info.architecture || null,
      maxBufferSizeMb: limits.maxBufferSize ? Math.round(limits.maxBufferSize / (1024 * 1024)) : null,
      maxStorageBufferBindingSizeMb: limits.maxStorageBufferBindingSize
        ? Math.round(limits.maxStorageBufferBindingSize / (1024 * 1024))
        : null,
    };
  } catch {
    return { ...defaults, webgpuAvailable: true };
  }
}
