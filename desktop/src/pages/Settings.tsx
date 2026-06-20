import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Trash2, Shield, Info, HardDrive, Cloud, Eye, EyeOff, CheckCircle2, XCircle, Loader2, ExternalLink, HelpCircle, ChevronDown, ImageIcon, Sparkles, Library, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import { webllmService, isCustomCatalogSupported } from "@/services/webllmService";
import { getAvailableModelGroups } from "@/services/studycore/aiRunner";
import * as courseLibrary from "@/services/studycore/courseLibrary";
import { storageSummary, formatBytes } from "@/services/studycore/privacy";
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

const AI_PREFS_KEY = "sc_ai_prefs";

interface AiPrefs {
  defaultModelKey: string | null;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_AI_PREFS: AiPrefs = {
  defaultModelKey: null,
  temperature: 0.7,
  maxTokens: 2048,
};

const RESPONSE_LENGTHS: Array<{ value: number; label: string }> = [
  { value: 1024, label: "Short (~750 words)" },
  { value: 2048, label: "Medium (~1,500 words)" },
  { value: 4096, label: "Long (~3,000 words)" },
];

function loadAiPrefs(): AiPrefs {
  try {
    const raw = localStorage.getItem(AI_PREFS_KEY);
    if (!raw) return { ...DEFAULT_AI_PREFS };
    return { ...DEFAULT_AI_PREFS, ...(JSON.parse(raw) as Partial<AiPrefs>) };
  } catch {
    return { ...DEFAULT_AI_PREFS };
  }
}

function saveAiPrefs(p: AiPrefs): void {
  localStorage.setItem(AI_PREFS_KEY, JSON.stringify(p));
}

type MtmdStatus = { installed: boolean; path: string; binDir: string };
type MtmdInstallState =
  | { state: "idle" }
  | { state: "installing" }
  | { state: "ok"; path: string }
  | { state: "error"; message: string };

export default function Settings() {
  const [modelUnloaded, setModelUnloaded] = useState(false);
  const [cloudCfg, setCloudCfg] = useState<CloudProviderConfig>(() => loadCloudConfig());
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [aiPrefs, setAiPrefs] = useState<AiPrefs>(() => loadAiPrefs());
  const [kbEnabled, setKbEnabled] = useState<boolean>(() => courseLibrary.isEnabled());
  const [summary] = useState(() => storageSummary());
  const modelGroups = getAvailableModelGroups();
  const isDesktop = isCustomCatalogSupported();

  const updateAiPrefs = (next: AiPrefs) => {
    setAiPrefs(next);
    saveAiPrefs(next);
    setSavedNote("Saved");
    setTimeout(() => setSavedNote(null), 1500);
  };

  const toggleKb = (enabled: boolean) => {
    if (enabled) courseLibrary.enable();
    else courseLibrary.disable();
    setKbEnabled(courseLibrary.isEnabled());
  };
  const [mtmdStatus, setMtmdStatus] = useState<MtmdStatus | null>(null);
  const [mtmdSrc, setMtmdSrc] = useState("");
  const [mtmdInstall, setMtmdInstall] = useState<MtmdInstallState>({ state: "idle" });

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    (async () => {
      try {
        // @ts-ignore — desktop-only module; gated by isDesktop above
        const { invoke } = (await import("@tauri-apps/api/core")) as { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
        const s = await invoke<MtmdStatus>("mtmd_status");
        if (!cancelled) setMtmdStatus(s);
      } catch {
        if (!cancelled) setMtmdStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  const refreshMtmd = async () => {
    try {
      // @ts-ignore — desktop-only module; gated by isDesktop above
        const { invoke } = (await import("@tauri-apps/api/core")) as { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
      const s = await invoke<MtmdStatus>("mtmd_status");
      setMtmdStatus(s);
    } catch {
      // ignore
    }
  };

  const installMtmd = async () => {
    const path = mtmdSrc.trim();
    if (!path) {
      setMtmdInstall({ state: "error", message: "Paste the full path to the extracted llama-mtmd-cli binary." });
      return;
    }
    setMtmdInstall({ state: "installing" });
    try {
      // @ts-ignore — desktop-only module; gated by isDesktop above
        const { invoke } = (await import("@tauri-apps/api/core")) as { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
      const installedAt = await invoke<string>("install_mtmd_cli", { sourcePath: path });
      setMtmdInstall({ state: "ok", path: installedAt });
      setMtmdSrc("");
      await refreshMtmd();
    } catch (e) {
      setMtmdInstall({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const uninstallMtmd = async () => {
    try {
      // @ts-ignore — desktop-only module; gated by isDesktop above
        const { invoke } = (await import("@tauri-apps/api/core")) as { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
      await invoke("uninstall_mtmd_cli");
      setMtmdInstall({ state: "idle" });
      await refreshMtmd();
    } catch (e) {
      setMtmdInstall({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

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
                  Conversations, model profiles, and downloaded weights are stored locally{isDesktop ? " on your device" : " in your browser"}. When you
                  chat with a local model, nothing leaves your device. If you opt into a cloud provider below,
                  messages for <em>that</em> provider are sent to OpenAI or Anthropic — every other local model
                  conversation still stays on your machine.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ai-preferences">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              AI Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-xs text-muted-foreground">
              Defaults used across StudyCore AI features (assignment help, rubric checks,
              growth summaries). You can always change the model for an individual request.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="default-model" className="text-xs">Default model</Label>
              <select
                id="default-model"
                value={aiPrefs.defaultModelKey ?? ""}
                onChange={(e) =>
                  updateAiPrefs({ ...aiPrefs, defaultModelKey: e.target.value || null })
                }
                className="w-full h-9 text-sm bg-background border border-border rounded px-2"
                data-testid="select-default-model"
              >
                <option value="">Recommended (auto-pick local)</option>
                {modelGroups.map((g) => (
                  <optgroup
                    key={`${g.kind}-${g.provider ?? "local"}`}
                    label={g.label}
                  >
                    {g.models.map((m) => {
                      const key =
                        g.kind === "local"
                          ? `local::${m.id}`
                          : `cloud::${g.provider}::${m.id}`;
                      return (
                        <option key={key} value={key}>
                          {m.label}
                          {m.note ? ` — ${m.note}` : ""}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Cloud models still require a per-request confirmation before anything leaves your device.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Default temperature</Label>
                <span className="text-xs font-mono text-muted-foreground" data-testid="text-temperature-value">
                  {aiPrefs.temperature.toFixed(1)}
                </span>
              </div>
              <Slider
                value={[aiPrefs.temperature]}
                min={0}
                max={2}
                step={0.1}
                onValueChange={(v) =>
                  updateAiPrefs({ ...aiPrefs, temperature: v[0] ?? DEFAULT_AI_PREFS.temperature })
                }
                data-testid="slider-temperature"
              />
              <p className="text-[10px] text-muted-foreground">
                Lower is more focused and factual; higher is more creative.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="default-length" className="text-xs">Default response length</Label>
              <select
                id="default-length"
                value={aiPrefs.maxTokens}
                onChange={(e) =>
                  updateAiPrefs({ ...aiPrefs, maxTokens: Number(e.target.value) })
                }
                className="w-full h-9 text-sm bg-background border border-border rounded px-2"
                data-testid="select-default-length"
              >
                {RESPONSE_LENGTHS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-course-knowledge-base">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Library className="w-4 h-4" />
              Course Knowledge Base
              <PrivacyBadge kind="local_only" size="sm" className="ml-1" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Index my course materials locally</p>
                <p className="text-xs text-muted-foreground">
                  When on, your uploaded materials are indexed <strong>on this device</strong> so
                  AI help can cite them. It's off by default and nothing is ever uploaded — the
                  index lives only in your browser{isDesktop ? "/on your device" : ""}.
                </p>
              </div>
              <Switch
                checked={kbEnabled}
                onCheckedChange={toggleKb}
                data-testid="switch-course-knowledge-base"
              />
            </div>
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border">
              <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Manage which materials are indexed from the{" "}
                <Link href="/library" className="text-primary hover:underline" data-testid="link-course-library">
                  Course Library
                </Link>{" "}
                page. Turning this off here disables the knowledge base.
              </p>
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
                apps access. Only a developer API key (billed per token) works — see the "How do I get a key?" link under
                each provider below.
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

        {isDesktop && (
          <Card data-testid="card-local-vision">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Local Vision Helper (Optional)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p>
                  Running open-source vision models (Llama 3.2 Vision, MiniCPM-V, LLaVA, Moondream, etc.) on your own
                  hardware needs llama.cpp's <code className="text-[10px] bg-muted px-1 py-0.5 rounded">llama-mtmd-cli</code>
                  {" "}helper. It's a small executable that's not bundled with the installer — you grab it once and
                  point us at it.
                </p>
                <ol className="list-decimal list-inside space-y-0.5 pl-1">
                  <li>
                    Download the prebuilt llama.cpp release for your OS from
                    {" "}
                    <a
                      href="https://github.com/ggml-org/llama.cpp/releases"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      github.com/ggml-org/llama.cpp/releases
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    {" "}(pick the archive for your platform — e.g. <code className="text-[10px] bg-muted px-1 py-0.5 rounded">llama-*-bin-win-*-x64.zip</code> on Windows).
                  </li>
                  <li>Extract it anywhere.</li>
                  <li>
                    Paste the full path to <code className="text-[10px] bg-muted px-1 py-0.5 rounded">llama-mtmd-cli</code>
                    {" "}(or <code className="text-[10px] bg-muted px-1 py-0.5 rounded">llama-mtmd-cli.exe</code> on Windows) below and click Install.
                  </li>
                </ol>
                <p className="text-[11px] text-muted-foreground/80">
                  On Windows we also copy any <code className="text-[10px] bg-muted px-1 py-0.5 rounded">.dll</code> files
                  sitting next to it (ggml.dll, llama.dll, …) so the binary is actually loadable. Cloud vision models
                  don't need this — only local mmproj-based models do.
                </p>
              </div>

              {mtmdStatus?.installed ? (
                <div className="flex items-start gap-2 p-3 rounded-md bg-green-500/10 border border-green-500/20">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-green-500">Vision helper is installed</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate" title={mtmdStatus.path}>
                      {mtmdStatus.path}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={uninstallMtmd}
                    className="gap-1.5 text-destructive hover:text-destructive hover:border-destructive/50"
                    data-testid="btn-uninstall-mtmd"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="mtmd-src" className="text-xs">
                    Path to <code className="text-[10px] bg-muted px-1 py-0.5 rounded">llama-mtmd-cli</code>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="mtmd-src"
                      value={mtmdSrc}
                      onChange={(e) => setMtmdSrc(e.target.value)}
                      placeholder={
                        navigator.platform.toLowerCase().includes("win")
                          ? "C:\\Users\\you\\llama.cpp\\llama-mtmd-cli.exe"
                          : "/Users/you/llama.cpp/llama-mtmd-cli"
                      }
                      className="font-mono text-xs"
                      data-testid="input-mtmd-src"
                    />
                    <Button
                      size="sm"
                      onClick={installMtmd}
                      disabled={mtmdInstall.state === "installing" || !mtmdSrc.trim()}
                      className="gap-1.5"
                      data-testid="btn-install-mtmd"
                    >
                      {mtmdInstall.state === "installing" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : null}
                      Install
                    </Button>
                  </div>
                  {mtmdInstall.state === "error" && (
                    <div className="flex items-start gap-2 text-[11px] text-destructive">
                      <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>{mtmdInstall.message}</span>
                    </div>
                  )}
                  {mtmdStatus && (
                    <p className="text-[11px] text-muted-foreground">
                      Will be installed to: <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{mtmdStatus.path}</code>
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
                {isDesktop
                  ? "Downloaded model files are stored on disk. Manage or remove them from the Models page to free up space."
                  : "Downloaded model files are cached by your browser. To free disk space, clear site data for this app in your browser settings."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Link href="/privacy" data-testid="link-privacy-center">
          <Card className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30">
            <CardContent className="flex items-center gap-3 py-4">
              <div className="w-9 h-9 rounded-md bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
                <Shield className="w-4 h-4 text-green-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Privacy Center</p>
                <p className="text-xs text-muted-foreground">
                  Review what's stored, what touched a model, and delete any data.{" "}
                  {summary.cloudRequestsThisMonth} cloud request
                  {summary.cloudRequestsThisMonth === 1 ? "" : "s"} this month ·{" "}
                  {summary.cachedFileCount} cached file
                  {summary.cachedFileCount === 1 ? "" : "s"} ({formatBytes(summary.cachedFileBytes)}).
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </CardContent>
          </Card>
        </Link>

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
  const [showHelp, setShowHelp] = useState(false);

  const help =
    provider === "openai"
      ? {
          consoleUrl: "https://platform.openai.com/api-keys",
          consoleLabel: "platform.openai.com/api-keys",
          billingUrl: "https://platform.openai.com/settings/organization/billing/overview",
          billingLabel: "platform.openai.com → Billing",
          prefix: "sk-",
          steps: [
            <>
              Open{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground inline-flex items-center gap-0.5"
              >
                platform.openai.com/api-keys <ExternalLink className="w-2.5 h-2.5" />
              </a>{" "}
              and sign in. This is the <em>developer</em> dashboard, not chat.openai.com.
            </>,
            <>
              If this is your first key, click your profile in the top-right →{" "}
              <strong>Billing</strong> and add a payment method or buy a small credit (a
              few dollars is enough to start). API access stays disabled without it.
            </>,
            <>
              Back on the API keys page, click <strong>"Create new secret key"</strong>.
              Give it a name like <em>LocalModel Studio</em>. Leave permissions on "All".
            </>,
            <>
              Copy the key (starts with <code className="text-[10px] bg-muted px-1 py-0.5 rounded">sk-</code>) —
              OpenAI only shows it <strong>once</strong>. Paste it into the API Key field
              below and click <strong>Test</strong>.
            </>,
          ],
        }
      : {
          consoleUrl: "https://console.anthropic.com/settings/keys",
          consoleLabel: "console.anthropic.com/settings/keys",
          billingUrl: "https://console.anthropic.com/settings/billing",
          billingLabel: "console.anthropic.com → Plans & Billing",
          prefix: "sk-ant-",
          steps: [
            <>
              Open{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground inline-flex items-center gap-0.5"
              >
                console.anthropic.com/settings/keys <ExternalLink className="w-2.5 h-2.5" />
              </a>{" "}
              and sign in. This is the <em>developer console</em>, not claude.ai.
            </>,
            <>
              First time only: go to <strong>Plans & Billing</strong> in the left sidebar
              and buy a small credit pack (Anthropic requires prepaid credit before the
              API will respond — a Claude Pro subscription does <em>not</em> count).
            </>,
            <>
              Back on the API Keys page, click <strong>"Create Key"</strong>. Give it a
              name like <em>LocalModel Studio</em> and leave it on the default workspace.
            </>,
            <>
              Copy the key (starts with <code className="text-[10px] bg-muted px-1 py-0.5 rounded">sk-ant-</code>) —
              Anthropic only shows it <strong>once</strong>. Paste it into the API Key
              field below and click <strong>Test</strong>.
            </>,
          ],
        };

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
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          <button
            type="button"
            onClick={() => setShowHelp((s) => !s)}
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            data-testid={`btn-${provider}-help`}
            aria-expanded={showHelp}
          >
            <HelpCircle className="w-3 h-3" />
            How do I get a key?
            <ChevronDown
              className={`w-3 h-3 transition-transform ${showHelp ? "rotate-180" : ""}`}
            />
          </button>
        </div>
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

      {showHelp && (
        <div
          className="rounded-md border border-border bg-muted/30 p-3 space-y-2"
          data-testid={`help-${provider}`}
        >
          <p className="text-[11px] font-medium text-foreground">
            Get a {label} developer API key
          </p>
          <ol className="space-y-1.5 text-[11px] text-muted-foreground list-decimal pl-4 marker:text-muted-foreground/70">
            {help.steps.map((step, i) => (
              <li key={i} className="leading-snug">
                {step}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3 pt-1 text-[10px]">
            <a
              href={help.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-foreground/80 hover:text-foreground underline underline-offset-2"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              {help.consoleLabel}
            </a>
            <a
              href={help.billingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-foreground/80 hover:text-foreground underline underline-offset-2"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              {help.billingLabel}
            </a>
          </div>
          <p className="text-[10px] text-amber-500/90 pt-1">
            Costs are billed by the provider per token used — not by us. A small
            starter credit (≈ $5) is usually enough for thousands of chat messages.
          </p>
        </div>
      )}

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
