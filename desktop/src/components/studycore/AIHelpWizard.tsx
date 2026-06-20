import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  FileText,
  Loader2,
  Lock,
  Save,
  Shield,
  Sparkles,
  Square,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import {
  HELP_MODE_LABELS,
  allowedModesFor,
  buildAssignmentContext,
  type HelpMode,
} from "@/services/studycore/aiContext";
import {
  getAvailableModelGroups,
  isCloudChoice,
  recommendedChoice,
  runHelp,
  type ModelChoice,
} from "@/services/studycore/aiRunner";
import { isAssessment } from "@/services/studycore/assignmentType";
import { isEnabled as kbEnabled } from "@/services/studycore/courseLibrary";
import { listDocuments, retrieveForQuery } from "@/services/rag/rag";
import type { RetrievedChunk } from "@/services/rag/rag";
import { materialStore, newId, nowIso } from "@/services/studycore/store";
import type { Assignment, AssignmentMaterial, Course } from "@/services/studycore/types";

interface AIHelpWizardProps {
  assignment: Assignment;
  course?: Course;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const STEP_TITLES = [
  "How can I help?",
  "Include materials",
  "What to send",
  "Your question",
  "Choose a model",
  "Review & run",
];

export function AIHelpWizard({ assignment, course, open, onOpenChange, onSaved }: AIHelpWizardProps) {
  const { toast } = useToast();
  const assessment = isAssessment(assignment.type);
  const modes = allowedModesFor(assignment);
  const allMaterials = useMemo(
    () => materialStore.list().filter((m) => m.assignmentId === assignment.id),
    [assignment.id, open],
  );

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<HelpMode>(modes[0]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>(
    allMaterials.filter((m) => m.includedInCurrentAIContext).map((m) => m.id),
  );
  const [includeInstructions, setIncludeInstructions] = useState(true);
  const [includeFeedback, setIncludeFeedback] = useState(!!assignment.feedback);
  const [useKb, setUseKb] = useState(false);
  const [userPrompt, setUserPrompt] = useState("");
  const [choice, setChoice] = useState<ModelChoice | null>(recommendedChoice());

  const [running, setRunning] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [output, setOutput] = useState("");
  const [cloudConfirmed, setCloudConfirmed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const modelGroups = useMemo(() => getAvailableModelGroups(), [open]);
  const selectedMaterials = allMaterials.filter((m) => selectedMaterialIds.includes(m.id));

  function reset() {
    setStep(0);
    setMode(modes[0]);
    setSelectedMaterialIds(
      materialStore
        .list()
        .filter((m) => m.assignmentId === assignment.id && m.includedInCurrentAIContext)
        .map((m) => m.id),
    );
    setIncludeInstructions(true);
    setIncludeFeedback(!!assignment.feedback);
    setUseKb(false);
    setChoice(recommendedChoice());
    setUserPrompt("");
    setOutput("");
    setRunning(false);
    setLoadProgress(null);
    setCloudConfirmed(false);
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function close() {
    abortRef.current?.abort();
    onOpenChange(false);
    setTimeout(reset, 200);
  }

  function toggleMaterial(id: string) {
    setSelectedMaterialIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function run() {
    if (!choice) {
      toast({ title: "Pick a model first", variant: "destructive" });
      return;
    }
    const isCloud = isCloudChoice(choice);
    if (isCloud && !cloudConfirmed) {
      toast({ title: "Confirm the cloud request first", variant: "destructive" });
      return;
    }

    setRunning(true);
    setOutput("");
    setLoadProgress(null);

    let ragChunks: RetrievedChunk[] = [];
    if (useKb && kbEnabled() && !isCloud) {
      try {
        const docs = await listDocuments();
        ragChunks = await retrieveForQuery(
          docs.map((d) => d.docId),
          userPrompt || assignment.title,
        );
      } catch {
        /* KB retrieval is best-effort; continue without it */
      }
    }

    const built = buildAssignmentContext({
      assignment,
      course,
      mode,
      materials: selectedMaterials,
      includeInstructions,
      includeFeedback,
      ragChunks,
      userPrompt,
    });

    const ac = new AbortController();
    abortRef.current = ac;

    await runHelp({
      choice,
      prompt: built.prompt,
      actionType: "assignment_help",
      includedFiles: built.includedFiles,
      includedCourseLibraryExcerpts: built.includedCourseLibraryExcerpts,
      onToken: (t) => setOutput((o) => o + t),
      onDone: () => {
        setRunning(false);
        setLoadProgress(null);
      },
      onError: (e) => {
        setRunning(false);
        setLoadProgress(null);
        toast({ title: "AI request failed", description: e.message, variant: "destructive" });
      },
      onLoadProgress: (p) => setLoadProgress(p.progress),
      signal: ac.signal,
    });
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    setLoadProgress(null);
  }

  function saveAsMaterial() {
    const kindMap: Record<HelpMode, AssignmentMaterial["generatedKind"]> = {
      study_guide: "study_guide",
      explain: "summary",
      brainstorm: "outline",
      outline: "outline",
      feedback: "summary",
      check_understanding: "practice_questions",
    };
    const material: AssignmentMaterial = {
      id: newId("mat"),
      assignmentId: assignment.id,
      courseId: assignment.courseId,
      source: "ai_generated",
      fileName: `${HELP_MODE_LABELS[mode]} — ${new Date().toLocaleDateString()}`,
      fileType: "text/markdown",
      extractedTextAvailable: true,
      indexedInCourseLibrary: false,
      includedInCurrentAIContext: false,
      createdAt: nowIso(),
      generatedKind: kindMap[mode],
      content: output,
      extractedText: output,
      sizeBytes: new Blob([output]).size,
    };
    materialStore.save(material);
    toast({ title: "Saved to materials" });
    onSaved();
    close();
  }

  const isCloud = choice ? isCloudChoice(choice) : false;
  const canNext =
    step === 3 ? userPrompt.trim().length > 0 : step === 4 ? choice !== null : true;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="ai-help-wizard">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Get AI Help
          </DialogTitle>
          <DialogDescription>
            Step {step + 1} of 6 · {STEP_TITLES[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5 mb-2">
          {STEP_TITLES.map((_, i) => (
            <div
              key={i}
              className={
                "h-1 flex-1 rounded-full " + (i <= step ? "bg-primary" : "bg-muted")
              }
            />
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3">
            {assessment && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <Lock className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <span>
                  This is a graded <strong>assessment</strong>. AI Help is limited to study and
                  comprehension — it won't produce answers you'd submit.
                </span>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-2">
              {modes.map((m) => (
                <button
                  key={m}
                  data-testid={`mode-${m}`}
                  onClick={() => setMode(m)}
                  className={
                    "text-left p-3 rounded-md border transition-colors " +
                    (mode === m
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40")
                  }
                >
                  <span className="font-medium text-sm">{HELP_MODE_LABELS[m]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2">
            {allMaterials.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No materials attached to this assignment. You can still get help from the
                instructions and your question.
              </p>
            ) : (
              allMaterials.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-3 p-3 rounded-md border border-border cursor-pointer hover:bg-muted/50"
                  data-testid={`wizard-material-${m.id}`}
                >
                  <Checkbox
                    checked={selectedMaterialIds.includes(m.id)}
                    onCheckedChange={() => toggleMaterial(m.id)}
                  />
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{m.fileName}</div>
                    {!m.extractedText && (
                      <div className="text-xs text-muted-foreground">No extractable text</div>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <ToggleRow
              testid="toggle-instructions"
              label="Assignment instructions"
              disabled={!assignment.instructions.trim()}
              checked={includeInstructions && !!assignment.instructions.trim()}
              onChange={setIncludeInstructions}
            />
            <ToggleRow
              testid="toggle-feedback"
              label="Teacher feedback"
              disabled={!assignment.feedback?.trim()}
              checked={includeFeedback && !!assignment.feedback?.trim()}
              onChange={setIncludeFeedback}
            />
            <ToggleRow
              testid="toggle-kb"
              label="Course Knowledge Base excerpts"
              disabled={!kbEnabled()}
              checked={useKb && kbEnabled()}
              onChange={setUseKb}
              note={
                !kbEnabled()
                  ? "Enable the Course Library to use this."
                  : isCloud
                    ? "KB excerpts are only used with local models."
                    : undefined
              }
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            <Label htmlFor="user-prompt">What do you want help with?</Label>
            <Textarea
              id="user-prompt"
              data-testid="input-user-prompt"
              rows={5}
              placeholder="e.g. Help me understand the key themes I should study for this."
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            {modelGroups.map((g) => (
              <div key={g.label}>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  {g.kind === "cloud" ? (
                    <Cloud className="w-3.5 h-3.5" />
                  ) : (
                    <Shield className="w-3.5 h-3.5" />
                  )}
                  {g.label}
                </div>
                <div className="grid gap-1.5">
                  {g.models.map((m) => {
                    const selected =
                      choice?.kind === g.kind &&
                      (g.kind === "local"
                        ? (choice as { modelId: string }).modelId === m.id
                        : (choice as { model: string }).model === m.id);
                    return (
                      <button
                        key={`${g.label}-${m.id}`}
                        data-testid={`model-${m.id}`}
                        onClick={() =>
                          setChoice(
                            g.kind === "local"
                              ? { kind: "local", modelId: m.id, label: m.label }
                              : { kind: "cloud", provider: g.provider!, model: m.id, label: m.label },
                          )
                        }
                        className={
                          "text-left p-2.5 rounded-md border transition-colors " +
                          (selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40")
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{m.label}</span>
                          {m.note && (
                            <span className="text-xs text-muted-foreground">{m.note}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 5 && (
          <ReviewStep
            assignment={assignment}
            course={course}
            mode={mode}
            selectedMaterials={selectedMaterials}
            includeInstructions={includeInstructions}
            includeFeedback={includeFeedback}
            useKb={useKb}
            choice={choice}
            isCloud={isCloud}
            cloudConfirmed={cloudConfirmed}
            setCloudConfirmed={setCloudConfirmed}
            running={running}
            loadProgress={loadProgress}
            output={output}
            userPrompt={userPrompt}
          />
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? close() : setStep((s) => s - 1))}
            disabled={running}
            data-testid="button-wizard-back"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> {step === 0 ? "Cancel" : "Back"}
          </Button>

          {step < 5 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} data-testid="button-wizard-next">
              Next <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <div className="flex gap-2">
              {output && !running && (
                <Button variant="secondary" onClick={saveAsMaterial} data-testid="button-wizard-save">
                  <Save className="w-4 h-4 mr-1" /> Save to materials
                </Button>
              )}
              {running ? (
                <Button variant="destructive" onClick={stop} data-testid="button-wizard-stop">
                  <Square className="w-4 h-4 mr-1" /> Stop
                </Button>
              ) : (
                <Button onClick={run} disabled={isCloud && !cloudConfirmed} data-testid="button-wizard-run">
                  <Sparkles className="w-4 h-4 mr-1" /> {output ? "Run again" : "Run"}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  testid,
  label,
  checked,
  disabled,
  onChange,
  note,
}: {
  testid: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  note?: string;
}) {
  return (
    <label
      className={
        "flex items-start gap-3 p-3 rounded-md border border-border " +
        (disabled ? "opacity-50" : "cursor-pointer hover:bg-muted/50")
      }
      data-testid={testid}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
      />
      <div>
        <div className="text-sm font-medium">{label}</div>
        {note && <div className="text-xs text-muted-foreground mt-0.5">{note}</div>}
      </div>
    </label>
  );
}

function ReviewStep({
  assignment,
  course,
  mode,
  selectedMaterials,
  includeInstructions,
  includeFeedback,
  useKb,
  choice,
  isCloud,
  cloudConfirmed,
  setCloudConfirmed,
  running,
  loadProgress,
  output,
  userPrompt,
}: {
  assignment: Assignment;
  course?: Course;
  mode: HelpMode;
  selectedMaterials: AssignmentMaterial[];
  includeInstructions: boolean;
  includeFeedback: boolean;
  useKb: boolean;
  choice: ModelChoice | null;
  isCloud: boolean;
  cloudConfirmed: boolean;
  setCloudConfirmed: (v: boolean) => void;
  running: boolean;
  loadProgress: number | null;
  output: string;
  userPrompt: string;
}) {
  const built = buildAssignmentContext({
    assignment,
    course,
    mode,
    materials: selectedMaterials,
    includeInstructions,
    includeFeedback,
    ragChunks: [],
    userPrompt,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{HELP_MODE_LABELS[mode]}</span>
        <PrivacyBadge kind={isCloud ? "cloud_processing" : "local_only"} />
      </div>

      <div className="rounded-md border border-border p-3 space-y-1">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Will send to {choice?.label ?? "—"}
        </div>
        <ul className="text-sm space-y-1 mt-1">
          {built.includedItems.map((it) => (
            <li key={it} className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> {it}
            </li>
          ))}
          {useKb && !isCloud && (
            <li className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> Course Knowledge Base
              excerpts (retrieved at run time)
            </li>
          )}
        </ul>
      </div>

      {isCloud && (
        <label
          className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 cursor-pointer"
          data-testid="cloud-confirm"
        >
          <Checkbox
            checked={cloudConfirmed}
            onCheckedChange={(v) => setCloudConfirmed(!!v)}
            className="mt-0.5"
          />
          <div className="text-sm">
            <div className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" /> This sends the items above to {choice?.label}{" "}
              (cloud).
            </div>
            <div className="text-muted-foreground mt-0.5">
              I understand this content will leave my device for this request.
            </div>
          </div>
        </label>
      )}

      {loadProgress !== null && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading model…
          </div>
          <Progress value={Math.round(loadProgress * 100)} />
        </div>
      )}

      {(output || running) && (
        <div
          className="rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto"
          data-testid="wizard-output"
        >
          {output || (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
            </span>
          )}
        </div>
      )}
    </div>
  );
}
