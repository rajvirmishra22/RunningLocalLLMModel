import { useMemo, useState } from "react";
import {
  Library,
  Lock,
  FileText,
  Loader2,
  Trash2,
  Plus,
  ShieldCheck,
  Database,
  Sparkles,
  FolderOpen,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import { useToast } from "@/hooks/use-toast";
import {
  disable as disableLibrary,
  enable as enableLibrary,
  getSettings,
  indexableMaterials,
  indexCourse,
  isEnabled,
  saveSettings,
} from "@/services/studycore/courseLibrary";
import { courseStore, materialStore } from "@/services/studycore/store";
import { formatBytes } from "@/services/studycore/privacy";
import {
  deleteDocument,
  ensureReady,
  indexFile,
  listDocuments,
  type RagInitProgress,
} from "@/services/rag/rag";
import type { AssignmentMaterial, Course } from "@/services/studycore/types";

interface CourseGroup {
  courseId: string;
  course?: Course;
  materials: AssignmentMaterial[];
}

export default function CourseLibrary() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(isEnabled());
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  const refresh = () => setTick((t) => t + 1);

  const settings = useMemo(() => getSettings(), [tick, enabled]);

  const groups = useMemo<CourseGroup[]>(() => {
    void tick;
    const materials = indexableMaterials();
    const byCourse = new Map<string, AssignmentMaterial[]>();
    for (const m of materials) {
      const key = m.courseId ?? "__uncategorized__";
      if (!byCourse.has(key)) byCourse.set(key, []);
      byCourse.get(key)!.push(m);
    }
    return Array.from(byCourse.entries()).map(([courseId, mats]) => ({
      courseId,
      course: courseId === "__uncategorized__" ? undefined : courseStore.get(courseId),
      materials: mats,
    }));
  }, [tick]);

  const totalIndexed = useMemo(
    () => groups.reduce((n, g) => n + g.materials.filter((m) => m.indexedInCourseLibrary).length, 0),
    [groups],
  );
  const totalMaterials = useMemo(
    () => groups.reduce((n, g) => n + g.materials.length, 0),
    [groups],
  );

  // -- actions ---------------------------------------------------------------

  const handleEnable = () => {
    enableLibrary();
    setEnabled(true);
    refresh();
    toast({
      title: "Course Knowledge Base enabled",
      description: "It lives entirely on this device. Index materials below to let AI help cite them.",
    });
  };

  const onProgress = (p: RagInitProgress) => setProgress(p.text);

  const handleIndexCourse = async (courseId: string) => {
    setBusyId(`course:${courseId}`);
    setProgress("Preparing local index…");
    try {
      const count = await indexCourse(courseId, onProgress);
      refresh();
      toast({
        title: count > 0 ? "Materials indexed" : "Already up to date",
        description:
          count > 0
            ? `Indexed ${count} document${count === 1 ? "" : "s"} locally.`
            : "Every eligible material for this course is already indexed.",
      });
    } catch (e) {
      toast({
        title: "Indexing failed",
        description: e instanceof Error ? e.message : "Could not index these materials.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
      setProgress("");
    }
  };

  const handleIndexMaterial = async (material: AssignmentMaterial) => {
    setBusyId(`mat:${material.id}`);
    setProgress("Preparing local index…");
    try {
      await ensureReady(onProgress);
      await indexFile({ name: material.fileName, text: material.extractedText ?? "" }, onProgress);
      materialStore.save({ ...material, indexedInCourseLibrary: true });
      const s = getSettings();
      const indexedCourseIds = material.courseId
        ? Array.from(new Set([...s.indexedCourseIds, material.courseId]))
        : s.indexedCourseIds;
      saveSettings({ ...s, indexedCourseIds });
      refresh();
      toast({ title: "Indexed", description: `“${material.fileName}” is now searchable locally.` });
    } catch (e) {
      toast({
        title: "Indexing failed",
        description: e instanceof Error ? e.message : "Could not index this material.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
      setProgress("");
    }
  };

  const handleRemoveMaterial = async (material: AssignmentMaterial) => {
    setBusyId(`mat:${material.id}`);
    try {
      const docs = await listDocuments();
      const match = docs.find((d) => d.name === material.fileName);
      if (match) await deleteDocument(match.docId);
      materialStore.save({ ...material, indexedInCourseLibrary: false });

      // Drop the course from indexedCourseIds if it no longer has indexed materials.
      const s = getSettings();
      let indexedCourseIds = s.indexedCourseIds;
      if (material.courseId) {
        const stillIndexed = materialStore
          .listByCourse(material.courseId)
          .some((m) => m.id !== material.id && m.indexedInCourseLibrary);
        if (!stillIndexed) {
          indexedCourseIds = s.indexedCourseIds.filter((id) => id !== material.courseId);
        }
      }
      saveSettings({ ...s, indexedCourseIds });
      refresh();
      toast({ title: "Removed", description: `“${material.fileName}” is no longer indexed.` });
    } catch (e) {
      toast({
        title: "Could not remove",
        description: e instanceof Error ? e.message : "Failed to remove this material.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDisableAndClear = async () => {
    setBusyId("disable");
    try {
      const indexed = indexableMaterials().filter((m) => m.indexedInCourseLibrary);
      if (indexed.length > 0) {
        const docs = await listDocuments();
        const indexedNames = new Set(indexed.map((m) => m.fileName));
        for (const d of docs) {
          if (indexedNames.has(d.name)) {
            try {
              await deleteDocument(d.docId);
            } catch {
              // best-effort clear
            }
          }
        }
        for (const m of indexed) {
          materialStore.save({ ...m, indexedInCourseLibrary: false });
        }
      }
      disableLibrary();
      saveSettings({ ...getSettings(), indexedCourseIds: [] });
      setEnabled(false);
      refresh();
      toast({
        title: "Knowledge Base disabled",
        description: "Indexed excerpts were cleared from this device.",
      });
    } catch (e) {
      toast({
        title: "Could not disable cleanly",
        description: e instanceof Error ? e.message : "Some indexed data may remain.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  // -- render ----------------------------------------------------------------

  if (!enabled) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="page-library">
              <Library className="w-6 h-6 text-primary" />
              Course Knowledge Base
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              An optional, fully local index of your uploaded course materials so AI help can find
              and cite the right passages.
            </p>
          </div>
          <PrivacyBadge kind="local_only" />
        </header>

        <Card className="p-8 space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Off by default — turn it on when you want it</h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                When enabled, StudyCore splits your materials into small chunks and builds a search
                index <span className="font-medium text-foreground">on this device only</span>.
                Nothing is uploaded. AI help can then pull the most relevant excerpts so its answers
                stay grounded in your actual course content.
              </p>
            </div>
          </div>

          <Separator />

          <div className="grid sm:grid-cols-3 gap-4">
            <Explainer
              icon={Database}
              title="Indexed locally"
              body="Embeddings and text never leave your machine — the index lives in your browser storage."
            />
            <Explainer
              icon={Sparkles}
              title="Better, grounded answers"
              body="AI help cites the relevant pages from your materials instead of guessing."
            />
            <Explainer
              icon={ShieldCheck}
              title="You stay in control"
              body="Cloud requests never use the Knowledge Base. Disable any time to wipe the index."
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleEnable} data-testid="btn-enable-library" className="gap-2">
              <Plus className="w-4 h-4" />
              Enable Course Knowledge Base
            </Button>
            <span className="text-xs text-muted-foreground">No account, no upload, no cost.</span>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="page-library">
            <Library className="w-6 h-6 text-primary" />
            Course Knowledge Base
          </h1>
          <p className="text-muted-foreground mt-1">
            {totalIndexed} of {totalMaterials} material{totalMaterials === 1 ? "" : "s"} indexed ·{" "}
            {formatBytes(settings.localStorageUsedBytes)} on device
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PrivacyBadge kind="local_only" />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                data-testid="btn-disable-library"
                disabled={busyId !== null}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Disable &amp; clear
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disable the Course Knowledge Base?</AlertDialogTitle>
                <AlertDialogDescription>
                  This turns the feature off and removes all locally-indexed excerpts from this
                  device. Your original materials are not deleted — you can re-index them later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="btn-disable-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void handleDisableAndClear()}
                  data-testid="btn-disable-confirm"
                >
                  Disable &amp; clear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {progress && (
        <Card className="p-3 flex items-center gap-2 text-sm text-muted-foreground" data-testid="library-progress">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          {progress}
        </Card>
      )}

      {groups.length === 0 ? (
        <Card className="p-10 text-center space-y-2" data-testid="library-empty">
          <FolderOpen className="w-10 h-10 mx-auto opacity-30" />
          <p className="font-medium">No indexable materials yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Upload course files with extractable text to your assignments. Once they have readable
            text, they'll show up here ready to index.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const indexedCount = group.materials.filter((m) => m.indexedInCourseLibrary).length;
            const pending = group.materials.filter((m) => !m.indexedInCourseLibrary).length;
            const courseBusy = busyId === `course:${group.courseId}`;
            const courseColor = group.course?.color ?? "hsl(var(--primary))";
            return (
              <Card key={group.courseId} className="overflow-hidden" data-testid={`library-course-${group.courseId}`}>
                <div className="p-4 flex items-center gap-3 border-b border-border">
                  <div
                    className="w-1.5 h-10 rounded-full flex-shrink-0"
                    style={{ backgroundColor: courseColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">
                      {group.course?.name ?? "Uncategorized materials"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {indexedCount} of {group.materials.length} indexed
                    </div>
                  </div>
                  {group.course && pending > 0 && (
                    <Button
                      size="sm"
                      onClick={() => void handleIndexCourse(group.courseId)}
                      disabled={busyId !== null}
                      data-testid={`btn-index-course-${group.courseId}`}
                      className="gap-1.5"
                    >
                      {courseBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      Index all ({pending})
                    </Button>
                  )}
                </div>

                <div className="divide-y divide-border">
                  {group.materials.map((m) => {
                    const matBusy = busyId === `mat:${m.id}`;
                    return (
                      <div
                        key={m.id}
                        className="p-4 flex items-center gap-3"
                        data-testid={`library-material-${m.id}`}
                      >
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{m.fileName}</div>
                          <div className="text-xs text-muted-foreground">
                            {m.sizeBytes ? formatBytes(m.sizeBytes) : "Local file"}
                          </div>
                        </div>
                        {m.indexedInCourseLibrary ? (
                          <>
                            <Badge
                              variant="secondary"
                              className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
                              data-testid={`badge-indexed-${m.id}`}
                            >
                              Indexed
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleRemoveMaterial(m)}
                              disabled={busyId !== null}
                              data-testid={`btn-remove-material-${m.id}`}
                              className="gap-1.5 text-muted-foreground hover:text-destructive"
                            >
                              {matBusy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                              Remove
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleIndexMaterial(m)}
                            disabled={busyId !== null}
                            data-testid={`btn-index-material-${m.id}`}
                            className="gap-1.5"
                          >
                            {matBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Plus className="w-3.5 h-3.5" />
                            )}
                            Index
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3 h-3" />
        Everything here is processed and stored locally. Cloud AI requests never use the Knowledge
        Base.
      </p>
    </div>
  );
}

function Explainer({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Database;
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-1.5">
      <Icon className="w-5 h-5 text-primary" />
      <div className="font-medium text-sm">{title}</div>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
