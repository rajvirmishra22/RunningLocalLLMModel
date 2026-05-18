interface GPUAdapter {
  readonly name?: string;
  readonly info?: { vendor?: string; architecture?: string; device?: string; description?: string };
}

interface GPU {
  requestAdapter(options?: { powerPreference?: "low-power" | "high-performance" }): Promise<GPUAdapter | null>;
}

interface Navigator {
  readonly gpu?: GPU;
}
