import { useState } from "react";
import { CheckCircle, XCircle, Loader2, Trash2, Shield, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { storageService, AppSettings } from "@/services/storageService";
import { ollamaService } from "@/services/ollamaService";

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(() => storageService.getSettings());
  const [ollamaTestStatus, setOllamaTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storageService.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testOllama = async () => {
    setOllamaTestStatus("testing");
    const ok = await ollamaService.checkOllamaStatus(settings.ollamaUrl);
    setOllamaTestStatus(ok ? "ok" : "fail");
  };

  const clearConversations = () => {
    localStorage.removeItem("lms_conversations");
  };

  const clearProfiles = () => {
    localStorage.removeItem("lms_model_profiles");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure inference servers and app preferences</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Inference Servers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Ollama Server URL</Label>
              <div className="flex gap-2">
                <Input
                  value={settings.ollamaUrl}
                  onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="h-8 text-sm font-mono flex-1"
                  data-testid="input-ollama-url"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={testOllama}
                  disabled={ollamaTestStatus === "testing"}
                  data-testid="btn-test-ollama"
                  className="gap-1.5"
                >
                  {ollamaTestStatus === "testing" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : ollamaTestStatus === "ok" ? (
                    <CheckCircle className="w-3 h-3 text-green-500" />
                  ) : ollamaTestStatus === "fail" ? (
                    <XCircle className="w-3 h-3 text-destructive" />
                  ) : null}
                  Test
                </Button>
              </div>
              {ollamaTestStatus === "ok" && (
                <p className="text-xs text-green-500" data-testid="ollama-test-success">Connection successful</p>
              )}
              {ollamaTestStatus === "fail" && (
                <p className="text-xs text-destructive" data-testid="ollama-test-fail">
                  Cannot connect. Make sure Ollama is running and <code className="font-mono text-[11px]">OLLAMA_ORIGINS=*</code> is set.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">llama-server Base URL</Label>
              <Input
                value={settings.llamaServerUrl}
                onChange={(e) => setSettings({ ...settings, llamaServerUrl: e.target.value })}
                placeholder="http://localhost:8080"
                className="h-8 text-sm font-mono"
                data-testid="input-llama-server-url"
              />
              <p className="text-[11px] text-muted-foreground">
                Start llama-server manually with your GGUF file, then point this URL to it.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Privacy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Online Model Discovery</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Allow fetching model lists from external sources
                </p>
              </div>
              <Switch
                checked={settings.modelDiscoveryEnabled}
                onCheckedChange={(v) => setSettings({ ...settings, modelDiscoveryEnabled: v })}
                data-testid="switch-model-discovery"
              />
            </div>

            {settings.modelDiscoveryEnabled && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                <Info className="w-3.5 h-3.5 text-yellow-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-yellow-500">
                  Model discovery makes external network requests. Your IP may be visible to the discovery server.
                </p>
              </div>
            )}

            <div className="flex items-start gap-3 p-3 rounded-md bg-green-500/10 border border-green-500/20">
              <Shield className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-green-500">Privacy guarantee</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All conversations and model profiles are stored locally in your browser. No prompts, responses, or
                  personal data are ever sent to external servers. No analytics. No telemetry.
                </p>
              </div>
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
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">LocalModel Studio v0.1.0</p>
          <Button size="sm" onClick={handleSave} data-testid="btn-save-settings">
            {saved ? "Saved" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
