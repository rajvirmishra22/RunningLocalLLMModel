import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus,
  Trash2,
  Edit2,
  AlertCircle,
  Globe,
  Loader2,
  X,
  Download,
  CheckCircle2,
  HardDrive,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  type ModelFamily,
  type InitProgress,
  isCustomCatalogSupported,
  getCatalog,
  listCustomModels,
  addCustomModel,
  removeCustomModel,
  probeModelUrl,
  detectFamily,
} from "@/services/webllmService";
import { getSystemInfo } from "@/services/systemInfo";
import { estimateMemory } from "@/services/optimizationEngine";

/** Below this size we just start the download immediately. */
const LARGE_DOWNLOAD_MB = 2 * 1024;

/** Warn the user when free space on the models partition drops below this. */
const LOW_DISK_THRESHOLD_BYTES = 10 * 1024 * 1024 * 1024;

interface DiskFreeInfo {
  freeBytes: number;
  totalBytes: number;
  path: string;
}

interface DownloadedDetail {
  modelId: string;
  sizeBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${bytes} B`;
}

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
  | { kind: "downloading"; progress: number; text: string }
  | { kind: "error"; message: string };

export default function Models() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [form, setForm] = useState<Omit<ModelProfile, "id">>(EMPTY_PROFILE);
  const [customModels, setCustomModels] = useState<WebLLMModel[]>([]);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(
    () => new Set([BUNDLED_MODEL_ID]),
  );
  const [downloadedSizes, setDownloadedSizes] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [confirmModelId, setConfirmModelId] = useState<string | null>(null);
  const [diskInfo, setDiskInfo] = useState<DiskFreeInfo | null>(null);
  const [diskProbing, setDiskProbing] = useState(false);
  const [headerDiskInfo, setHeaderDiskInfo] = useState<DiskFreeInfo | null>(null);
  const [skipWarningIds, setSkipWarningIds] = useState<Set<string>>(() => new Set());
  const webgpuAvailable = webllmService.checkWebGPU();
  const customSupported = isCustomCatalogSupported();
  const systemRamGb = useMemo(() => getSystemInfo().ram, []);
  // Everything the Catalog / profile-edit dialog renders comes from the
  // merged list so user-added Hugging Face models behave like first-class
  // entries everywhere they're referenced.
  const fullCatalog = useMemo(
    () => getCatalog(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customModels],
  );

  const loadData = () => {
    setProfiles(storageService.getModelProfiles());
    setCustomModels(listCustomModels());
  };

  const refreshHeaderDisk = useCallback(async () => {
    try {
      const info = await invoke<DiskFreeInfo>("disk_free");
      setHeaderDiskInfo(info);
    } catch {
      /* Rust side not ready yet — keep the prior reading. */
    }
  }, []);

  const refreshDownloaded = useCallback(async () => {
    try {
      const list = await webllmService.listDownloadedDetailed();
      // The bundled model is always available but lives in the installer's
      // resources, not in <app_local_data>/models/, so it has no size here.
      setDownloadedIds(new Set([BUNDLED_MODEL_ID, ...list.map((d: DownloadedDetail) => d.modelId)]));
      setDownloadedSizes(new Map(list.map((d: DownloadedDetail) => [d.modelId, d.sizeBytes])));
    } catch {
      /* Rust side not ready yet — leave the current set in place. */
    }
    void refreshHeaderDisk();
  }, [refreshHeaderDisk]);

  useEffect(() => {
    loadData();
    void refreshDownloaded();
  }, [refreshDownloaded]);

  const totalDownloadedBytes = useMemo(() => {
    let sum = 0;
    for (const v of downloadedSizes.values()) sum += v;
    return sum;
  }, [downloadedSizes]);

  /** Largest downloaded models first — used by the low-disk warning's
   *  "free up space" shortcut so one click hits the biggest weight on disk. */
  const downloadedBySize = useMemo(() => {
    return Array.from(downloadedSizes.entries())
      .map(([modelId, sizeBytes]) => ({ modelId, sizeBytes }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes);
  }, [downloadedSizes]);

  const lowDisk =
    headerDiskInfo != null && headerDiskInfo.freeBytes < LOW_DISK_THRESHOLD_BYTES;

  /** modelId → human label, for the low-disk warning's per-model rows. */
  const labelByModelId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.modelIdentifier, p.name);
    for (const c of fullCatalog) if (!m.has(c.id)) m.set(c.id, c.label);
    return m;
  }, [profiles, fullCatalog]);

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

  const handleDeleteProfile = (id: string) => {
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

  const handleDeleteCustom = async (modelId: string) => {
    // Delete any local profile pointing at this custom model too — otherwise
    // the user is left with a profile that references a non-existent id.
    const orphans = profiles.filter((p) => p.modelIdentifier === modelId);
    for (const p of orphans) {
      storageService.deleteModelProfile(p.id);
    }
    // If it's been downloaded, drop the GGUF as well so we don't leave 4 GB
    // of weights on disk for a model the user just removed from the catalog.
    try {
      await webllmService.deleteDownloaded(modelId);
    } catch {
      /* not downloaded — fine */
    }
    removeCustomModel(modelId);
    loadData();
    await refreshDownloaded();
  };

  const addWebLLMModel = (model: WebLLMModel) => {
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

  const startDownload = async (modelId: string) => {
    setDownloads((s) => ({
      ...s,
      [modelId]: { kind: "downloading", progress: 0, text: "Starting…" },
    }));
    try {
      await webllmService.downloadModel(modelId, (p: InitProgress) => {
        setDownloads((s) => ({
          ...s,
          [modelId]: {
            kind: "downloading",
            progress: p.progress,
            text: p.text,
          },
        }));
      });
      await refreshDownloaded();
      setDownloads((s) => {
        const next = { ...s };
        delete next[modelId];
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A user-cancelled download surfaces as a generic error string from the
      // Rust side. Treat it as a quiet reset rather than a loud failure.
      if (/cancel/i.test(msg)) {
        setDownloads((s) => {
          const next = { ...s };
          delete next[modelId];
          return next;
        });
      } else {
        setDownloads((s) => ({
          ...s,
          [modelId]: { kind: "error", message: msg },
        }));
      }
    }
  };

  const handleDownload = async (modelId: string) => {
    const model = fullCatalog.find((m) => m.id === modelId);
    const isLarge = model != null && model.sizeMb >= LARGE_DOWNLOAD_MB;
    if (isLarge && !skipWarningIds.has(modelId)) {
      setConfirmModelId(modelId);
      setDiskInfo(null);
      setDiskProbing(true);
      try {
        const info = await invoke<DiskFreeInfo>("disk_free");
        setDiskInfo(info);
      } catch {
        /* Disk probe failed — dialog will still render without it. */
      } finally {
        setDiskProbing(false);
      }
      return;
    }
    await startDownload(modelId);
  };

  const handleConfirmDownload = async (dontAskAgain: boolean) => {
    const id = confirmModelId;
    if (!id) return;
    if (dontAskAgain) {
      setSkipWarningIds((s) => {
        const next = new Set(s);
        next.add(id);
        return next;
      });
    }
    setConfirmModelId(null);
    setDiskInfo(null);
    await startDownload(id);
  };

  const handleCancelDownload = async (modelId: string) => {
    await webllmService.cancelDownload(modelId);
  };

  const handleDeleteWeights = async (modelId: string) => {
    try {
      await webllmService.deleteDownloaded(modelId);
      await refreshDownloaded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDownloads((s) => ({
        ...s,
        [modelId]: { kind: "error", message: msg },
      }));
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Models</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Download chat models to run them locally — nothing leaves your machine.
            </p>
          </div>
          <Button size="sm" onClick={openAdd} data-testid="btn-add-profile" className="gap-2">
            <Plus className="w-3.5 h-3.5" />
            Add Profile
          </Button>
        </div>

        {!webgpuAvailable && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            <p className="text-xs text-yellow-500">
              WebGPU is not available. Use Chrome 113+ or Edge 113+ for in-browser inference.
            </p>
          </div>
        )}

        <DiskUsageHeader
          totalDownloadedBytes={totalDownloadedBytes}
          downloadedCount={downloadedSizes.size}
          diskInfo={headerDiskInfo}
          lowDisk={lowDisk}
          largestDownloaded={downloadedBySize}
          onDeleteWeights={(id) => void handleDeleteWeights(id)}
          labelByModelId={labelByModelId}
        />

        {/* Your Profiles */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-green-500" />
            <h2 className="text-sm font-semibold">Your Models</h2>
          </div>

          {profiles.length === 0 ? (
            <EmptyState message="No models added yet. Pick from the catalog below to get started." />
          ) : (
            <div className="space-y-2">
              {profiles.map((profile) => {
                const catalogEntry = WEBLLM_MODELS.find(
                  (m) => m.id === profile.modelIdentifier,
                );
                const isBundled = profile.modelIdentifier === BUNDLED_MODEL_ID;
                const isDownloaded = downloadedIds.has(profile.modelIdentifier);
                return (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    catalogEntry={catalogEntry}
                    isBundled={isBundled}
                    isDownloaded={isDownloaded}
                    onDiskBytes={downloadedSizes.get(profile.modelIdentifier) ?? null}
                    downloadState={downloads[profile.modelIdentifier] ?? { kind: "idle" }}
                    onEdit={openEdit}
                    onDeleteProfile={handleDeleteProfile}
                    onDownload={handleDownload}
                    onCancelDownload={handleCancelDownload}
                    onDeleteWeights={handleDeleteWeights}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* Model Catalog */}
        <section>
          <div className="flex items-end justify-between mb-3 gap-3">
            <div>
              <h2 className="text-sm font-semibold">Model Catalog</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click Add to save a model to your profiles, then Download to fetch the weights.
              </p>
            </div>
            {customSupported && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] px-2.5 flex-shrink-0 gap-1.5"
                onClick={() => setCustomDialogOpen(true)}
                data-testid="btn-open-add-custom"
              >
                <Plus className="w-3 h-3" />
                Add from Hugging Face
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {fullCatalog.map((m) => {
              const added = profiles.some((p) => p.modelIdentifier === m.id);
              const tooBig =
                customSupported && systemRamGb != null && m.minRamGb > systemRamGb;
              const isBundled = m.id === BUNDLED_MODEL_ID;
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-3 rounded-md border border-border"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold truncate">{m.label}</p>
                      {isBundled && (
                        <span className="text-[9px] px-1 py-px rounded bg-green-500/10 text-green-500 border border-green-500/20 font-medium">
                          BUNDLED
                        </span>
                      )}
                      {m.custom && (
                        <span className="text-[9px] px-1 py-px rounded bg-primary/10 text-primary border border-primary/20 font-medium">
                          custom
                        </span>
                      )}
                      {tooBig && (
                        <span
                          className="text-[9px] px-1 py-px rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 font-medium"
                          title={`Recommends ${m.minRamGb} GB RAM; this device reports ~${systemRamGb} GB.`}
                        >
                          may not fit
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {(m.sizeMb / 1000).toFixed(1)} GB · {m.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant={added ? "outline" : "default"}
                      className="h-7 text-[11px] px-2.5"
                      disabled={added}
                      onClick={() => addWebLLMModel(m)}
                      data-testid={`btn-add-webllm-${m.id}`}
                    >
                      {added ? "Added" : "Add"}
                    </Button>
                    {m.custom && (
                      <button
                        onClick={() => void handleDeleteCustom(m.id)}
                        className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                        title="Remove this custom model from the catalog"
                        data-testid={`btn-remove-custom-${m.id}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <ConfirmDownloadDialog
        model={
          confirmModelId
            ? fullCatalog.find((m) => m.id === confirmModelId) ?? null
            : null
        }
        diskInfo={diskInfo}
        diskProbing={diskProbing}
        systemRamGb={systemRamGb}
        onCancel={() => {
          setConfirmModelId(null);
          setDiskInfo(null);
        }}
        onConfirm={(dontAskAgain) => void handleConfirmDownload(dontAskAgain)}
      />

      <AddCustomModelDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        existingIds={fullCatalog.map((m) => m.id)}
        systemRamGb={systemRamGb}
        onAdded={() => {
          loadData();
          setCustomDialogOpen(false);
        }}
      />

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
                  {fullCatalog.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label} ({(m.sizeMb / 1000).toFixed(1)} GB){m.custom ? " · custom" : ""}
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

interface ProfileCardProps {
  profile: ModelProfile;
  catalogEntry: WebLLMModel | undefined;
  isBundled: boolean;
  isDownloaded: boolean;
  /** Actual on-disk size of the downloaded weights, in bytes. Null for the
   *  bundled model (it lives in the installer's resources, not the data dir)
   *  or for models we haven't gotten a reading on yet. */
  onDiskBytes: number | null;
  downloadState: DownloadState;
  onEdit: (p: ModelProfile) => void;
  onDeleteProfile: (id: string) => void;
  onDownload: (modelId: string) => void;
  onCancelDownload: (modelId: string) => void;
  onDeleteWeights: (modelId: string) => void;
}

function ProfileCard({
  profile,
  catalogEntry,
  isBundled,
  isDownloaded,
  onDiskBytes,
  downloadState,
  onEdit,
  onDeleteProfile,
  onDownload,
  onCancelDownload,
  onDeleteWeights,
}: ProfileCardProps) {
  const downloadable = !isBundled && catalogEntry?.url != null;
  const sizeLabel = catalogEntry
    ? `${(catalogEntry.sizeMb / 1000).toFixed(1)} GB`
    : null;

  return (
    <Card data-testid={`profile-card-${profile.id}`} className="py-0">
      <CardContent className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Globe className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <span className="text-sm font-medium">{profile.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${compatColors[profile.compatibility]}`}>
                {profile.compatibility}
              </span>
              <StatusBadge
                isBundled={isBundled}
                isDownloaded={isDownloaded}
                downloadable={downloadable}
                downloadState={downloadState}
              />
            </div>
            <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{profile.modelIdentifier}</p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <StatChip label="ctx" value={`${profile.contextLength}`} />
              <StatChip label="temp" value={`${profile.temperature}`} />
              <StatChip label="max_t" value={`${profile.maxTokens}`} />
              {sizeLabel && <StatChip label="size" value={sizeLabel} />}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onEdit(profile)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
              data-testid={`btn-edit-${profile.id}`}
              title="Edit profile"
            >
              <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => onDeleteProfile(profile.id)}
              className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
              data-testid={`btn-delete-${profile.id}`}
              title="Remove this profile (keeps the model on disk)"
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Download / delete-weights row */}
        {downloadable && (
          <div className="pt-1">
            {downloadState.kind === "downloading" ? (
              <DownloadProgressBar
                progress={downloadState.progress}
                text={downloadState.text}
                onCancel={() => onCancelDownload(profile.modelIdentifier)}
                testId={`download-progress-${profile.id}`}
              />
            ) : downloadState.kind === "error" ? (
              <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  <p className="text-[11px] text-red-500 truncate">{downloadState.message}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2 flex-shrink-0"
                  onClick={() => onDownload(profile.modelIdentifier)}
                  data-testid={`btn-retry-download-${profile.id}`}
                >
                  Retry
                </Button>
              </div>
            ) : isDownloaded ? (
              <div className="flex items-center justify-end gap-2">
                {onDiskBytes != null && onDiskBytes > 0 && (
                  <span
                    className="text-[10px] font-mono text-muted-foreground"
                    data-testid={`on-disk-size-${profile.id}`}
                    title="Actual size of the downloaded weights on disk"
                  >
                    {formatBytes(onDiskBytes)} on disk
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] px-2 gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() => onDeleteWeights(profile.modelIdentifier)}
                  data-testid={`btn-delete-weights-${profile.id}`}
                  title="Delete the downloaded weights to free disk space"
                >
                  <HardDrive className="w-3 h-3" />
                  Delete weights
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  className="h-7 text-[11px] px-2.5 gap-1.5"
                  onClick={() => onDownload(profile.modelIdentifier)}
                  data-testid={`btn-download-${profile.id}`}
                >
                  <Download className="w-3 h-3" />
                  Download {sizeLabel ? `(${sizeLabel})` : ""}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  isBundled,
  isDownloaded,
  downloadable,
  downloadState,
}: {
  isBundled: boolean;
  isDownloaded: boolean;
  downloadable: boolean;
  downloadState: DownloadState;
}) {
  if (isBundled) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green-500/10 text-green-500 border-green-500/20 font-medium">
        Bundled
      </span>
    );
  }
  if (downloadState.kind === "downloading") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/20 font-medium">
        Downloading
      </span>
    );
  }
  if (isDownloaded) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-green-500/10 text-green-500 border-green-500/20 font-medium">
        <CheckCircle2 className="w-2.5 h-2.5" />
        Downloaded
      </span>
    );
  }
  if (downloadable) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/40 text-muted-foreground border-border font-medium">
        Not downloaded
      </span>
    );
  }
  return null;
}

function DownloadProgressBar({
  progress,
  text,
  onCancel,
  testId,
}: {
  progress: number;
  text: string;
  onCancel: () => void;
  testId: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground truncate flex-1">{text}</p>
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
          {pct}%
        </span>
        <button
          onClick={onCancel}
          className="p-1 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
          title="Cancel download"
          data-testid={`${testId}-cancel`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[10px] font-mono text-muted-foreground">
      <span className="text-muted-foreground/60">{label}=</span>{value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add-from-Hugging-Face dialog
//
// Two-step flow: paste a .gguf URL → "Check" runs a Rust HEAD probe to get
// the real Content-Length so we can show the actual download size and warn
// if the model is unlikely to fit in RAM, then the user confirms the
// auto-filled name / family / sizing.
// ---------------------------------------------------------------------------

interface AddCustomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingIds: string[];
  systemRamGb: number | null;
  onAdded: () => void;
}

function deriveLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return last.replace(/\.gguf$/i, "").replace(/[._-]+/g, " ").trim();
  } catch {
    return "";
  }
}

function suggestMinRamGb(sizeMb: number): number {
  // Rule of thumb for Q4-quantised GGUFs: ~1.3x model weight in RAM for
  // weights + KV cache + headroom. Round up to the nearest GB.
  return Math.max(2, Math.ceil((sizeMb * 1.3) / 1024));
}

function AddCustomModelDialog({
  open,
  onOpenChange,
  existingIds,
  systemRamGb,
  onAdded,
}: AddCustomDialogProps) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [family, setFamily] = useState<ModelFamily>("llama3");
  const [sizeMb, setSizeMb] = useState<number | null>(null);
  const [minRamGb, setMinRamGb] = useState<number>(4);
  const [description, setDescription] = useState("");
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset everything when the dialog closes so the next open starts fresh.
      setUrl("");
      setLabel("");
      setFamily("llama3");
      setSizeMb(null);
      setMinRamGb(4);
      setDescription("");
      setProbing(false);
      setError(null);
      setProbed(false);
    }
  }, [open]);

  const trimmedUrl = url.trim();
  const looksLikeGguf = /\.gguf(\?|$)/i.test(trimmedUrl);
  const urlValid = /^https?:\/\//i.test(trimmedUrl);
  const sizeGb = sizeMb != null ? sizeMb / 1024 : null;
  const tooBigForRam =
    systemRamGb != null && sizeGb != null && minRamGb > systemRamGb;
  const duplicateLabel =
    label.trim().length > 0 &&
    existingIds.some(
      (id) => id.toLowerCase() === label.trim().toLowerCase().replace(/\s+/g, "-"),
    );

  const handleProbe = async () => {
    setError(null);
    setProbing(true);
    try {
      const result = await probeModelUrl(trimmedUrl);
      if (result.sizeBytes === 0) {
        // Some mirrors omit Content-Length entirely. We still let the user
        // proceed but warn that we can't pre-check the size.
        setError(
          "Couldn't determine the file size from the server. You can still add it, but the download progress bar may show 'unknown' size.",
        );
      }
      const mb = Math.round(result.sizeBytes / (1024 * 1024));
      setSizeMb(mb);
      setMinRamGb(suggestMinRamGb(mb || 1));
      if (!label) setLabel(deriveLabelFromUrl(result.finalUrl) || deriveLabelFromUrl(trimmedUrl));
      setFamily(detectFamily(result.finalUrl || trimmedUrl));
      setProbed(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const handleSave = () => {
    setError(null);
    try {
      addCustomModel({
        label: label.trim(),
        url: trimmedUrl,
        sizeMb: sizeMb ?? 0,
        minRamGb,
        family,
        description: description.trim() || undefined,
      });
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const canSave =
    urlValid && label.trim().length > 0 && sizeMb != null && !duplicateLabel;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Add a model from Hugging Face</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">GGUF file URL</Label>
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setProbed(false);
                  setSizeMb(null);
                }}
                placeholder="https://huggingface.co/.../model.Q4_K_M.gguf"
                className="h-8 text-sm font-mono"
                data-testid="input-custom-url"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs flex-shrink-0"
                disabled={!urlValid || probing}
                onClick={() => void handleProbe()}
                data-testid="btn-probe-url"
              >
                {probing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Check"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Paste any public Hugging Face GGUF URL (the <span className="font-mono">resolve/main/…</span> link
              from a repo's Files tab). Click Check to fetch its size.
            </p>
            {urlValid && !looksLikeGguf && (
              <p className="text-[10px] text-yellow-500">
                This URL doesn't end in .gguf — make sure it points at a GGUF file, not the model card page.
              </p>
            )}
          </div>

          {probed && sizeMb != null && (
            <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Download size</span>
                <span className="font-mono font-medium">
                  {sizeMb > 0 ? `${(sizeMb / 1024).toFixed(2)} GB` : "unknown"}
                </span>
              </div>
              {tooBigForRam && (
                <div className="flex items-start gap-2 text-[10px] text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 rounded p-2">
                  <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>
                    This model recommends {minRamGb} GB RAM, but this device reports ~{systemRamGb} GB.
                    It may run slowly or fail to load.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Display name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Llama 3.1 8B (my fine-tune)"
              className="h-8 text-sm"
              data-testid="input-custom-label"
            />
            {duplicateLabel && (
              <p className="text-[10px] text-destructive">A model with this name already exists.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Chat template</Label>
              <Select value={family} onValueChange={(v) => setFamily(v as ModelFamily)}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-custom-family">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="llama3">Llama 3 / 3.1 / 3.2</SelectItem>
                  <SelectItem value="qwen">Qwen / ChatML</SelectItem>
                  <SelectItem value="phi3">Phi 3 / 3.5</SelectItem>
                  <SelectItem value="mistral">Mistral (INST)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">RAM needed (GB)</Label>
              <Input
                type="number"
                min="1"
                value={minRamGb}
                onChange={(e) => setMinRamGb(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 text-sm"
                data-testid="input-custom-min-ram"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this model good at?"
              className="h-8 text-sm"
              data-testid="input-custom-description"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!canSave}
            data-testid="btn-save-custom-model"
          >
            Add to catalog
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Disk-usage header
//
// Surfaces total bytes consumed by every downloaded GGUF in the app's data
// dir plus free space on that partition, and pops a warning banner when
// free space drops below LOW_DISK_THRESHOLD_BYTES. The banner lists the
// largest weights with a one-click delete so the user can recover space
// without leaving the page.
// ---------------------------------------------------------------------------

interface DiskUsageHeaderProps {
  totalDownloadedBytes: number;
  downloadedCount: number;
  diskInfo: DiskFreeInfo | null;
  lowDisk: boolean;
  largestDownloaded: Array<{ modelId: string; sizeBytes: number }>;
  onDeleteWeights: (modelId: string) => void;
  labelByModelId: Map<string, string>;
}

function DiskUsageHeader({
  totalDownloadedBytes,
  downloadedCount,
  diskInfo,
  lowDisk,
  largestDownloaded,
  onDeleteWeights,
  labelByModelId,
}: DiskUsageHeaderProps) {
  // Nothing useful to show — no downloads yet and the disk probe hasn't
  // returned anything either. Stay quiet so the page header isn't cluttered.
  if (downloadedCount === 0 && diskInfo == null) return null;

  return (
    <section className="space-y-2" data-testid="disk-usage-header">
      <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium">
              <span data-testid="disk-used-label">
                {formatBytes(totalDownloadedBytes)} used
              </span>{" "}
              <span className="text-muted-foreground font-normal">
                across {downloadedCount} downloaded{" "}
                {downloadedCount === 1 ? "model" : "models"}
              </span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {diskInfo != null ? (
                <>
                  <span data-testid="disk-free-label">
                    {formatBytes(diskInfo.freeBytes)} free
                  </span>{" "}
                  of {formatBytes(diskInfo.totalBytes)} on this drive
                </>
              ) : (
                "Checking free disk space…"
              )}
            </p>
          </div>
        </div>
      </div>

      {lowDisk && diskInfo != null && (
        <div
          className="p-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 space-y-2"
          data-testid="low-disk-banner"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-yellow-500">
                Only {formatBytes(diskInfo.freeBytes)} free on this drive
              </p>
              <p className="text-[11px] text-yellow-500/80 mt-0.5">
                Downloading another multi-GB model could fill your disk.
                Delete weights you aren't using to free up space.
              </p>
            </div>
          </div>
          {largestDownloaded.length > 0 && (
            <div className="space-y-1 pt-1">
              {largestDownloaded.slice(0, 3).map(({ modelId, sizeBytes }) => (
                <div
                  key={modelId}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-background/40 border border-yellow-500/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium truncate">
                      {labelByModelId.get(modelId) ?? modelId}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {formatBytes(sizeBytes)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 gap-1 flex-shrink-0"
                    onClick={() => onDeleteWeights(modelId)}
                    data-testid={`btn-low-disk-delete-${modelId}`}
                    title="Delete this model's weights to free disk space"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 rounded-lg border border-dashed border-border">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm-download dialog
//
// Gates any catalog model >= 2 GB behind an explicit confirmation showing
// download size, free disk space on the models partition, estimated RAM
// usage and a green/yellow/red fit indicator. Optional "don't ask again
// this session" checkbox skips the dialog for the same model id until the
// app is reloaded.
// ---------------------------------------------------------------------------

interface ConfirmDownloadDialogProps {
  model: WebLLMModel | null;
  diskInfo: DiskFreeInfo | null;
  diskProbing: boolean;
  systemRamGb: number | null;
  onCancel: () => void;
  onConfirm: (dontAskAgain: boolean) => void;
}

type FitLevel = "good" | "tight" | "bad" | "unknown";

function classifyFit(
  totalGb: number,
  ramGb: number | null,
): { level: FitLevel; label: string } {
  if (ramGb == null) {
    return { level: "unknown", label: "RAM unknown" };
  }
  if (totalGb <= ramGb * 0.7) return { level: "good", label: "Comfortable fit" };
  if (totalGb <= ramGb) return { level: "tight", label: "Tight — may swap" };
  return { level: "bad", label: "Likely won't fit" };
}

function fitColors(level: FitLevel): string {
  switch (level) {
    case "good":
      return "bg-green-500/10 text-green-500 border-green-500/20";
    case "tight":
      return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    case "bad":
      return "bg-red-500/10 text-red-500 border-red-500/20";
    case "unknown":
      return "bg-muted/40 text-muted-foreground border-border";
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function ConfirmDownloadDialog({
  model,
  diskInfo,
  diskProbing,
  systemRamGb,
  onCancel,
  onConfirm,
}: ConfirmDownloadDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Reset the checkbox whenever a new model is queued.
  useEffect(() => {
    if (model) setDontAskAgain(false);
  }, [model?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!model) return null;

  const sizeBytes = model.sizeMb * 1024 * 1024;
  const sizeGb = model.sizeMb / 1024;
  const memory = estimateMemory(model, 4096, systemRamGb);
  const fit = classifyFit(memory.totalGb, systemRamGb);
  // Need the model plus a safety margin for the .partial during download.
  const diskShortfall =
    diskInfo != null && diskInfo.freeBytes < sizeBytes * 1.1;

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Download className="w-4 h-4" />
            Download {model.label}?
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            This is a {sizeGb.toFixed(1)} GB download. Once it starts it will
            keep running in the background — you can cancel anytime.
          </p>

          <div className="rounded-md border border-border p-3 space-y-2.5 bg-muted/30">
            <Row
              label="Download size"
              value={`${sizeGb.toFixed(2)} GB`}
              testId="confirm-download-size"
            />
            <Row
              label="Free disk space"
              value={
                diskProbing
                  ? "Checking…"
                  : diskInfo
                    ? `${formatGb(diskInfo.freeBytes)} of ${formatGb(diskInfo.totalBytes)}`
                    : "unknown"
              }
              warning={diskShortfall}
              testId="confirm-disk-free"
            />
            <Row
              label="Estimated RAM use"
              value={`~${memory.totalGb.toFixed(1)} GB${
                systemRamGb != null ? ` of ${systemRamGb} GB` : ""
              }`}
              testId="confirm-ram-use"
            />
            <div className="flex items-center justify-between text-[11px] pt-1">
              <span className="text-muted-foreground">Fit</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${fitColors(fit.level)}`}
                data-testid="confirm-fit-indicator"
                data-fit={fit.level}
              >
                {fit.label}
              </span>
            </div>
          </div>

          {diskShortfall && (
            <div className="flex items-start gap-2 text-[10px] text-red-500 bg-red-500/10 border border-red-500/20 rounded p-2">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                You don't have enough free disk space for this download.
                Free up at least {sizeGb.toFixed(1)} GB and try again.
              </span>
            </div>
          )}

          {!diskShortfall && fit.level === "bad" && (
            <div className="flex items-start gap-2 text-[10px] text-red-500 bg-red-500/10 border border-red-500/20 rounded p-2">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                Estimated memory use is larger than this device's RAM. The
                model may fail to load or run very slowly.
              </span>
            </div>
          )}
          {!diskShortfall && fit.level === "tight" && (
            <div className="flex items-start gap-2 text-[10px] text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 rounded p-2">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                Memory headroom is tight. The model should load but expect
                slower generation if other apps are running.
              </span>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox
              checked={dontAskAgain}
              onCheckedChange={(v) => setDontAskAgain(v === true)}
              data-testid="confirm-skip-warning"
            />
            <span className="text-[11px] text-muted-foreground">
              Don't ask again for this model this session
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            data-testid="btn-cancel-download"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(dontAskAgain)}
            disabled={diskShortfall}
            data-testid="btn-confirm-download"
            className="gap-1.5"
          >
            <Download className="w-3 h-3" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  warning,
  testId,
}: {
  label: string;
  value: string;
  warning?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono font-medium ${warning ? "text-red-500" : ""}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}
