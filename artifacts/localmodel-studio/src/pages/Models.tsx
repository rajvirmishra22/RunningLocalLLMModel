import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, AlertCircle, Globe } from "lucide-react";
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
import { webllmService, WEBLLM_MODELS } from "@/services/webllmService";

const EMPTY_PROFILE: Omit<ModelProfile, "id"> = {
  name: "",
  runtimeType: "webllm",
  modelIdentifier: "",
  contextLength: 4096,
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 2048,
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
  const webgpuAvailable = webllmService.checkWebGPU();

  const loadData = () => {
    setProfiles(storageService.getModelProfiles());
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

  const addWebLLMModel = (model: typeof WEBLLM_MODELS[0]) => {
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
          <h2 className="text-sm font-semibold mb-1">Model Catalog</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Click Add to save a model to your profiles. The model file downloads when you first chat with it.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {WEBLLM_MODELS.map((m) => {
              const added = profiles.some((p) => p.modelIdentifier === m.id);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-3 rounded-md border border-border"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">{m.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{(m.sizeMb / 1000).toFixed(1)} GB · {m.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={added ? "outline" : "default"}
                    className="h-7 text-[11px] px-2.5 flex-shrink-0 ml-2"
                    disabled={added}
                    onClick={() => addWebLLMModel(m)}
                    data-testid={`btn-add-webllm-${m.id}`}
                  >
                    {added ? "Added" : "Add"}
                  </Button>
                </div>
              );
            })}
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
              <Label className="text-xs">Browser Model</Label>
              <Select value={form.modelIdentifier} onValueChange={(v) => setForm({ ...form, modelIdentifier: v })}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-webllm-model">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {WEBLLM_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label} ({(m.sizeMb / 1000).toFixed(1)} GB)
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 rounded-lg border border-dashed border-border">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
