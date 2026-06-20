import { useState } from "react";
import {
  CheckCircle2,
  Cloud,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  School,
  Users,
  XCircle,
} from "lucide-react";
import {
  canvasListAssignments,
  canvasListCourses,
  canvasTestConnection,
} from "@workspace/api-client-react";
import type { CanvasAssignment, CanvasCourse } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import {
  GEMINI_MODEL_PRESETS,
  loadCloudConfig,
  saveCloudConfig,
  testProviderKey,
} from "@/services/cloudProviders";
import { detectAssignmentType } from "@/services/studycore/assignmentType";
import {
  assignmentStore,
  canvasConfigStore,
  courseStore,
  newId,
  nowIso,
} from "@/services/studycore/store";
import type { Assignment, CanvasConfig, Course } from "@/services/studycore/types";

const COURSE_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];

export default function Connections() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <header>
        <div className="flex items-center gap-2">
          <Link2 className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight" data-testid="page-connections">
            Connections
          </h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Link your school platforms and optional cloud AI providers. Your tokens and keys
          stay on this device.
        </p>
      </header>

      <CanvasCard />
      <Separator />
      <CloudProviderCard />
      <Separator />
      <TeamsCard />
    </div>
  );
}

function CanvasCard() {
  const { toast } = useToast();
  const existing = canvasConfigStore.get();
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "");
  const [token, setToken] = useState(existing?.token ?? "");
  const [userName, setUserName] = useState<string | null>(existing?.userName ?? null);
  const [connected, setConnected] = useState(existing?.connected ?? false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(existing?.lastSyncAt ?? null);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("");

  const normalizedBase = baseUrl.trim().replace(/\/$/, "");

  function persist(patch: Partial<CanvasConfig>) {
    canvasConfigStore.save({
      baseUrl: normalizedBase,
      token: token.trim(),
      connected,
      lastSyncAt,
      userName,
      ...patch,
    });
  }

  async function handleTest() {
    if (!normalizedBase || !token.trim()) {
      toast({ title: "Add your Canvas URL and token first", variant: "destructive" });
      return;
    }
    setTesting(true);
    try {
      const profile = await canvasTestConnection({ baseUrl: normalizedBase, token: token.trim() });
      setUserName(profile.name);
      setConnected(true);
      persist({ connected: true, userName: profile.name });
      toast({ title: `Connected as ${profile.name}` });
    } catch (err) {
      setConnected(false);
      persist({ connected: false });
      toast({
        title: "Couldn't connect to Canvas",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    if (!connected) {
      toast({ title: "Test the connection first", variant: "destructive" });
      return;
    }
    setSyncing(true);
    setSyncStatus("Fetching courses…");
    try {
      const auth = { baseUrl: normalizedBase, token: token.trim() };
      const courses: CanvasCourse[] = await canvasListCourses(auth);
      let courseCount = 0;
      let assignmentCount = 0;

      const existingCourses = courseStore.list();
      for (let i = 0; i < courses.length; i++) {
        const rc = courses[i];
        setSyncStatus(`Syncing ${rc.name} (${i + 1}/${courses.length})…`);
        const remoteId = String(rc.id);
        const prior = existingCourses.find(
          (c) => c.source === "canvas" && c.remoteId === remoteId,
        );
        const course: Course = {
          id: prior?.id ?? newId("course"),
          name: rc.name,
          source: "canvas",
          remoteId,
          term: rc.term ?? prior?.term,
          color: prior?.color ?? COURSE_COLORS[courseCount % COURSE_COLORS.length],
          currentGrade: prior?.currentGrade ?? null,
          letterGrade: prior?.letterGrade ?? null,
          createdAt: prior?.createdAt ?? nowIso(),
          updatedAt: nowIso(),
        };
        courseStore.save(course);
        courseCount++;

        let remoteAssignments: CanvasAssignment[] = [];
        try {
          remoteAssignments = await canvasListAssignments({ ...auth, courseId: remoteId });
        } catch {
          // Some courses block assignment listing; skip rather than fail the whole sync.
          continue;
        }
        const existingAssignments = assignmentStore.list();
        for (const ra of remoteAssignments) {
          const aRemoteId = String(ra.id);
          const priorA = existingAssignments.find(
            (a) => a.source === "canvas" && a.remoteId === aRemoteId,
          );
          const assignment: Assignment = {
            id: priorA?.id ?? newId("assign"),
            courseId: course.id,
            title: ra.name,
            instructions: ra.description ?? priorA?.instructions ?? "",
            dueDate: ra.dueAt ?? null,
            type: priorA?.type ?? detectAssignmentType(ra.name),
            typeAutoDetected: priorA?.typeAutoDetected ?? true,
            source: "canvas",
            remoteId: aRemoteId,
            status: priorA?.status ?? "not_started",
            pointsPossible: ra.pointsPossible ?? null,
            pointsEarned: priorA?.pointsEarned ?? null,
            gradePercent: priorA?.gradePercent ?? null,
            feedback: priorA?.feedback ?? null,
            difficulty: priorA?.difficulty ?? null,
            estimatedMinutes: priorA?.estimatedMinutes ?? null,
            externalUrl: ra.htmlUrl ?? null,
            createdAt: priorA?.createdAt ?? nowIso(),
            updatedAt: nowIso(),
          };
          assignmentStore.save(assignment);
          assignmentCount++;
        }
      }

      const syncedAt = nowIso();
      setLastSyncAt(syncedAt);
      persist({ lastSyncAt: syncedAt, connected: true });
      setSyncStatus("");
      toast({
        title: "Canvas sync complete",
        description: `${courseCount} course(s), ${assignmentCount} assignment(s) imported.`,
      });
    } catch (err) {
      setSyncStatus("");
      toast({
        title: "Canvas sync failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  function handleDisconnect() {
    canvasConfigStore.clear();
    setBaseUrl("");
    setToken("");
    setUserName(null);
    setConnected(false);
    setLastSyncAt(null);
    toast({ title: "Canvas disconnected", description: "Your token was removed from this device." });
  }

  return (
    <Card className="p-6 space-y-4" data-testid="card-canvas">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
            <School className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h2 className="font-semibold">Canvas</h2>
            <p className="text-xs text-muted-foreground">
              Sync courses and assignments with a personal access token.
            </p>
          </div>
        </div>
        {connected ? (
          <PrivacyBadge kind="canvas_synced" />
        ) : (
          <PrivacyBadge kind="not_included" label="Not connected" />
        )}
      </div>

      <div className="rounded-md bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
        Your token is stored only on this device and is sent through our proxy solely to reach
        Canvas (their API blocks direct browser calls). It is never saved on our servers.
      </div>

      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="canvas-url">Canvas URL</Label>
          <Input
            id="canvas-url"
            data-testid="input-canvas-url"
            placeholder="https://yourschool.instructure.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canvas-token">Access token</Label>
          <Input
            id="canvas-token"
            data-testid="input-canvas-token"
            type="password"
            placeholder="Account → Settings → New Access Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      </div>

      {userName && (
        <div className="flex items-center gap-2 text-sm text-green-500">
          <CheckCircle2 className="w-4 h-4" /> Connected as {userName}
          {lastSyncAt && (
            <span className="text-muted-foreground">
              · last sync {new Date(lastSyncAt).toLocaleString()}
            </span>
          )}
        </div>
      )}
      {syncStatus && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> {syncStatus}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleTest} disabled={testing} variant="secondary" data-testid="button-canvas-test">
          {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
          Test connection
        </Button>
        <Button onClick={handleSync} disabled={!connected || syncing} data-testid="button-canvas-sync">
          {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Sync now
        </Button>
        {connected && (
          <Button onClick={handleDisconnect} variant="ghost" data-testid="button-canvas-disconnect">
            Disconnect
          </Button>
        )}
      </div>
    </Card>
  );
}

function CloudProviderCard() {
  const provider = "gemini" as const;
  const { toast } = useToast();
  const cfg = loadCloudConfig();
  const presets = GEMINI_MODEL_PRESETS;
  const [key, setKey] = useState(cfg.geminiKey);
  const [model, setModel] = useState(cfg.geminiModel);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<"ok" | "fail" | null>(cfg.geminiKey ? "ok" : null);

  function save(nextKey: string, nextModel: string) {
    const current = loadCloudConfig();
    saveCloudConfig({ ...current, geminiKey: nextKey.trim(), geminiModel: nextModel });
  }

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const res = await testProviderKey(provider, key, model);
    setTesting(false);
    if (res.ok) {
      setResult("ok");
      save(key, model);
      toast({ title: "Gemini key works" });
    } else {
      setResult("fail");
      toast({ title: "Key test failed", description: res.error, variant: "destructive" });
    }
  }

  return (
    <Card className="p-6 space-y-4" data-testid={`card-${provider}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Cloud className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h2 className="font-semibold">Google Gemini</h2>
            <p className="text-xs text-muted-foreground">
              Optional. Bring your own free API key to use Gemini's cloud models.
            </p>
          </div>
        </div>
        {result === "ok" ? (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <CheckCircle2 className="w-4 h-4" /> Configured
          </span>
        ) : result === "fail" ? (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <XCircle className="w-4 h-4" /> Failed
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${provider}-key`}>API key</Label>
          <Input
            id={`${provider}-key`}
            data-testid={`input-${provider}-key`}
            type="password"
            placeholder="AIza…"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setResult(null);
            }}
            onBlur={() => save(key, model)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${provider}-model`}>Default model</Label>
          <Select
            value={model}
            onValueChange={(v) => {
              setModel(v);
              save(key, v);
            }}
          >
            <SelectTrigger id={`${provider}-model`} data-testid={`select-${provider}-model`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} — {p.note}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Get a free API key from{" "}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
        >
          aistudio.google.com/apikey
        </a>{" "}
        — no credit card needed for the free tier. Keys are stored locally in this browser.
      </p>

      <Button onClick={handleTest} disabled={testing} variant="secondary" data-testid={`button-${provider}-test`}>
        {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
        Test & save key
      </Button>
    </Card>
  );
}

function TeamsCard() {
  return (
    <Card className="p-6 space-y-3" data-testid="card-teams">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h2 className="font-semibold">Microsoft Teams</h2>
            <p className="text-xs text-muted-foreground">Manual import — no automatic sync.</p>
          </div>
        </div>
        <PrivacyBadge kind="not_included" label="Manual" />
      </div>
      <p className="text-sm text-muted-foreground">
        Teams doesn't offer a student-friendly personal token, so there's no automatic sync.
        Add Teams courses and assignments by hand on the Assignments page, or paste material
        text directly into an assignment. Everything you add stays on this device.
      </p>
    </Card>
  );
}
