import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  AlertCircle,
  Globe,
  Download,
  CheckCircle2,
  X,
  Sparkles,
  HardDrive,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { storageService, ModelProfile } from "@/services/storageService";
import {
  webllmService,
  WEBLLM_MODELS,
  type WebLLMModel,
} from "@/services/webllmService";
import { getSystemInfo } from "@/services/systemInfo";

const EMPTY_PROFILE: Omit<ModelProfile, "id"> = {
  name: "",
  runtimeType: "webllm",
  modelIdentifier: "",
  contextLength: 4096,
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 2048,
  useCustomGeneration: false,
  compatibility: "supported",
};

const compatColors: Record<string, string> = {
  supported: "bg-green-500/10 text-green-500 border-green-500/20",
  experimental: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  unsupported: "bg-red-500/10 text-red-500 border-red-500/20",
};

const BUNDLED_MODEL_ID = "Llama-3.2-1B-Instruct-q4f32_1-MLC";

type DownloadState =
  | { kind: "idle" }
  | { kind: "downloading"; text: string; progress: number }
  | { kind: "error"; message: string };

/**
 * Bucket a model into a fit verdict based on the user's RAM.
 *  - "recommended": comfortably fits with headroom (RAM ≥ 1.5 × minRamGb)
 *  - "ok": fits, but tight (RAM ≥ minRamGb)
 *  - "tight": might run but risky (RAM ≥ minRamGb - 1)
 *  - "too_big": almost certainly won't run
 */
function fitFor(model: WebLLMModel, ramGb: number | null): "recommended" | "ok" | "tight" | "too_big" | "unknown" {
  if (!ramGb) return "unknown";
  if (ramGb >= model.minRamGb * 1.5) return "recommended";
  if (ramGb >= model.minRamGb) return "ok";
  if (ramGb >= model.minRamGb - 1) return "tight";
  return "too_big";
}

export default function Models() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [form, setForm] = useState<Omit<ModelProfile, "id">>(EMPTY_PROFILE);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set([BUNDLED_MODEL_ID]));
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({});
  const [sysInfo] = useState(() => getSystemInfo());
  const engineAvailable = webllmService.checkWebGPU();
  const ramGb = sysInfo.ram ?? null;

  // Keep the latest setter in a ref so the long-lived progress callback
  // closure doesn't capture a stale setter (it doesn't, but be explicit).
  const setDLStateRef = useRef(setDownloadStates);
  setDLStateRef.current = setDownloadStates;

  const loadData = () => {
    setProfiles(storageService.getModelProfiles());
  };

  const refreshDownloaded = async () => {
    try {
      const ids = await webllmService.listDownloaded();
      setDownloadedIds(new Set(ids));
    } catch {
      /* ignore — empty set */
    }
  };

  useEffect(() => {
    loadData();
    void refreshDownloaded();
  }, []);

  const openAdd = () => {
    setEditingProfile(null);
    setForm({ ...EMPTY_PROFILE });
    setDialogOpen(true);
  };

  const openEdit = (profile: ModelProfile) => {
    setEditingProfile(profile);
    setForm({ ...profile });
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    storageService.deleteModelProfile(id);
    loadData();
  };

  const handleSave = () => {
    if (!form.name || !form.modelIdentifier) return;
    const profile: ModelProfile = {
      ...form,
      id: editingProfile?.id ?? `profile_${Date.now()}`,
    };
    storageService.saveModelProfile(profile);
    setDialogOpen(false);
    loadData();
  };

  const addAsProfile = (model: WebLLMModel) => {
    const exists = profiles.some((p) => p.modelIdentifier === model.id);
    if (exists) return;
    storageService.saveModelProfile({
      id: `profile_${Date.now()}`,
      name: model.label,
      runtimeType: "webllm",
      modelIdentifier: model.id,
      contextLength: 4096,
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      useCustomGeneration: false,
      compatibility: model.sizeMb >= 4000 ? "experimental" : "supported",
    });
    loadData();
  };

  const startDownload = async (model: WebLLMModel) => {
    setDownloadStates((s) => ({
      ...s,
      [model.id]: { kind: "downloading", text: "Starting…", progress: 0 },
    }));
    try {
      await webllmService.downloadModel(model.id, (p) => {
        setDLStateRef.current((s) => ({
          ...s,
          [model.id]: { kind: "downloading", text: p.text, progress: p.progress },
        }));
      });
      setDownloadStates((s) => {
        const next = { ...s };
        delete next[model.id];
        return next;
      });
      await refreshDownloaded();
    } catch (e) {
      setDownloadStates((s) => ({
        ...s,
        [model.id]: { kind: "error", message: String(e instanceof Error ? e.message : e) },
      }));
    }
  };

  const cancelDownload = async (modelId: string) => {
    await webllmService.cancelDownload(modelId);
    setDownloadStates((s) => {
      const next = { ...s };
      delete next[modelId];
      return next;
    });
  };

  const deleteDownloaded = async (model: WebLLMModel) => {
    if (model.id === BUNDLED_MODEL_ID) return;
    if (!confirm(`Delete ${model.label}? You can re-download it any time.`)) return;
    try {
      await webllmService.deleteDownloaded(model.id);
      await refreshDownloaded();
    } catch (e) {
      alert(`Failed to delete: ${String(e instanceof Error ? e.message : e)}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Models</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Download and manage local models — runs natively on your machine
            </p>
          </div>
          <Button size="sm" onClick={openAdd} data-testid="btn-add-profile" className="gap-2">
            <Plus className="w-3.5 h-3.5" />
            Add Profile
          </Button>
        </div>

        {!engineAvailable && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            <p className="text-xs text-yellow-500">
              Native inference engine is unavailable. Try reinstalling LocalModel Studio.
            </p>
          </div>
        )}

        {/* Your Profiles */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-green-500" />
            <h2 className="text-sm font-semibold">Your Models</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 font-medium">
              Local
            </span>
          </div>

          {profiles.length === 0 ? (
            <EmptyState message="No models added yet. Download one from the catalog below and click Add to Profiles." />
          ) : (
            <div className="space-y-2">
              {profiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </section>

        {/* Model Catalog */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold">Model Catalog</h2>
            {ramGb && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-medium flex items-center gap-1">
                <HardDrive className="w-2.5 h-2.5" />
                Detected ~{ramGb} GB RAM
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Download models from Hugging Face. The bundled Llama 3.2 1B is ready out of the box; everything else
            downloads on demand into the LocalModel Studio app data folder.
          </p>

          <div className="space-y-2">
            {WEBLLM_MODELS.map((m) => (
              <CatalogRow
                key={m.id}
                model={m}
                fit={fitFor(m, ramGb)}
                isDownloaded={downloadedIds.has(m.id)}
                isBundled={m.id === BUNDLED_MODEL_ID}
                downloadState={downloadStates[m.id] ?? { kind: "idle" }}
                profileExists={profiles.some((p) => p.modelIdentifier === m.id)}
                onDownload={() => void startDownload(m)}
                onCancel={() => void cancelDownload(m.id)}
                onDelete={() => void deleteDownloaded(m)}
                onAddProfile={() => addAsProfile(m)}
                onClearError={() =>
                  setDownloadStates((s) => {
                    const next = { ...s };
                    delete next[m.id];
                    return next;
                  })
                }
              />
            ))}
          </div>
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              {editingProfile ? "Edit Profile" : "Add Model Profile"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Profile Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Llama 3.2 Fast"
                className="h-8 text-sm"
                data-testid="input-profile-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Model</Label>
              <Select value={form.modelIdentifier} onValueChange={(v) => setForm({ ...form, modelIdentifier: v })}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-webllm-model">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {WEBLLM_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label} ({(m.sizeMb / 1000).toFixed(1)} GB)
                      {downloadedIds.has(m.id) ? " ✓" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Context Length</Label>
                <Input type="number" value={form.contextLength} onChange={(e) => setForm({ ...form, contextLength: Number(e.target.value) })} className="h-8 text-sm" data-testid="input-context-length" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max Tokens</Label>
                <Input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })} className="h-8 text-sm" data-testid="input-max-tokens" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Temperature</Label>
                <Input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} className="h-8 text-sm" data-testid="input-temperature" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Top P</Label>
                <Input type="number" step="0.05" min="0" max="1" value={form.topP} onChange={(e) => setForm({ ...form, topP: Number(e.target.value) })} className="h-8 text-sm" data-testid="input-top-p" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Compatibility</Label>
              <Select value={form.compatibility} onValueChange={(v) => setForm({ ...form, compatibility: v as ModelProfile["compatibility"] })}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-compatibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supported">Supported</SelectItem>
                  <SelectItem value="experimental">Experimental</SelectItem>
                  <SelectItem value="unsupported">Not Supported Yet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} data-testid="btn-save-profile" disabled={!form.name || !form.modelIdentifier}>
              Save Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CatalogRowProps {
  model: WebLLMModel;
  fit: "recommended" | "ok" | "tight" | "too_big" | "unknown";
  isDownloaded: boolean;
  isBundled: boolean;
  downloadState: DownloadState;
  profileExists: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onAddProfile: () => void;
  onClearError: () => void;
}

function CatalogRow({
  model,
  fit,
  isDownloaded,
  isBundled,
  downloadState,
  profileExists,
  onDownload,
  onCancel,
  onDelete,
  onAddProfile,
  onClearError,
}: CatalogRowProps) {
  const isDownloading = downloadState.kind === "downloading";
  const hasError = downloadState.kind === "error";

  return (
    <div
      className="p-3 rounded-md border border-border bg-card"
      data-testid={`catalog-row-${model.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{model.label}</span>
            <FitBadge fit={fit} />
            {isBundled && <StatusBadge tone="green" icon={<CheckCircle2 className="w-2.5 h-2.5" />}>Bundled</StatusBadge>}
            {isDownloaded && !isBundled && (
              <StatusBadge tone="green" icon={<CheckCircle2 className="w-2.5 h-2.5" />}>Downloaded</StatusBadge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {(model.sizeMb / 1000).toFixed(2)} GB · needs ~{model.minRamGb} GB RAM · {model.description}
          </p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Primary action */}
          {!isDownloaded && !isDownloading && (
            <Button
              size="sm"
              variant={fit === "too_big" ? "outline" : "default"}
              className="h-7 text-[11px] px-2.5 gap-1"
              onClick={onDownload}
              data-testid={`btn-download-${model.id}`}
            >
              <Download className="w-3 h-3" />
              Download
            </Button>
          )}

          {isDownloading && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] px-2.5 gap-1"
              onClick={onCancel}
              data-testid={`btn-cancel-${model.id}`}
            >
              <X className="w-3 h-3" />
              Cancel
            </Button>
          )}

          {isDownloaded && (
            <Button
              size="sm"
              variant={profileExists ? "outline" : "default"}
              className="h-7 text-[11px] px-2.5"
              disabled={profileExists}
              onClick={onAddProfile}
              data-testid={`btn-add-profile-${model.id}`}
            >
              {profileExists ? "Added" : "Add to Profiles"}
            </Button>
          )}

          {isDownloaded && !isBundled && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Delete downloaded file"
              data-testid={`btn-delete-download-${model.id}`}
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {isDownloading && (
        <div className="mt-2.5 space-y-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{
                width: `${Math.max(2, Math.min(100, downloadState.progress * 100))}%`,
              }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">{downloadState.text}</p>
        </div>
      )}

      {hasError && (
        <div className="mt-2.5 flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-red-500 flex-1">{downloadState.message}</p>
          <button onClick={onClearError} className="text-[10px] text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function FitBadge({ fit }: { fit: "recommended" | "ok" | "tight" | "too_big" | "unknown" }) {
  if (fit === "unknown") return null;
  if (fit === "recommended") {
    return (
      <StatusBadge tone="green" icon={<Sparkles className="w-2.5 h-2.5" />}>
        Recommended
      </StatusBadge>
    );
  }
  if (fit === "ok") {
    return <StatusBadge tone="blue">Fits your RAM</StatusBadge>;
  }
  if (fit === "tight") {
    return <StatusBadge tone="yellow">Tight on RAM</StatusBadge>;
  }
  return <StatusBadge tone="red">Needs more RAM</StatusBadge>;
}

function StatusBadge({
  tone,
  icon,
  children,
}: {
  tone: "green" | "blue" | "yellow" | "red";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClass = {
    green: "bg-green-500/10 text-green-500 border-green-500/20",
    blue: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    yellow: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    red: "bg-red-500/10 text-red-500 border-red-500/20",
  }[tone];
  return (
    <span
      className={`text-[9.5px] px-1.5 py-0.5 rounded-full border font-medium inline-flex items-center gap-1 ${toneClass}`}
    >
      {icon}
      {children}
    </span>
  );
}

function ProfileCard({
  profile,
  onEdit,
  onDelete,
}: {
  profile: ModelProfile;
  onEdit: (p: ModelProfile) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card data-testid={`profile-card-${profile.id}`} className="py-0">
      <CardContent className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Globe className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <span className="text-sm font-medium">{profile.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${compatColors[profile.compatibility]}`}
              >
                {profile.compatibility}
              </span>
            </div>
            <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{profile.modelIdentifier}</p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <StatChip label="ctx" value={`${profile.contextLength}`} />
              <StatChip label="temp" value={`${profile.temperature}`} />
              <StatChip label="max_t" value={`${profile.maxTokens}`} />
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onEdit(profile)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
              data-testid={`btn-edit-${profile.id}`}
            >
              <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => onDelete(profile.id)}
              className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
              data-testid={`btn-delete-${profile.id}`}
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[10px] font-mono text-muted-foreground">
      <span className="text-muted-foreground/60">{label}=</span>
      {value}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 rounded-lg border border-dashed border-border">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
