import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Sparkles,
  Cpu,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  Info,
  Download,
  CircleDot,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { storageService, type ModelProfile } from "@/services/storageService";
import { webllmService, WEBLLM_MODELS } from "@/services/webllmService";
import { getSystemInfo, getGpuInfo, type GpuInfo } from "@/services/systemInfo";
import { WEBLLM_CAPABILITIES, type ChangeMode } from "@/services/backendCapabilities";
import {
  recommend,
  profileDisplayName,
  parseQuantization,
  estimateMemory,
  type OptimizationProfile,
  type Recommendation,
} from "@/services/optimizationEngine";

export default function Tuning() {
  const [sysInfo] = useState(() => getSystemInfo());
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [optProfile, setOptProfile] = useState<OptimizationProfile>("balanced");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [savedBackup, setSavedBackup] = useState<ModelProfile | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);

  const webgpuAvailable = webllmService.checkWebGPU();
  const loadedModelId = webllmService.getLoadedModelId();

  useEffect(() => {
    const ps = storageService.getModelProfiles();
    setProfiles(ps);
    if (ps.length > 0) setActiveProfileId(ps[0].id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getGpuInfo().then((g) => {
      if (!cancelled) setGpu(g);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  function updateActive(patch: Partial<ModelProfile>) {
    if (!activeProfile) return;
    const next = { ...activeProfile, ...patch };
    storageService.saveModelProfile(next);
    setProfiles(storageService.getModelProfiles());
  }

  function runOptimizer() {
    const rec = recommend({
      profile: optProfile,
      ramGb: sysInfo.ram,
      webgpuAvailable,
      savedProfiles: profiles,
    });
    setRecommendation(rec);
    setApplyStatus(null);
  }

  function applyRecommendation() {
    if (!recommendation) return;

    // Backup is read from a local variable inside this handler — reading state
    // we just set via setSavedBackup would be stale until next render.
    const backup: ModelProfile | null = activeProfile ? { ...activeProfile } : null;
    setSavedBackup(backup);

    try {
      // If the recommended model is already saved as a profile, switch the
      // active profile to that one and apply generation tweaks there.
      if (recommendation.source.kind === "available") {
        const targetId = recommendation.source.profileId;
        const matched = profiles.find((p) => p.id === targetId);
        if (matched) {
          // Applying a recommendation is an explicit, deliberate user action,
          // so we flip on `useCustomGeneration` — otherwise the tuned values
          // would be saved but ignored at chat time.
          const updated: ModelProfile = {
            ...matched,
            temperature: recommendation.generation.temperature,
            topP: recommendation.generation.topP,
            maxTokens: recommendation.generation.maxTokens,
            useCustomGeneration: true,
          };
          storageService.saveModelProfile(updated);
          setActiveProfileId(matched.id);
          setProfiles(storageService.getModelProfiles());
          setApplyStatus(`Applied. Switched active profile to "${matched.name}".`);
          return;
        }
      }
      // Otherwise patch the current profile's generation settings, if any.
      if (!activeProfile) {
        setApplyStatus("No active profile to apply settings to. Add a model first.");
        return;
      }
      storageService.saveModelProfile({
        ...activeProfile,
        temperature: recommendation.generation.temperature,
        topP: recommendation.generation.topP,
        maxTokens: recommendation.generation.maxTokens,
        useCustomGeneration: true,
      });
      setProfiles(storageService.getModelProfiles());
      setApplyStatus("Generation settings applied to the current profile.");
    } catch (e) {
      if (backup) storageService.saveModelProfile(backup);
      setApplyStatus(`Failed to apply: ${String(e)}. Reverted.`);
    }
  }

  function revert() {
    if (!savedBackup) return;
    storageService.saveModelProfile(savedBackup);
    setProfiles(storageService.getModelProfiles());
    setActiveProfileId(savedBackup.id);
    setSavedBackup(null);
    setApplyStatus("Reverted to previous settings.");
  }

  function addCatalogModel(modelId: string) {
    const model = WEBLLM_MODELS.find((m) => m.id === modelId);
    if (!model) return;
    const exists = profiles.some((p) => p.modelIdentifier === modelId);
    if (exists) return;
    storageService.saveModelProfile({
      id: `profile_${Date.now()}`,
      name: model.label,
      runtimeType: "webllm",
      modelIdentifier: model.id,
      contextLength: 4096,
      temperature: recommendation?.generation.temperature ?? 0.7,
      topP: recommendation?.generation.topP ?? 0.9,
      maxTokens: recommendation?.generation.maxTokens ?? 2048,
      // Adding a model from the optimizer is an explicit, intentional choice,
      // so the tuned generation values should actually take effect at chat time.
      useCustomGeneration: !!recommendation,
      compatibility: model.sizeMb >= 4000 ? "experimental" : "supported",
    });
    const updated = storageService.getModelProfiles();
    setProfiles(updated);
    const justAdded = updated.find((p) => p.modelIdentifier === modelId);
    if (justAdded) setActiveProfileId(justAdded.id);
    setApplyStatus(`Added "${model.label}". Open Models to download the weights.`);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sliders className="w-5 h-5 text-primary" />
            Model Tuning
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Adjust generation settings, see what your hardware can do, and let the optimizer recommend a model that fits.
          </p>
        </div>

        {/* Hardware Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="w-4 h-4 text-muted-foreground" />
              Hardware Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <InfoRow label="OS" value={sysInfo.os} />
            <InfoRow label="CPU threads" value={String(sysInfo.cpuCores)} />
            <InfoRow
              label="RAM"
              value={sysInfo.ram ? `~${sysInfo.ram} GB (approximate)` : "Unknown"}
            />
            <InfoRow label="WebGPU" value={webgpuAvailable ? "Available" : "Not available"} valueClass={webgpuAvailable ? "text-green-500" : "text-yellow-500"} />
            <InfoRow label="GPU adapter" value={gpu?.adapterName || gpu?.vendor || "Hidden by browser"} />
            <InfoRow
              label="Max GPU buffer"
              value={gpu?.maxBufferSizeMb ? `${(gpu.maxBufferSizeMb / 1024).toFixed(1)} GB` : "Unknown"}
            />
          </CardContent>
        </Card>

        {/* Live Generation Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Generation Settings</CardTitle>
            <p className="text-xs text-muted-foreground">
              Live settings — apply on your next message. Tuned per profile.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Active profile</Label>
              <Select
                value={activeProfileId ?? ""}
                onValueChange={(v) => setActiveProfileId(v)}
                disabled={profiles.length === 0}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder={profiles.length === 0 ? "No profiles — add one in Models" : "Select a profile"} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.name} ({parseQuantization(p.modelIdentifier)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {activeProfile && (
              <>
                {/* Generation knobs hidden behind an opt-in toggle. Casual users
                    never have to learn what temperature or top-p mean; the chat
                    flow uses sensible defaults until they flip this on. */}
                <label
                  className="flex items-center gap-2.5 text-xs cursor-pointer select-none"
                  data-testid="toggle-custom-generation"
                >
                  <input
                    type="checkbox"
                    checked={activeProfile.useCustomGeneration}
                    onChange={(e) => updateActive({ useCustomGeneration: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                  />
                  <span className="font-medium">Use custom generation settings</span>
                  <span className="text-muted-foreground text-[11px]">
                    {activeProfile.useCustomGeneration
                      ? "Using the values below."
                      : "Off — chat uses sensible defaults (temp 0.7, top-p 0.9, max 2048)."}
                  </span>
                </label>

                {activeProfile.useCustomGeneration && (
                  <div className="grid grid-cols-3 gap-3">
                    <NumberField
                      label="Temperature"
                      tooltip="Controls randomness. Lower is more focused, higher is more creative. Range 0–2."
                      value={activeProfile.temperature}
                      step={0.1}
                      min={0}
                      max={2}
                      onChange={(v) => updateActive({ temperature: v })}
                    />
                    <NumberField
                      label="Top-p"
                      tooltip="Limits token choices to the most likely group of tokens. 0.9 is a good default."
                      value={activeProfile.topP}
                      step={0.05}
                      min={0}
                      max={1}
                      onChange={(v) => updateActive({ topP: v })}
                    />
                    <NumberField
                      label="Max tokens"
                      tooltip="Hard cap on the length of each response."
                      value={activeProfile.maxTokens}
                      step={128}
                      min={1}
                      max={8192}
                      onChange={(v) => updateActive({ maxTokens: v })}
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Optimizer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Optimize Model
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Picks a model and generation settings tuned to your hardware. Prefers models you've already added.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 flex-1 min-w-[160px]">
                <Label className="text-xs">Profile</Label>
                <Select value={optProfile} onValueChange={(v) => setOptProfile(v as OptimizationProfile)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="balanced" className="text-xs">Balanced — best all-rounder</SelectItem>
                    <SelectItem value="max-quality" className="text-xs">Max Quality — biggest model that fits</SelectItem>
                    <SelectItem value="low-memory" className="text-xs">Low Memory — keep RAM use minimal</SelectItem>
                    <SelectItem value="fastest" className="text-xs">Fastest — quickest token streaming</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={runOptimizer} className="gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Recommend
              </Button>
            </div>

            {recommendation && <RecommendationCard
              rec={recommendation}
              onApply={applyRecommendation}
              onAddToProfiles={addCatalogModel}
              applyStatus={applyStatus}
              onRevert={savedBackup ? revert : undefined}
              loadedModelId={loadedModelId}
              ramGb={sysInfo.ram}
            />}
          </CardContent>
        </Card>

        {/* What can / can't be changed */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">What this backend can change</CardTitle>
            <p className="text-xs text-muted-foreground">
              Browser inference (WebLLM) exposes a small set of controls. The rest is baked into the model file.
            </p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {Object.values(WEBLLM_CAPABILITIES.caps).map((c) => (
              <CapabilityRow key={c.label} cap={c} />
            ))}
          </CardContent>
        </Card>

        {/* Local + downloadable models */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Model Variants</CardTitle>
            <p className="text-xs text-muted-foreground">
              Switching from Q4 to Q8 isn't a slider — it's a different model file. Here's what you have locally and what you can add.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-1 mb-2">
              Your profiles
            </p>
            {profiles.length === 0 ? (
              <EmptyHint>
                No profiles yet.{" "}
                <Link href="/models" className="text-primary hover:underline">
                  Add one in Models
                </Link>{" "}
                or run the optimizer above.
              </EmptyHint>
            ) : (
              profiles.map((p) => {
                const m = WEBLLM_MODELS.find((x) => x.id === p.modelIdentifier);
                const isLoaded = loadedModelId === p.modelIdentifier;
                return (
                  <div key={p.id} className="flex items-center justify-between p-2.5 rounded-md border border-border">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {isLoaded && <CircleDot className="w-3 h-3 text-green-500 flex-shrink-0" />}
                        <span className="text-xs font-medium truncate">{p.name}</span>
                        <span className="text-[10px] px-1 py-0.5 rounded bg-muted/60 font-mono text-muted-foreground">
                          {parseQuantization(p.modelIdentifier)}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {m ? `${(m.sizeMb / 1024).toFixed(1)} GB · ${m.description}` : p.modelIdentifier}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-3">
                      {isLoaded ? "Loaded" : "Cached / on disk"}
                    </span>
                  </div>
                );
              })
            )}

            <Separator className="my-3" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Available to add
            </p>
            {WEBLLM_MODELS.filter((m) => !profiles.some((p) => p.modelIdentifier === m.id)).length === 0 ? (
              <EmptyHint>You've added every model in the catalog.</EmptyHint>
            ) : (
              WEBLLM_MODELS.filter((m) => !profiles.some((p) => p.modelIdentifier === m.id)).map((m) => {
                const mem = estimateMemory(m, 4096, sysInfo.ram);
                const flag = mem.fitsComfortably;
                return (
                  <div key={m.id} className="flex items-center justify-between p-2.5 rounded-md border border-border">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">{m.label}</span>
                        <span className="text-[10px] px-1 py-0.5 rounded bg-muted/60 font-mono text-muted-foreground">
                          {parseQuantization(m.id)}
                        </span>
                        <FitChip fits={flag} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {(m.sizeMb / 1024).toFixed(1)} GB · {m.description}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] px-2.5 gap-1 flex-shrink-0 ml-3"
                      onClick={() => addCatalogModel(m.id)}
                    >
                      <Download className="w-3 h-3" />
                      Add
                    </Button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RecommendationCard({
  rec,
  onApply,
  onAddToProfiles,
  applyStatus,
  onRevert,
  loadedModelId,
  ramGb,
}: {
  rec: Recommendation;
  onApply: () => void;
  onAddToProfiles: (modelId: string) => void;
  applyStatus: string | null;
  onRevert?: () => void;
  loadedModelId: string | null;
  ramGb: number | null;
}) {
  // Scale the memory bar to detected RAM (or 16 GB if unknown) so the bar
  // reads correctly on both small and large machines.
  const barMaxGb = ramGb ?? 16;
  const isAvailable = rec.source.kind === "available";
  const memColor =
    rec.memory.fitsComfortably === false
      ? "bg-yellow-500"
      : rec.memory.fitsComfortably === true
        ? "bg-green-500"
        : "bg-muted-foreground/60";

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isAvailable ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : (
              <Download className="w-4 h-4 text-primary flex-shrink-0" />
            )}
            <span className="text-sm font-semibold">
              {isAvailable ? "Use" : "Add"}: {rec.source.label}
            </span>
            <span className="text-[10px] px-1 py-0.5 rounded bg-muted/60 font-mono text-muted-foreground">
              {rec.quantization}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {profileDisplayName(rec.profile)} · {(rec.source.sizeMb / 1024).toFixed(1)} GB on disk · est. ~{rec.memory.totalGb} GB total memory
          </p>
        </div>
      </div>

      {/* Memory bar */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span>Estimated memory use</span>
          <span className="font-mono">
            {rec.memory.totalGb} GB · confidence: {rec.memory.confidence}
          </span>
        </div>
        <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
          <div className={`h-full ${memColor}`} style={{ width: `${Math.min(100, (rec.memory.totalGb / barMaxGb) * 100)}%` }} />
        </div>
      </div>

      {/* Settings preview */}
      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
        <PreviewChip k="temp" v={rec.generation.temperature.toString()} />
        <PreviewChip k="top_p" v={rec.generation.topP.toString()} />
        <PreviewChip k="max_t" v={rec.generation.maxTokens.toString()} />
      </div>

      {/* Reasoning */}
      <div className="space-y-1">
        {rec.reasoning.map((r, i) => (
          <p key={i} className="text-xs text-foreground/80 flex gap-2">
            <Info className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
            {r}
          </p>
        ))}
      </div>

      {/* Warnings */}
      {rec.warnings.length > 0 && (
        <div className="space-y-1">
          {rec.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-yellow-500/90 flex gap-2">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {isAvailable ? (
          <Button size="sm" onClick={onApply} className="gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Apply recommendation
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => onAddToProfiles((rec.source as { modelId: string }).modelId)}
            className="gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Add this model
          </Button>
        )}
        {onRevert && (
          <Button size="sm" variant="outline" onClick={onRevert} className="gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            Revert
          </Button>
        )}
        {loadedModelId && loadedModelId !== rec.source.modelId && (
          <span className="text-[10px] text-muted-foreground">
            Currently loaded model is different — applying will require loading the new model on next chat.
          </span>
        )}
      </div>

      {applyStatus && (
        <p className="text-[11px] text-green-500 flex gap-1.5 items-center">
          <CheckCircle2 className="w-3 h-3" />
          {applyStatus}
        </p>
      )}
    </div>
  );
}

function CapabilityRow({
  cap,
}: {
  cap: { label: string; support: "yes" | "no" | "unknown"; changeMode: ChangeMode; note: string };
}) {
  const badge =
    cap.support === "yes"
      ? { color: "text-green-500 bg-green-500/10 border-green-500/20", text: changeModeText(cap.changeMode) }
      : cap.support === "no"
        ? { color: "text-muted-foreground bg-muted/40 border-border", text: changeModeText(cap.changeMode) }
        : { color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20", text: "Unknown" };
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{cap.label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{cap.note}</p>
      </div>
      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0 ${badge.color}`}>
        {badge.text}
      </span>
    </div>
  );
}

function changeModeText(m: ChangeMode): string {
  switch (m) {
    case "immediate":
      return "Applies immediately";
    case "reload":
      return "Requires reload";
    case "different-file":
      return "Different model file";
    case "unsupported":
      return "Unsupported";
  }
}

function InfoRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium font-mono ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function NumberField({
  label,
  tooltip,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1" title={tooltip}>
        {label}
        <Info className="w-3 h-3 text-muted-foreground/70" />
      </Label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-sm"
      />
    </div>
  );
}

function PreviewChip({ k, v }: { k: string; v: string }) {
  return (
    <div className="px-2 py-1 rounded bg-muted/40 border border-border">
      <span className="text-muted-foreground/60">{k}=</span>
      <span>{v}</span>
    </div>
  );
}

function FitChip({ fits }: { fits: boolean | null }) {
  if (fits === null) {
    return (
      <span className="text-[10px] px-1 py-0.5 rounded border border-border text-muted-foreground">
        fit: unknown
      </span>
    );
  }
  return fits ? (
    <span className="text-[10px] px-1 py-0.5 rounded border border-green-500/20 bg-green-500/10 text-green-500">
      good fit
    </span>
  ) : (
    <span className="text-[10px] px-1 py-0.5 rounded border border-yellow-500/20 bg-yellow-500/10 text-yellow-500">
      may be tight
    </span>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center py-4 rounded border border-dashed border-border">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
