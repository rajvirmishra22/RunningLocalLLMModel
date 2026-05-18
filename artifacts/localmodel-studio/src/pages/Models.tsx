import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { ollamaService, OllamaModel } from "@/services/ollamaService";

const EMPTY_PROFILE: Omit<ModelProfile, "id"> = {
  name: "",
  runtimeType: "ollama",
  modelIdentifier: "",
  contextLength: 4096,
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 2048,
  gpuLayers: 0,
  compatibility: "supported",
};

const compatColors: Record<string, string> = {
  supported: "bg-green-500/10 text-green-500 border-green-500/20",
  experimental: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  unsupported: "bg-red-500/10 text-red-500 border-red-500/20",
};

const runtimeColors: Record<string, string> = {
  ollama: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  llamacpp: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  transformers: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

export default function Models() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaError, setOllamaError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [form, setForm] = useState<Omit<ModelProfile, "id">>(EMPTY_PROFILE);
  const [ollamaAddInput, setOllamaAddInput] = useState("");
  const [showOllamaAdd, setShowOllamaAdd] = useState(false);

  const settings = storageService.getSettings();

  const loadData = () => {
    setProfiles(storageService.getModelProfiles());
    ollamaService.listOllamaModels(settings.ollamaUrl).then((models) => {
      if (models.length > 0) {
        setOllamaModels(models);
        setOllamaError(false);
      } else {
        setOllamaError(true);
      }
    });
  };

  useEffect(() => { loadData(); }, []);

  const openAdd = () => {
    setEditingProfile(null);
    setForm(EMPTY_PROFILE);
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

  const handleAddOllamaByName = () => {
    if (!ollamaAddInput.trim()) return;
    const profile: ModelProfile = {
      id: `profile_${Date.now()}`,
      name: ollamaAddInput.trim(),
      runtimeType: "ollama",
      modelIdentifier: ollamaAddInput.trim(),
      contextLength: 4096,
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      compatibility: "supported",
    };
    storageService.saveModelProfile(profile);
    setOllamaAddInput("");
    setShowOllamaAdd(false);
    loadData();
  };

  const ollamaProfiles = profiles.filter((p) => p.runtimeType === "ollama");
  const localProfiles = profiles.filter((p) => p.runtimeType !== "ollama");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Models</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage your model profiles</p>
          </div>
          <Button size="sm" onClick={openAdd} data-testid="btn-add-profile" className="gap-2">
            <Plus className="w-3.5 h-3.5" />
            Add Profile
          </Button>
        </div>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Ollama Models</h2>
            <button
              onClick={() => setShowOllamaAdd(!showOllamaAdd)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="btn-toggle-ollama-add"
            >
              Add by name
              {showOllamaAdd ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {showOllamaAdd && (
            <div className="flex gap-2 mb-3" data-testid="ollama-add-form">
              <Input
                value={ollamaAddInput}
                onChange={(e) => setOllamaAddInput(e.target.value)}
                placeholder="e.g. llama3.2:1b"
                className="font-mono text-sm h-8"
                data-testid="input-ollama-model-name"
                onKeyDown={(e) => e.key === "Enter" && handleAddOllamaByName()}
              />
              <Button size="sm" onClick={handleAddOllamaByName} data-testid="btn-confirm-add-ollama">
                Add
              </Button>
            </div>
          )}

          {ollamaError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border mb-3">
              <AlertCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Ollama isn't reachable. Installed model list unavailable.{" "}
                <a href="/" className="underline">Check setup</a>
              </p>
            </div>
          )}

          {ollamaModels.length > 0 && (
            <div className="mb-3 space-y-1.5">
              <p className="text-xs text-muted-foreground mb-2">Installed in Ollama:</p>
              {ollamaModels.map((m) => (
                <div
                  key={m.name}
                  data-testid={`ollama-installed-${m.name}`}
                  className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/40 border border-border/50"
                >
                  <span className="text-xs font-mono font-medium">{m.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {(m.size / 1e9).toFixed(1)} GB
                  </span>
                </div>
              ))}
            </div>
          )}

          {ollamaProfiles.length === 0 ? (
            <EmptyState message="No Ollama profiles yet. Add one above or click Add Profile." />
          ) : (
            <div className="space-y-2">
              {ollamaProfiles.map((profile) => (
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

        <section>
          <h2 className="text-sm font-semibold mb-3">GGUF / Local Models</h2>
          {localProfiles.length === 0 ? (
            <EmptyState message="No local model profiles yet. Click Add Profile and choose llama.cpp." />
          ) : (
            <div className="space-y-2">
              {localProfiles.map((profile) => (
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
              <Label className="text-xs">Runtime</Label>
              <Select
                value={form.runtimeType}
                onValueChange={(v) => setForm({ ...form, runtimeType: v as ModelProfile["runtimeType"] })}
              >
                <SelectTrigger className="h-8 text-sm" data-testid="select-runtime">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="llamacpp">llama.cpp</SelectItem>
                  <SelectItem value="transformers">Transformers.js</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                {form.runtimeType === "ollama" ? "Ollama Model Name" : "GGUF File Path"}
              </Label>
              <Input
                value={form.modelIdentifier}
                onChange={(e) => setForm({ ...form, modelIdentifier: e.target.value })}
                placeholder={form.runtimeType === "ollama" ? "llama3.2:1b" : "/path/to/model.gguf"}
                className="h-8 text-sm font-mono"
                data-testid="input-model-identifier"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Context Length</Label>
                <Input
                  type="number"
                  value={form.contextLength}
                  onChange={(e) => setForm({ ...form, contextLength: Number(e.target.value) })}
                  className="h-8 text-sm"
                  data-testid="input-context-length"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max Tokens</Label>
                <Input
                  type="number"
                  value={form.maxTokens}
                  onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
                  className="h-8 text-sm"
                  data-testid="input-max-tokens"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Temperature</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                  className="h-8 text-sm"
                  data-testid="input-temperature"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Top P</Label>
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={form.topP}
                  onChange={(e) => setForm({ ...form, topP: Number(e.target.value) })}
                  className="h-8 text-sm"
                  data-testid="input-top-p"
                />
              </div>
            </div>

            {form.runtimeType === "llamacpp" && (
              <div className="space-y-1.5">
                <Label className="text-xs">GPU Layers</Label>
                <Input
                  type="number"
                  value={form.gpuLayers ?? 0}
                  onChange={(e) => setForm({ ...form, gpuLayers: Number(e.target.value) })}
                  className="h-8 text-sm"
                  data-testid="input-gpu-layers"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Compatibility</Label>
              <Select
                value={form.compatibility}
                onValueChange={(v) => setForm({ ...form, compatibility: v as ModelProfile["compatibility"] })}
              >
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
            <Button size="sm" onClick={handleSave} data-testid="btn-save-profile">Save Profile</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
              <span className="text-sm font-medium">{profile.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${runtimeColors[profile.runtimeType]}`}>
                {profile.runtimeType === "llamacpp" ? "llama.cpp" : profile.runtimeType}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${compatColors[profile.compatibility]}`}>
                {profile.compatibility}
              </span>
            </div>
            <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{profile.modelIdentifier}</p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <StatChip label="ctx" value={`${profile.contextLength}`} />
              <StatChip label="temp" value={`${profile.temperature}`} />
              <StatChip label="max_t" value={`${profile.maxTokens}`} />
              {profile.runtimeType === "llamacpp" && profile.gpuLayers !== undefined && (
                <StatChip label="gpu_layers" value={`${profile.gpuLayers}`} />
              )}
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
      <span className="text-muted-foreground/60">{label}=</span>{value}
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
