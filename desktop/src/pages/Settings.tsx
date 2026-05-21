import { useState } from "react";
import { Trash2, Shield, Info, HardDrive, Cloud, Eye, EyeOff, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { webllmService } from "@/services/webllmService";
import {
  loadCloudConfig,
  saveCloudConfig,
  clearCloudConfig,
  testProviderKey,
  OPENAI_MODEL_PRESETS,
  ANTHROPIC_MODEL_PRESETS,
  type CloudProvider,
  type CloudProviderConfig,
} from "@/services/cloudProviders";

export default function Settings() {
  const [modelUnloaded, setModelUnloaded] = useState(false);
  const [cloudCfg, setCloudCfg] = useState<CloudProviderConfig>(() => loadCloudConfig());
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const clearConversations = () => {
    localStorage.removeItem("lms_conversations");
  };

  const clearProfiles = () => {
    localStorage.removeItem("lms_model_profiles");
  };

  const unloadModel = () => {
    webllmService.unload();
    setModelUnloaded(true);
    setTimeout(() => setModelUnloaded(false), 2000);
  };

  const updateCfg = (next: CloudProviderConfig) => {
    setCloudCfg(next);
    saveCloudConfig(next);
    setSavedNote("Saved");
    setTimeout(() => setSavedNote(null), 1500);
  };

  const clearAllKeys = () => {
    clearCloudConfig();
    setCloudCfg(loadCloudConfig());
    setSavedNote("Cleared all cloud keys");
    setTimeout(() => setSavedNote(null), 1500);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">App preferences and data management</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Privacy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3 p-3 rounded-md bg-green-500/10 border border-green-500/20">
              <Shield className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-green-500">Local-first by default</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Conversations, model profiles, and model files are stored locally on your machine. When you
                  chat with a local model, nothing leaves your device. If you opt into a cloud provider below,
                  messages for <em>that</em> provider are sent to OpenAI or Anthropic — every other local model
                  conversation still stays on your machine.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-cloud-providers">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cloud className="w-4 h-4" />
              Cloud Providers (Optional)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="text-xs text-muted-foreground space-y-1.5">
              <p>
                Bring your own API key from OpenAI or Anthropic to use their cloud models alongside local. Keys are
                stored only in this browser, in <code className="text-[10px] bg-muted px-1 py-0.5 rounded">localStorage</code>.
              </p>
              <p className="text-amber-500/90">
                <strong>Heads up:</strong> A ChatGPT Plus or Claude Pro subscription does <em>not</em> give third-party
                apps access. Only a developer API key (billed per token) works. Get one at{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground inline-flex items-center gap-0.5"
                >
                  platform.openai.com <ExternalLink className="w-2.5 h-2.5" />
                </a>{" "}
                or{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground inline-flex items-center gap-0.5"
                >
                  console.anthropic.com <ExternalLink className="w-2.5 h-2.5" />
                </a>.
              </p>
            </div>

            <ProviderRow
              provider="openai"
              label="OpenAI"
              cfg={cloudCfg}
              onChange={updateCfg}
              presets={OPENAI_MODEL_PRESETS}
            />
            <Separator />
            <ProviderRow
              provider="anthropic"
              label="Anthropic (Claude)"
              cfg={cloudCfg}
              onChange={updateCfg}
              presets={ANTHROPIC_MODEL_PRESETS}
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-muted-foreground h-4">{savedNote}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={clearAllKeys}
                className="gap-1.5 text-destructive hover:text-destructive hover:border-destructive/50"
                data-testid="btn-clear-cloud-keys"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove all cloud keys
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Data Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Conversations</p>
                <p className="text-xs text-muted-foreground">Delete all saved chat history</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={clearConversations}
                className="gap-1.5 text-destructive hover:text-destructive hover:border-destructive/50"
                data-testid="btn-clear-conversations"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Model Profiles</p>
                <p className="text-xs text-muted-foreground">Delete all saved model configurations</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={clearProfiles}
                className="gap-1.5 text-destructive hover:text-destructive hover:border-destructive/50"
                data-testid="btn-clear-profiles"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Unload Active Model</p>
                <p className="text-xs text-muted-foreground">
                  Free up GPU/RAM. Model stays cached and can be reloaded instantly.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={unloadModel}
                className="gap-1.5"
                data-testid="btn-unload-model"
              >
                <HardDrive className="w-3.5 h-3.5" />
                {modelUnloaded ? "Unloaded" : "Unload"}
              </Button>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border">
              <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Model files are stored in the LocalModel Studio app data folder. To free disk space, uninstall
                the app or delete downloaded models from this Models page.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end">
          <p className="text-xs text-muted-foreground">LocalModel Studio v0.1.0</p>
        </div>
      </div>
    </div>
  );
}

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok" }
  | { state: "fail"; message: string };

function ProviderRow({
  provider,
  label,
  cfg,
  onChange,
  presets,
}: {
  provider: CloudProvider;
  label: string;
  cfg: CloudProviderConfig;
  onChange: (next: CloudProviderConfig) => void;
  presets: Array<{ id: string; label: string; note?: string }>;
}) {
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<TestStatus>({ state: "idle" });

  const keyField = provider === "openai" ? "openaiKey" : "anthropicKey";
  const modelField = provider === "openai" ? "openaiModel" : "anthropicModel";
  const key = cfg[keyField];
  const model = cfg[modelField];

  const setKey = (v: string) => {
    onChange({ ...cfg, [keyField]: v });
    setStatus({ state: "idle" });
  };
  const setModel = (v: string) => onChange({ ...cfg, [modelField]: v });

  const test = async () => {
    setStatus({ state: "testing" });
    const result = await testProviderKey(provider, key, model);
    if (result.ok) setStatus({ state: "ok" });
    else setStatus({ state: "fail", message: result.error });
  };

  return (
    <div className="space-y-2.5" data-testid={`provider-row-${provider}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        {key.trim().length > 0 ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
            Key set
          </span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
            Not configured
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">API Key</Label>
          <Input
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
            className="h-8 text-xs font-mono"
            data-testid={`input-${provider}-key`}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowKey((s) => !s)}
          className="h-8 px-2"
          title={showKey ? "Hide key" : "Show key"}
          data-testid={`btn-${provider}-toggle-visibility`}
        >
          {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={test}
          disabled={!key.trim() || status.state === "testing"}
          className="h-8 gap-1.5"
          data-testid={`btn-${provider}-test`}
        >
          {status.state === "testing" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : status.state === "ok" ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
          ) : status.state === "fail" ? (
            <XCircle className="w-3.5 h-3.5 text-destructive" />
          ) : null}
          Test
        </Button>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Model</Label>
        <div className="flex gap-2">
          <Input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model-id"
            className="h-8 text-xs font-mono flex-1"
            data-testid={`input-${provider}-model`}
            spellCheck={false}
          />
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setModel(e.target.value);
            }}
            className="h-8 text-xs bg-background border border-border rounded px-2"
            data-testid={`select-${provider}-preset`}
          >
            <option value="">Pick preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Type any model ID exposed by the provider. The dropdown is just shortcuts.
        </p>
      </div>

      {status.state === "fail" && (
        <p className="text-[11px] text-destructive" data-testid={`error-${provider}`}>
          {status.message}
        </p>
      )}
      {status.state === "ok" && (
        <p className="text-[11px] text-green-500" data-testid={`ok-${provider}`}>
          Key works.
        </p>
      )}
    </div>
  );
}
