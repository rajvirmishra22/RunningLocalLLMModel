import { useState } from "react";
import { Trash2, Shield, Info, HardDrive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { webllmService } from "@/services/webllmService";

export default function Settings() {
  const [modelUnloaded, setModelUnloaded] = useState(false);

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
                <p className="text-xs font-medium text-green-500">Privacy guarantee</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All conversations, model profiles, and downloaded model weights are stored locally in your browser.
                  No prompts, responses, or personal data are ever sent to external servers. No analytics. No telemetry.
                  The only network request is the one-time model weight download.
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
                Downloaded model files are cached by your browser. To free disk space, clear site data for this app
                in your browser settings.
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
