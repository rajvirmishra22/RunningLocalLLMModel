import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Monitor, Cpu, MemoryStick, Zap, AlertTriangle, CheckCircle, XCircle, Loader2, Plus, MessageSquare, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ollamaService } from "@/services/ollamaService";
import { storageService } from "@/services/storageService";
import { getSystemInfo } from "@/services/systemInfo";

const RECOMMENDED_MODELS = [
  { name: "llama3.2:1b", size: "1.3 GB", desc: "Tiny, runs on anything. Great for testing.", compat: "supported" as const, minRam: 4 },
  { name: "llama3.2:3b", size: "2.0 GB", desc: "Solid balance of speed and quality.", compat: "supported" as const, minRam: 6 },
  { name: "qwen2.5:3b", size: "2.0 GB", desc: "Strong at coding and reasoning tasks.", compat: "supported" as const, minRam: 6 },
  { name: "phi3.5:mini", size: "2.2 GB", desc: "Microsoft's efficient small model.", compat: "supported" as const, minRam: 6 },
  { name: "mistral:7b", size: "4.1 GB", desc: "Fast 7B model, good all-around.", compat: "supported" as const, minRam: 8 },
  { name: "llama3.1:8b", size: "4.7 GB", desc: "Meta's flagship 8B. Excellent quality.", compat: "supported" as const, minRam: 10 },
  { name: "deepseek-r1:8b", size: "4.9 GB", desc: "Strong reasoning model.", compat: "experimental" as const, minRam: 10 },
  { name: "llama3.3:70b", size: "43 GB", desc: "Flagship quality, requires high-end hardware.", compat: "supported" as const, minRam: 48 },
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

  const checkOllama = async () => {
    setOllamaStatus("checking");
    const ok = await ollamaService.checkOllamaStatus(settings.ollamaUrl);
    setOllamaStatus(ok ? "online" : "offline");
  };

  useEffect(() => {
    checkOllama();
  }, []);

  const ramGb = sysInfo.ram;
  const lowRam = ramGb !== null && ramGb < 8;

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
          <div
            data-testid="low-ram-warning"
            className="flex items-start gap-3 p-3.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20"
          >
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-500">Low memory detected ({ramGb} GB)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your device may struggle with models larger than 2 GB. Stick to 1B–3B parameter models for best results.
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
              <InfoRow
                label="RAM"
                value={sysInfo.ram ? `~${sysInfo.ram} GB` : "Unknown"}
                testId="system-ram"
              />
              <InfoRow label="GPU" value="Browser limited" testId="system-gpu" />
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
              <RuntimeRow
                name="Transformers.js"
                status="offline"
                note="WebGPU optional"
              />
            </CardContent>
          </Card>
        </div>

        {ollamaStatus === "offline" && (
          <div
            data-testid="ollama-setup-instructions"
            className="p-4 rounded-lg bg-card border border-border"
          >
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-destructive" />
              <span className="text-sm font-medium">Ollama isn't running</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Ollama needs to be installed and running for inference. Run these commands in your terminal:
            </p>
            <div className="space-y-1.5">
              <CodeBlock code="# Install Ollama from https://ollama.com" />
              <CodeBlock code="ollama serve" />
              <CodeBlock code="ollama pull llama3.2:1b" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Also set{" "}
              <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">OLLAMA_ORIGINS=*</code>
              {" "}to allow browser connections.
            </p>
          </div>
        )}

        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-muted-foreground" />
            Recommended Models
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {RECOMMENDED_MODELS.map((model) => (
              <ModelCard key={model.name} model={model} ramGb={ramGb} />
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
          <span className="text-[10px] font-mono text-muted-foreground hidden sm:block truncate max-w-24">{url.replace("http://", "")}</span>
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
    <pre className="text-[11px] font-mono bg-muted px-3 py-2 rounded text-foreground overflow-x-auto">
      {code}
    </pre>
  );
}

function ModelCard({ model, ramGb }: { model: typeof RECOMMENDED_MODELS[0]; ramGb: number | null }) {
  const tooLarge = ramGb !== null && model.minRam > ramGb;
  return (
    <div
      data-testid={`model-card-${model.name}`}
      className={`p-3 rounded-lg border bg-card ${tooLarge ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold font-mono text-foreground truncate">{model.name}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{model.desc}</div>
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
