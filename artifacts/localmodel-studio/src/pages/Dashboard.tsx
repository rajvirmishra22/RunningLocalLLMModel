import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Monitor, Cpu, Zap, AlertTriangle, CheckCircle, XCircle, Loader2, Plus, MessageSquare, RefreshCw, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ollamaService } from "@/services/ollamaService";
import { storageService } from "@/services/storageService";
import { getSystemInfo } from "@/services/systemInfo";
import { webllmService } from "@/services/webllmService";

const RECOMMENDED_MODELS = [
  { name: "Llama 3.2 1B", id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", size: "0.7 GB", desc: "Smallest browser model. Runs on anything.", compat: "supported" as const, runtime: "webllm", minRam: 2 },
  { name: "Llama 3.2 3B", id: "Llama-3.2-3B-Instruct-q4f32_1-MLC", size: "1.8 GB", desc: "Solid quality, fast browser inference.", compat: "supported" as const, runtime: "webllm", minRam: 4 },
  { name: "Qwen 2.5 1.5B", id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", size: "1.0 GB", desc: "Compact, strong at instruction following.", compat: "supported" as const, runtime: "webllm", minRam: 3 },
  { name: "Phi 3.5 Mini", id: "Phi-3.5-mini-instruct-q4f16_1-MLC", size: "2.2 GB", desc: "Microsoft's efficient small model.", compat: "supported" as const, runtime: "webllm", minRam: 4 },
  { name: "llama3.2:1b", id: "llama3.2:1b", size: "1.3 GB", desc: "Tiny Ollama model. Great for testing.", compat: "supported" as const, runtime: "ollama", minRam: 4 },
  { name: "llama3.2:3b", id: "llama3.2:3b", size: "2.0 GB", desc: "Fast Ollama model, good quality.", compat: "supported" as const, runtime: "ollama", minRam: 6 },
  { name: "Mistral 7B", id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", size: "4.0 GB", desc: "Powerful browser model. Needs a capable GPU.", compat: "experimental" as const, runtime: "webllm", minRam: 6 },
  { name: "Llama 3.1 8B", id: "Llama-3.1-8B-Instruct-q4f32_1-MLC", size: "4.7 GB", desc: "Flagship quality in the browser.", compat: "experimental" as const, runtime: "webllm", minRam: 6 },
];

const compatColors: Record<string, string> = {
  supported: "bg-green-500/10 text-green-500 border-green-500/20",
  experimental: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  unsupported: "bg-red-500/10 text-red-500 border-red-500/20",
};

export default function Dashboard() {
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "online" | "offline">("checking");
  const [sysInfo] = useState(() => getSystemInfo());
  const [settings] = useState(() => storageService.getSettings());
  const webgpuAvailable = webllmService.checkWebGPU();

  const checkOllama = async () => {
    setOllamaStatus("checking");
    const ok = await ollamaService.checkOllamaStatus(settings.ollamaUrl);
    setOllamaStatus(ok ? "online" : "offline");
  };

  useEffect(() => {
    checkOllama();
  }, []);

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

        {/* WebGPU highlight banner */}
        {webgpuAvailable && (
          <div className="flex items-center gap-3 p-3.5 rounded-lg bg-green-500/10 border border-green-500/20">
            <Globe className="w-4 h-4 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-500">WebGPU detected — runs offline after first download</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Models download once over the internet, then run fully offline — no Ollama, no installs, no cloud.
              </p>
            </div>
          </div>
        )}

        {!webgpuAvailable && (
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-muted/50 border border-border">
            <AlertTriangle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">WebGPU not available</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Browser-native inference requires Chrome 113+ or Edge 113+. You can still use Ollama for local inference.
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
              <RuntimeRow
                name="WebLLM (Browser)"
                status={webgpuAvailable ? "online" : "offline"}
                note={webgpuAvailable ? "Ready" : "No WebGPU"}
              />
              <RuntimeRow
                name="Ollama"
                status={ollamaStatus}
                url={settings.ollamaUrl}
                onRefresh={checkOllama}
              />
              <RuntimeRow
                name="llama-server"
                status="offline"
                url={settings.llamaServerUrl}
                note="Manual start required"
              />
            </CardContent>
          </Card>
        </div>

        {ollamaStatus === "offline" && (
          <div data-testid="ollama-setup-instructions" className="p-4 rounded-lg bg-card border border-border">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Ollama isn't running</span>
              <span className="text-xs text-muted-foreground">(optional — you can use in-browser models instead)</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              To use Ollama, install it and run these commands:
            </p>
            <div className="space-y-1.5">
              <CodeBlock code="# Install Ollama from https://ollama.com" />
              <CodeBlock code="OLLAMA_ORIGINS=* ollama serve" />
              <CodeBlock code="ollama pull llama3.2:1b" />
            </div>
          </div>
        )}

        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-muted-foreground" />
            Recommended Models
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {RECOMMENDED_MODELS.map((model) => (
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

function RuntimeRow({
  name,
  status,
  url,
  note,
  onRefresh,
}: {
  name: string;
  status: "checking" | "online" | "offline";
  url?: string;
  note?: string;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <div className="flex items-center gap-2">
        {status === "checking" ? (
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
        ) : status === "online" ? (
          <CheckCircle className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {note && <span className="text-[10px] text-muted-foreground">{note}</span>}
        {url && status !== "checking" && (
          <span className="text-[10px] font-mono text-muted-foreground hidden sm:block truncate max-w-24">
            {url.replace("http://", "")}
          </span>
        )}
        {onRefresh && (
          <button onClick={onRefresh} className="p-0.5 rounded hover:bg-muted transition-colors" data-testid="btn-refresh-ollama">
            <RefreshCw className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="text-[11px] font-mono bg-muted px-3 py-2 rounded text-foreground overflow-x-auto">{code}</pre>
  );
}

function ModelCard({ model, ramGb }: { model: typeof RECOMMENDED_MODELS[0]; ramGb: number | null }) {
  const tooLarge = ramGb !== null && model.minRam > ramGb;
  return (
    <div
      data-testid={`model-card-${model.name.replace(/\s/g, "-")}`}
      className={`p-3 rounded-lg border bg-card ${tooLarge ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {model.runtime === "webllm" && <Globe className="w-3 h-3 text-green-500 flex-shrink-0" />}
            <span className="text-xs font-semibold font-mono text-foreground truncate">{model.name}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">{model.desc}</div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] font-mono text-muted-foreground">{model.size}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${compatColors[model.compat]}`}>
            {model.compat}
          </span>
        </div>
      </div>
    </div>
  );
}
