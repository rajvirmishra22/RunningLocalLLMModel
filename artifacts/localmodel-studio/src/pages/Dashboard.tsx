import { Link } from "wouter";
import { Monitor, Cpu, Zap, AlertTriangle, CheckCircle, XCircle, Plus, MessageSquare, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { getSystemInfo } from "@/services/systemInfo";
import { webllmService, WEBLLM_MODELS } from "@/services/webllmService";

const compatColors: Record<string, string> = {
  supported: "bg-green-500/10 text-green-500 border-green-500/20",
  experimental: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  unsupported: "bg-red-500/10 text-red-500 border-red-500/20",
};

export default function Dashboard() {
  const [sysInfo] = useState(() => getSystemInfo());
  const webgpuAvailable = webllmService.checkWebGPU();

  const ramGb = sysInfo.ram;
  const lowRam = ramGb !== null && ramGb < 4;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">System status and model recommendations</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/chat">
              <Button size="sm" data-testid="btn-start-chat" className="gap-2">
                <MessageSquare className="w-3.5 h-3.5" />
                Start Chat
              </Button>
            </Link>
            <Link href="/models">
              <Button size="sm" variant="outline" data-testid="btn-add-model" className="gap-2">
                <Plus className="w-3.5 h-3.5" />
                Add Model
              </Button>
            </Link>
          </div>
        </div>

        {lowRam && (
          <div data-testid="low-ram-warning" className="flex items-start gap-3 p-3.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-500">Low memory detected ({ramGb} GB)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Stick to the smallest models (1B–1.5B). Larger models may crash your browser or run very slowly.
              </p>
            </div>
          </div>
        )}

        {webgpuAvailable && (
          <div className="flex items-center gap-3 p-3.5 rounded-lg bg-green-500/10 border border-green-500/20">
            <Globe className="w-4 h-4 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-500">WebGPU detected — runs offline after first download</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Everything runs in your browser. Models download once over the internet, then run fully offline. No installs, no servers, no cloud.
              </p>
            </div>
          </div>
        )}

        {!webgpuAvailable && (
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-500">WebGPU not available</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                LocalModel Studio uses WebGPU for in-browser inference. Please use Chrome 113+ or Edge 113+ on a device with a supported GPU.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Card data-testid="card-system-info">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Monitor className="w-4 h-4 text-muted-foreground" />
                System Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <InfoRow label="OS" value={sysInfo.os} testId="system-os" />
              <InfoRow label="CPU Cores" value={String(sysInfo.cpuCores)} testId="system-cpu" />
              <InfoRow label="RAM" value={sysInfo.ram ? `~${sysInfo.ram} GB` : "Unknown"} testId="system-ram" />
              <InfoRow label="WebGPU" value={webgpuAvailable ? "Available" : "Not available"} testId="system-webgpu" />
            </CardContent>
          </Card>

          <Card data-testid="card-runtime-status">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="w-4 h-4 text-muted-foreground" />
                Runtime Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-2">
                  {webgpuAvailable ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  <span className="text-xs font-medium">In-Browser Inference</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {webgpuAvailable ? "Ready" : "No WebGPU"}
                </span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-xs font-medium">Local Storage</span>
                </div>
                <span className="text-[10px] text-muted-foreground">Active</span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-xs font-medium">Privacy Mode</span>
                </div>
                <span className="text-[10px] text-muted-foreground">No telemetry</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-muted-foreground" />
            Recommended Models
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {WEBLLM_MODELS.map((model) => (
              <ModelCard key={model.id} model={model} ramGb={ramGb} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium font-mono" data-testid={testId}>{value}</span>
    </div>
  );
}

function ModelCard({ model, ramGb }: { model: typeof WEBLLM_MODELS[0]; ramGb: number | null }) {
  const tooLarge = ramGb !== null && model.minRamGb > ramGb;
  const compat: "supported" | "experimental" = model.sizeMb >= 4000 ? "experimental" : "supported";
  return (
    <div
      data-testid={`model-card-${model.label.replace(/\s/g, "-")}`}
      className={`p-3 rounded-lg border bg-card ${tooLarge ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Globe className="w-3 h-3 text-green-500 flex-shrink-0" />
            <span className="text-xs font-semibold font-mono text-foreground truncate">{model.label}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">{model.description}</div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] font-mono text-muted-foreground">{(model.sizeMb / 1000).toFixed(1)} GB</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${compatColors[compat]}`}>
            {compat}
          </span>
        </div>
      </div>
    </div>
  );
}
