import { useMemo, useRef, useState } from "react";
import {
  BookMarked,
  CheckCircle2,
  ChevronRight,
  Cloud,
  FileText,
  Loader2,
  ListChecks,
  Paperclip,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  getAvailableModelGroups,
  isCloudChoice,
  recommendedChoice,
  runHelp,
  type ModelChoice,
} from "@/services/studycore/aiRunner";
import { buildRubricPrompt, parseRubricReport, type ParsedRubric } from "@/services/studycore/rubric";
import { extractFile, FILE_INPUT_ACCEPT } from "@/services/fileExtractor";
import {
  assignmentStore,
  courseStore,
  newId,
  nowIso,
  rubricReportStore,
} from "@/services/studycore/store";
import { ASSIGNMENT_TYPE_LABELS } from "@/services/studycore/assignmentType";
import type {
  Assignment,
  Course,
  RubricAnalysisReport,
  RubricCriterionResult,
} from "@/services/studycore/types";

const CONFIDENCE_META: Record<
  NonNullable<RubricCriterionResult["confidence"]>,
  { label: string; className: string }
> = {
  high: { label: "High confidence", className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" },
  medium: { label: "Medium confidence", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  low: { label: "Low confidence", className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
  needs_review: { label: "Needs your review", className: "bg-muted text-muted-foreground border-border" },
};

function modelChoiceKey(c: ModelChoice): string {
  return c.kind === "local" ? `local:${c.modelId}` : `cloud:${c.provider}:${c.model}`;
}

export default function RubricChecker() {
  const { toast } = useToast();

  const courses = useMemo<Course[]>(() => courseStore.list(), []);
  const assignments = useMemo<Assignment[]>(() => assignmentStore.list(), []);
  const courseById = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.id, c] as const)),
    [courses],
  );

  const modelGroups = useMemo(() => getAvailableModelGroups(), []);
  const flatChoices = useMemo<ModelChoice[]>(() => {
    const out: ModelChoice[] = [];
    for (const g of modelGroups) {
      for (const m of g.models) {
        if (g.kind === "local") {
          out.push({ kind: "local", modelId: m.id, label: m.label });
        } else if (g.provider) {
          out.push({ kind: "cloud", provider: g.provider, model: m.id, label: m.label });
        }
      }
    }
    return out;
  }, [modelGroups]);

  const [choice, setChoice] = useState<ModelChoice | null>(() => recommendedChoice());

  // Inputs
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");
  const [rubricText, setRubricText] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftLabel, setDraftLabel] = useState("");

  const rubricFileRef = useRef<HTMLInputElement>(null);
  const draftFileRef = useRef<HTMLInputElement>(null);
  const [rubricFileName, setRubricFileName] = useState<string | null>(null);
  const [draftFileName, setDraftFileName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  // Run state
  const [running, setRunning] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ text: string; pct: number } | null>(null);
  const [rawOutput, setRawOutput] = useState("");
  const [parsed, setParsed] = useState<ParsedRubric | null>(null);
  const [usedChoice, setUsedChoice] = useState<ModelChoice | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cloud confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Saved reports
  const [reports, setReports] = useState<RubricAnalysisReport[]>(() => rubricReportStore.list());
  const refreshReports = () => setReports(rubricReportStore.list());

  const selectedChoiceKey = choice ? modelChoiceKey(choice) : "";
  const cloudSelected = choice ? isCloudChoice(choice) : false;
  const canRun = !running && !!choice && rubricText.trim().length > 0 && draftText.trim().length > 0;

  const onPickChoice = (key: string) => {
    const next = flatChoices.find((c) => modelChoiceKey(c) === key) ?? null;
    setChoice(next);
  };

  const handleFile = async (
    file: File | undefined,
    setText: (s: string) => void,
    setName: (s: string | null) => void,
  ) => {
    if (!file) return;
    setExtracting(true);
    try {
      const ex = await extractFile(file);
      setText(ex.text);
      setName(ex.name);
      toast({ title: "File loaded", description: `${ex.name} — ${ex.chars.toLocaleString()} characters extracted.` });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't read file",
        description: e instanceof Error ? e.message : "Unsupported file.",
      });
    } finally {
      setExtracting(false);
    }
  };

  const startRun = () => {
    if (!choice) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRawOutput("");
    setParsed(null);
    setLoadProgress(null);
    setUsedChoice(choice);

    const prompt = buildRubricPrompt(rubricText, draftText);
    let full = "";

    void runHelp({
      choice,
      prompt,
      actionType: "rubric_check",
      includedFiles: !!rubricFileName || !!draftFileName,
      temperature: 0.3,
      maxTokens: 2048,
      signal: controller.signal,
      onLoadProgress: (p) => setLoadProgress({ text: p.text, pct: Math.round(p.progress * 100) }),
      onToken: (t) => {
        full += t;
        setRawOutput(full);
      },
      onDone: () => {
        setLoadProgress(null);
        setRunning(false);
        abortRef.current = null;
        if (full.trim()) {
          setParsed(parseRubricReport(full));
        } else {
          toast({ variant: "destructive", title: "No output", description: "The model returned nothing. Try again." });
        }
      },
      onError: (err) => {
        setLoadProgress(null);
        setRunning(false);
        abortRef.current = null;
        toast({ variant: "destructive", title: "Check failed", description: err.message });
      },
    });
  };

  const handleRunClick = () => {
    if (!canRun) return;
    if (cloudSelected) {
      setConfirmOpen(true);
      return;
    }
    startRun();
  };

  const handleConfirmCloud = () => {
    setConfirmOpen(false);
    startRun();
  };

  const stopRun = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setLoadProgress(null);
    if (rawOutput.trim()) setParsed(parseRubricReport(rawOutput));
  };

  const toggleCriterion = (idx: number) => {
    setParsed((prev) => {
      if (!prev) return prev;
      const next = prev.criteriaResults.map((c, i) =>
        i === idx ? { ...c, completed: !c.completed } : c,
      );
      return { ...prev, criteriaResults: next };
    });
  };

  const saveReport = () => {
    if (!parsed || !usedChoice) return;
    const report: RubricAnalysisReport = {
      id: newId("rubric"),
      assignmentId: selectedAssignmentId || undefined,
      rubricMaterialId: rubricFileName ? `file:${rubricFileName}` : "inline_rubric",
      studentWorkMaterialId: draftFileName ? `file:${draftFileName}` : "inline_draft",
      generatedAt: nowIso(),
      generatedByModelId: usedChoice.kind === "local" ? usedChoice.modelId : usedChoice.model,
      processingType: usedChoice.kind === "local" ? "local" : "cloud",
      criteriaResults: parsed.criteriaResults,
      strengths: parsed.strengths,
      priorityRevisions: parsed.priorityRevisions,
      finalChecklist: parsed.finalChecklist,
      revisedOutline: parsed.revisedOutline,
      draftLabel: draftLabel.trim() || undefined,
    };
    rubricReportStore.save(report);
    refreshReports();
    toast({ title: "Report saved", description: "Find it under Saved reports below." });
  };

  const openReport = (r: RubricAnalysisReport) => {
    setParsed({
      criteriaResults: r.criteriaResults,
      strengths: r.strengths,
      priorityRevisions: r.priorityRevisions,
      finalChecklist: r.finalChecklist,
      revisedOutline: r.revisedOutline,
    });
    setUsedChoice(
      r.processingType === "local"
        ? { kind: "local", modelId: r.generatedByModelId, label: r.generatedByModelId }
        : { kind: "cloud", provider: "gemini", model: r.generatedByModelId, label: r.generatedByModelId },
    );
    setDraftLabel(r.draftLabel ?? "");
    setRawOutput("");
    setSelectedAssignmentId(r.assignmentId ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteReport = (id: string) => {
    rubricReportStore.remove(id);
    refreshReports();
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <input
        ref={rubricFileRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        className="hidden"
        data-testid="input-rubric-file"
        onChange={(e) => {
          void handleFile(e.target.files?.[0], setRubricText, setRubricFileName);
          if (rubricFileRef.current) rubricFileRef.current.value = "";
        }}
      />
      <input
        ref={draftFileRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        className="hidden"
        data-testid="input-draft-file"
        onChange={(e) => {
          void handleFile(e.target.files?.[0], setDraftText, setDraftFileName);
          if (draftFileRef.current) draftFileRef.current.value = "";
        }}
      />

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2" data-testid="page-rubric">
            <BookMarked className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Rubric Checker</h1>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Self-check a draft against a rubric and get criterion-by-criterion feedback before you
            submit. This is a study aid — it never grades officially and never submits anything for you.
          </p>
        </div>
        <PrivacyBadge kind={cloudSelected ? "cloud_processing" : "local_only"} />
      </header>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Rubric input */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Rubric</Label>
            <Button
              variant="outline"
              size="sm"
              disabled={extracting}
              onClick={() => rubricFileRef.current?.click()}
              data-testid="button-upload-rubric"
            >
              <Paperclip className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
          </div>
          {rubricFileName && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="w-3.5 h-3.5" />
              <span className="truncate">{rubricFileName}</span>
              <button
                className="ml-auto hover:text-foreground"
                onClick={() => {
                  setRubricFileName(null);
                  setRubricText("");
                }}
                data-testid="button-clear-rubric-file"
                aria-label="Clear rubric file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <Textarea
            value={rubricText}
            onChange={(e) => setRubricText(e.target.value)}
            placeholder="Paste the rubric criteria here (or upload a file). Include each criterion and what's expected for full marks."
            className="min-h-[220px] font-mono text-sm"
            data-testid="textarea-rubric"
          />
        </Card>

        {/* Draft input */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Your draft</Label>
            <Button
              variant="outline"
              size="sm"
              disabled={extracting}
              onClick={() => draftFileRef.current?.click()}
              data-testid="button-upload-draft"
            >
              <Paperclip className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
          </div>
          {draftFileName && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="w-3.5 h-3.5" />
              <span className="truncate">{draftFileName}</span>
              <button
                className="ml-auto hover:text-foreground"
                onClick={() => {
                  setDraftFileName(null);
                  setDraftText("");
                }}
                data-testid="button-clear-draft-file"
                aria-label="Clear draft file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <Textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Paste your current draft here (or upload a file). The more complete it is, the better the feedback."
            className="min-h-[220px] text-sm"
            data-testid="textarea-draft"
          />
        </Card>
      </div>

      {/* Options + run */}
      <Card className="p-5 space-y-4">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rubric-assignment">Link to assignment (optional)</Label>
            <Select
              value={selectedAssignmentId || "none"}
              onValueChange={(v) => setSelectedAssignmentId(v === "none" ? "" : v)}
            >
              <SelectTrigger id="rubric-assignment" data-testid="select-assignment">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {assignments.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.title}
                    {courseById[a.courseId] ? ` · ${courseById[a.courseId].name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rubric-draft-label">Draft label (optional)</Label>
            <Input
              id="rubric-draft-label"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="e.g. First draft"
              data-testid="input-draft-label"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rubric-model">Model</Label>
            <Select value={selectedChoiceKey} onValueChange={onPickChoice}>
              <SelectTrigger id="rubric-model" data-testid="select-model">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {modelGroups.map((g) => (
                  <SelectGroup key={`${g.kind}:${g.provider ?? "local"}`}>
                    <SelectLabel className="flex items-center gap-1.5">
                      {g.kind === "cloud" && <Cloud className="w-3.5 h-3.5" />}
                      {g.label}
                    </SelectLabel>
                    {g.models.map((m) => {
                      const c: ModelChoice =
                        g.kind === "local"
                          ? { kind: "local", modelId: m.id, label: m.label }
                          : { kind: "cloud", provider: g.provider!, model: m.id, label: m.label };
                      return (
                        <SelectItem key={modelChoiceKey(c)} value={modelChoiceKey(c)}>
                          {m.label}
                          {m.note ? ` · ${m.note}` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {cloudSelected && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <Cloud className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              This model runs in the cloud. Your rubric and draft text will be sent to the provider —
              you'll be asked to confirm before anything leaves your device.
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {running ? (
            <Button variant="destructive" onClick={stopRun} data-testid="button-stop">
              <Square className="w-4 h-4 mr-1.5" />
              Stop
            </Button>
          ) : (
            <Button onClick={handleRunClick} disabled={!canRun} data-testid="button-run-check">
              <Sparkles className="w-4 h-4 mr-1.5" />
              Check against rubric
            </Button>
          )}
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <TriangleAlert className="w-3.5 h-3.5" />
            Self-check only — nothing is submitted anywhere.
          </span>
        </div>

        {loadProgress && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {loadProgress.text}
            </div>
            <Progress value={loadProgress.pct} />
          </div>
        )}
      </Card>

      {/* Live raw output while streaming */}
      {running && rawOutput && (
        <Card className="p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="w-4 h-4 animate-spin" />
            Analyzing your draft…
          </div>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-auto" data-testid="text-raw-output">
            {rawOutput}
          </pre>
        </Card>
      )}

      {/* Parsed report */}
      {parsed && (
        <section className="space-y-5" data-testid="report-section">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-xl font-semibold">Feedback report</h2>
            <div className="flex items-center gap-2">
              {usedChoice && (
                <PrivacyBadge
                  kind={usedChoice.kind === "local" ? "local_only" : "cloud_processing"}
                  size="sm"
                />
              )}
              <Button variant="outline" size="sm" onClick={saveReport} data-testid="button-save-report">
                Save report
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <TriangleAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              This is AI-generated feedback to help you revise — it is not an official grade and may be
              wrong. Always use your own judgement and check with your instructor.
            </span>
          </div>

          {parsed.strengths.length > 0 && (
            <Card className="p-5 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Strengths
              </div>
              <ul className="space-y-1.5">
                {parsed.strengths.map((s, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <ChevronRight className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="space-y-4">
            {parsed.criteriaResults.map((c, idx) => {
              const conf = CONFIDENCE_META[c.confidence ?? "needs_review"];
              return (
                <Card
                  key={idx}
                  className={`p-5 space-y-3 ${c.completed ? "opacity-70" : ""}`}
                  data-testid={`criterion-${idx}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{c.criterionName}</h3>
                        <Badge variant="outline" className={conf.className}>
                          {conf.label}
                        </Badge>
                      </div>
                      {c.requirementSummary && (
                        <p className="text-sm text-muted-foreground">{c.requirementSummary}</p>
                      )}
                    </div>
                    <Button
                      variant={c.completed ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleCriterion(idx)}
                      data-testid={`button-toggle-criterion-${idx}`}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      {c.completed ? "Addressed" : "Mark done"}
                    </Button>
                  </div>

                  {c.evidenceFound.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-green-600 dark:text-green-400">
                        Evidence found
                      </div>
                      <ul className="space-y-1">
                        {c.evidenceFound.map((e, i) => (
                          <li key={i} className="text-sm flex gap-2">
                            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-green-500 flex-shrink-0" />
                            <span>{e}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {c.missingOrWeakElements.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        Missing or weak
                      </div>
                      <ul className="space-y-1">
                        {c.missingOrWeakElements.map((e, i) => (
                          <li key={i} className="text-sm flex gap-2">
                            <TriangleAlert className="w-3.5 h-3.5 mt-0.5 text-amber-500 flex-shrink-0" />
                            <span>{e}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {c.revisionSuggestions.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-primary">Suggestions</div>
                      <ul className="space-y-1">
                        {c.revisionSuggestions.map((e, i) => (
                          <li key={i} className="text-sm flex gap-2">
                            <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                            <span>{e}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {parsed.priorityRevisions.length > 0 && (
            <Card className="p-5 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <TriangleAlert className="w-4 h-4 text-amber-500" />
                Priority revisions
              </div>
              <ol className="space-y-1.5 list-decimal list-inside">
                {parsed.priorityRevisions.map((s, i) => (
                  <li key={i} className="text-sm">
                    {s}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {parsed.finalChecklist.length > 0 && (
            <Card className="p-5 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <ListChecks className="w-4 h-4 text-primary" />
                Final checklist before submitting
              </div>
              <ul className="space-y-1.5">
                {parsed.finalChecklist.map((s, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {parsed.revisedOutline && (
            <Card className="p-5 space-y-2">
              <div className="font-medium">Suggested revision plan</div>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{parsed.revisedOutline}</p>
            </Card>
          )}
        </section>
      )}

      {/* Saved reports */}
      <section className="space-y-3">
        <Separator />
        <h2 className="text-lg font-semibold">Saved reports</h2>
        {reports.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground" data-testid="empty-reports">
            No saved reports yet. Run a check above and save it to keep it here.
          </Card>
        ) : (
          <div className="space-y-2">
            {reports
              .slice()
              .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
              .map((r) => {
                const assignment = r.assignmentId ? assignmentStore.get(r.assignmentId) : undefined;
                return (
                  <Card
                    key={r.id}
                    className="p-4 flex items-center gap-3"
                    data-testid={`saved-report-${r.id}`}
                  >
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <BookMarked className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {r.draftLabel ||
                          (assignment
                            ? `${assignment.title} (${ASSIGNMENT_TYPE_LABELS[assignment.type]})`
                            : "Rubric check")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.generatedAt).toLocaleString()} · {r.criteriaResults.length} criteria ·{" "}
                        {r.processingType === "local" ? "On-device" : "Cloud"}
                      </div>
                    </div>
                    <PrivacyBadge
                      kind={r.processingType === "local" ? "local_only" : "cloud_processing"}
                      size="sm"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openReport(r)}
                      data-testid={`button-open-report-${r.id}`}
                    >
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteReport(r.id)}
                      data-testid={`button-delete-report-${r.id}`}
                      aria-label="Delete report"
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </Card>
                );
              })}
          </div>
        )}
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-cloud-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5 text-amber-500" />
              Send to cloud model?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  You picked <span className="font-medium text-foreground">{choice?.label}</span>, which
                  runs in the cloud. The following will be sent to the provider:
                </p>
                <ul className="space-y-1 text-sm">
                  <li className="flex gap-2">
                    <ChevronRight className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    Your rubric text{rubricFileName ? ` (from ${rubricFileName})` : ""}
                  </li>
                  <li className="flex gap-2">
                    <ChevronRight className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    Your draft text{draftFileName ? ` (from ${draftFileName})` : ""}
                  </li>
                </ul>
                <p className="text-xs">
                  Choose an on-device model instead to keep everything local. This action only ever
                  produces feedback — it never submits your work anywhere.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-cloud">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCloud} data-testid="button-confirm-cloud">
              Send &amp; check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
