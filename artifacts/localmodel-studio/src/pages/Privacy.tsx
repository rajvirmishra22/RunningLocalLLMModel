import { useState } from "react";
import {
  AlertTriangle,
  Cloud,
  Database,
  FileText,
  HardDrive,
  Lock,
  MessageSquare,
  Shield,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import {
  LOCKED_CLOUD_PROTECTIONS,
  PROCESSING_ACTION_LABELS,
  deleteAllAcademicData,
  deleteAllMaterials,
  deleteApiCredentials,
  deleteCachedFeedback,
  deleteCachedGrades,
  deleteCanvasData,
  deleteRubricReports,
  deleteSavedChats,
  deleteStudyPlans,
  clearProcessingHistory,
  formatBytes,
  storageSummary,
} from "@/services/studycore/privacy";
import { processingHistoryStore } from "@/services/studycore/store";

interface DeleteAction {
  id: string;
  label: string;
  description: string;
  run: () => void | Promise<void>;
}

export default function Privacy() {
  const { toast } = useToast();
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const summary = storageSummary();
  const history = processingHistoryStore.list().slice().reverse();
  const [pending, setPending] = useState<DeleteAction | null>(null);

  const deleteActions: DeleteAction[] = [
    {
      id: "grades",
      label: "Cached grades",
      description: "Clears earned points and percentages from synced assignments.",
      run: deleteCachedGrades,
    },
    {
      id: "feedback",
      label: "Teacher feedback",
      description: "Removes any stored teacher feedback text.",
      run: deleteCachedFeedback,
    },
    {
      id: "materials",
      label: "All materials",
      description: "Deletes every uploaded/extracted file and its text.",
      run: deleteAllMaterials,
    },
    {
      id: "chats",
      label: "Saved chats",
      description: "Deletes all Study Space conversations.",
      run: deleteSavedChats,
    },
    {
      id: "rubrics",
      label: "Rubric reports",
      description: "Deletes every saved rubric analysis.",
      run: deleteRubricReports,
    },
    {
      id: "plans",
      label: "Study plans",
      description: "Deletes generated study plans.",
      run: deleteStudyPlans,
    },
    {
      id: "history",
      label: "Processing history",
      description: "Clears the AI processing log below.",
      run: clearProcessingHistory,
    },
    {
      id: "keys",
      label: "API credentials",
      description: "Removes your saved Gemini API key.",
      run: deleteApiCredentials,
    },
    {
      id: "canvas",
      label: "Canvas connection",
      description: "Removes your Canvas URL and token.",
      run: deleteCanvasData,
    },
  ];

  async function confirmDelete() {
    if (!pending) return;
    try {
      await pending.run();
      toast({ title: `Deleted: ${pending.label}` });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setPending(null);
      refresh();
    }
  }

  const nukeAction: DeleteAction = {
    id: "all",
    label: "ALL local academic data",
    description:
      "Permanently erases every course, assignment, material, grade, plan, report, chat, the Course Knowledge Base, API keys and the Canvas connection. This cannot be undone.",
    run: deleteAllAcademicData,
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="page-privacy">
              Privacy Center
            </h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Everything runs locally by default. Here's exactly what's stored and what has ever
            touched a model.
          </p>
        </div>
        <PrivacyBadge kind="local_only" />
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryStat icon={FileText} label="Files" value={`${summary.cachedFileCount}`} sub={formatBytes(summary.cachedFileBytes)} />
        <SummaryStat icon={MessageSquare} label="Chats" value={`${summary.conversationCount}`} sub={formatBytes(summary.conversationBytes)} />
        <SummaryStat icon={Database} label="Reports & plans" value={`${summary.rubricReportCount + summary.studyPlanCount}`} sub={`${summary.rubricReportCount} rubric · ${summary.studyPlanCount} plan`} />
        <SummaryStat icon={Cloud} label="Cloud calls (mo.)" value={`${summary.cloudRequestsThisMonth}`} sub={`${summary.processingEntries} logged total`} />
      </section>

      <Card className="p-5 space-y-3" data-testid="card-locked-protections">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-green-500" />
          <h2 className="font-semibold">Always-on protections</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          These can't be turned off. Cloud AI is always opt-in, per request.
        </p>
        <ul className="space-y-1.5">
          {LOCKED_CLOUD_PROTECTIONS.map((p) => (
            <li key={p} className="flex items-center gap-2 text-sm">
              <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
              {p}
            </li>
          ))}
        </ul>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">AI processing history</h2>
        <p className="text-sm text-muted-foreground">
          Metadata only — we record what ran, never the content of your prompts.
        </p>
        {history.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            Nothing has been processed yet.
          </Card>
        ) : (
          <Card className="divide-y divide-border">
            {history.slice(0, 50).map((e) => (
              <div key={e.id} className="flex items-center gap-3 p-3" data-testid={`history-${e.id}`}>
                <PrivacyBadge
                  kind={e.processingType === "cloud" ? "cloud_processing" : "local_only"}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {PROCESSING_ACTION_LABELS[e.actionType]} · {e.modelId}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.timestamp).toLocaleString()}
                    {e.includedFiles && " · included files"}
                    {e.includedCourseLibraryExcerpts && " · included KB excerpts"}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Delete data</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {deleteActions.map((a) => (
            <Card key={a.id} className="p-4 flex items-start gap-3" data-testid={`delete-${a.id}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{a.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{a.description}</div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive flex-shrink-0"
                onClick={() => setPending(a)}
                data-testid={`button-delete-${a.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <Card className="p-5 border-destructive/40 bg-destructive/5 space-y-3" data-testid="card-nuke">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <h2 className="font-semibold text-destructive">Danger zone</h2>
        </div>
        <p className="text-sm text-muted-foreground">{nukeAction.description}</p>
        <Button variant="destructive" onClick={() => setPending(nukeAction)} data-testid="button-delete-all">
          <Trash2 className="w-4 h-4 mr-2" /> Delete all local academic data
        </Button>
      </Card>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pending?.label}?</AlertDialogTitle>
            <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof HardDrive;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="p-4" data-testid={`summary-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <Icon className="w-5 h-5 text-muted-foreground mb-2" />
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </Card>
  );
}
