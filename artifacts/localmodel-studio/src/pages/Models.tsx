import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Edit2, AlertCircle, Globe, Loader2, X } from "lucide-react";
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
  type WebLLMModel,
  type ModelFamily,
  isCustomCatalogSupported,
  getCatalog,
  listCustomModels,
  addCustomModel,
  removeCustomModel,
  probeModelUrl,
  detectFamily,
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

export default function Models() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [form, setForm] = useState<Omit<ModelProfile, "id">>(EMPTY_PROFILE);
  const [customModels, setCustomModels] = useState<WebLLMModel[]>([]);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
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

  useEffect(() => { loadData(); }, []);

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

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Models</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage your in-browser model profiles</p>
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

        {/* Your Profiles */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-green-500" />
            <h2 className="text-sm font-semibold">Your Models</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 font-medium">
              No install needed
            </span>
          </div>

          {profiles.length === 0 ? (
            <EmptyState message="No models added yet. Pick from the catalog below to get started." />
          ) : (
            <div className="space-y-2">
              {profiles.map((profile) => (
                <ProfileCard key={profile.id} profile={profile} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </section>

        {/* Model Catalog */}
        <section>
          <div className="flex items-end justify-between mb-1 gap-3">
            <div>
              <h2 className="text-sm font-semibold">Model Catalog</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click Add to save a model to your profiles. The model file downloads when you first chat with it.
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
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-3 rounded-md border border-border"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold truncate">{m.label}</p>
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
              <Label className="text-xs">Browser Model</Label>
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

function ProfileCard({ profile, onEdit, onDelete }: { profile: ModelProfile; onEdit: (p: ModelProfile) => void; onDelete: (id: string) => void }) {
  return (
    <Card data-testid={`profile-card-${profile.id}`} className="py-0">
      <CardContent className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Globe className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <span className="text-sm font-medium">{profile.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${compatColors[profile.compatibility]}`}>
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
            <button onClick={() => onEdit(profile)} className="p-1.5 rounded-md hover:bg-muted transition-colors" data-testid={`btn-edit-${profile.id}`}>
              <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button onClick={() => onDelete(profile.id)} className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors" data-testid={`btn-delete-${profile.id}`}>
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 rounded-lg border border-dashed border-border">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
