import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Filter,
  Plus,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import { MaterialsPanel } from "@/components/studycore/MaterialsPanel";
import { AIHelpWizard } from "@/components/studycore/AIHelpWizard";
import {
  ASSIGNMENT_TYPE_LABELS,
  detectAssignmentType,
  isAssessment,
} from "@/services/studycore/assignmentType";
import {
  assignmentStore,
  courseStore,
  newId,
  nowIso,
} from "@/services/studycore/store";
import type {
  Assignment,
  AssignmentStatus,
  AssignmentType,
  Course,
} from "@/services/studycore/types";

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  graded: "Graded",
};

const STATUS_STYLES: Record<AssignmentStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  submitted: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  graded: "bg-green-500/10 text-green-600 dark:text-green-400",
};

function dueLabel(dueDate?: string | null): string {
  if (!dueDate) return "No due date";
  const d = new Date(dueDate);
  const now = new Date();
  const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (days < 0) return `Overdue · ${date}`;
  if (days === 0) return `Due today · ${date}`;
  if (days === 1) return `Due tomorrow · ${date}`;
  if (days <= 7) return `Due in ${days} days · ${date}`;
  return `Due ${date}`;
}

export default function Assignments() {
  const [match, params] = useRoute("/assignments/:id");
  if (match && params?.id) {
    return <AssignmentDetail id={params.id} />;
  }
  return <AssignmentList />;
}

function AssignmentList() {
  const { toast } = useToast();
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const courses = courseStore.list();
  const assignments = assignmentStore.list();
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);

  const filtered = assignments
    .filter((a) => courseFilter === "all" || a.courseId === courseFilter)
    .filter((a) => statusFilter === "all" || a.status === statusFilter)
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    });

  const byCourse = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of filtered) {
      if (!map.has(a.courseId)) map.set(a.courseId, []);
      map.get(a.courseId)!.push(a);
    }
    return map;
  }, [filtered]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="page-assignments">
              Assignments
            </h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Everything you're working on, from Canvas or added by hand.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} data-testid="button-add-assignment">
          <Plus className="w-4 h-4 mr-1.5" /> Add assignment
        </Button>
      </header>

      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={courseFilter} onValueChange={setCourseFilter}>
            <SelectTrigger className="w-44" data-testid="filter-course">
              <SelectValue placeholder="Course" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courses</SelectItem>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABELS) as AssignmentStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center space-y-3" data-testid="empty-assignments">
          <BookOpen className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">
            No assignments yet. Sync Canvas from Connections, or add one by hand.
          </p>
          <Button onClick={() => setAddOpen(true)} variant="secondary">
            <Plus className="w-4 h-4 mr-1.5" /> Add assignment
          </Button>
        </Card>
      ) : (
        <div className="space-y-6">
          {[...byCourse.entries()].map(([courseId, items]) => {
            const course = courses.find((c) => c.id === courseId);
            return (
              <div key={courseId}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: course?.color ?? "#888" }}
                  />
                  <h2 className="font-semibold">{course?.name ?? "Unknown course"}</h2>
                  <span className="text-xs text-muted-foreground">({items.length})</span>
                </div>
                <div className="space-y-2">
                  {items.map((a) => (
                    <AssignmentRow key={a.id} assignment={a} course={course} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddAssignmentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        courses={courses}
        onAdded={() => {
          refresh();
          toast({ title: "Assignment added" });
        }}
      />
    </div>
  );
}

function AssignmentRow({ assignment, course }: { assignment: Assignment; course?: Course }) {
  return (
    <Link href={`/assignments/${assignment.id}`}>
      <Card
        className="p-4 flex items-center gap-4 hover:border-primary/40 transition-colors cursor-pointer"
        data-testid={`assignment-row-${assignment.id}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{assignment.title}</span>
            {isAssessment(assignment.type) && (
              <Badge variant="outline" className="text-amber-600 border-amber-500/40">
                Assessment
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {dueLabel(assignment.dueDate)}
            </span>
            <span>{ASSIGNMENT_TYPE_LABELS[assignment.type]}</span>
            {assignment.gradePercent != null && (
              <span className="text-green-600 dark:text-green-400">
                {assignment.gradePercent}%
              </span>
            )}
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLES[assignment.status]}`}>
          {STATUS_LABELS[assignment.status]}
        </span>
      </Card>
    </Link>
  );
}

function AssignmentDetail({ id }: { id: string }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const assignment = assignmentStore.list().find((a) => a.id === id);
  const [wizardOpen, setWizardOpen] = useState(false);

  if (!assignment) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Button variant="ghost" onClick={() => navigate("/assignments")}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to assignments
        </Button>
        <Card className="p-10 text-center mt-4 text-muted-foreground">
          This assignment no longer exists.
        </Card>
      </div>
    );
  }

  const course = courseStore.list().find((c) => c.id === assignment.courseId);

  function update(patch: Partial<Assignment>) {
    assignmentStore.save({ ...assignment!, ...patch, updatedAt: nowIso() });
    refresh();
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <Button variant="ghost" onClick={() => navigate("/assignments")} data-testid="button-back">
        <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to assignments
      </Button>

      <header className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {course && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: course.color }} />
              {course.name}
            </span>
          )}
          {assignment.source === "canvas" && <PrivacyBadge kind="canvas_synced" size="sm" />}
        </div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="assignment-title">
          {assignment.title}
        </h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" /> {dueLabel(assignment.dueDate)}
          </span>
          {assignment.externalUrl && (
            <a
              href={assignment.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open in Canvas
            </a>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={assignment.status} onValueChange={(v) => update({ status: v as AssignmentStatus })}>
            <SelectTrigger className="w-40" data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABELS) as AssignmentStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select
            value={assignment.type}
            onValueChange={(v) => update({ type: v as AssignmentType, typeAutoDetected: false })}
          >
            <SelectTrigger className="w-44" data-testid="select-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ASSIGNMENT_TYPE_LABELS) as AssignmentType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {ASSIGNMENT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="p-5 space-y-3" data-testid="card-ai-help">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> AI Help
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isAssessment(assignment.type)
                ? "Study-guide mode only for assessments — learn the material, no submittable answers."
                : "A guided 6-step flow: pick what to include, choose a model, review, then run."}
            </p>
          </div>
          <Button onClick={() => setWizardOpen(true)} data-testid="button-get-ai-help">
            <Sparkles className="w-4 h-4 mr-1.5" /> Get AI Help
          </Button>
        </div>
      </Card>

      {assignment.instructions.trim() && (
        <Card className="p-5 space-y-2">
          <h2 className="font-semibold">Instructions</h2>
          <div className="text-sm whitespace-pre-wrap text-muted-foreground">
            {assignment.instructions}
          </div>
        </Card>
      )}

      {assignment.feedback?.trim() && (
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" /> Teacher feedback
            </h2>
            <PrivacyBadge kind="stored_on_device" size="sm" />
          </div>
          <div className="text-sm whitespace-pre-wrap text-muted-foreground">
            {assignment.feedback}
          </div>
        </Card>
      )}

      <MaterialsPanel assignment={assignment} onChange={refresh} />

      <AIHelpWizard
        assignment={assignment}
        course={course}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSaved={() => {
          refresh();
          toast({ title: "Saved to this assignment's materials" });
        }}
      />
    </div>
  );
}

function AddAssignmentDialog({
  open,
  onOpenChange,
  courses,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courses: Course[];
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState<string>(courses[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");

  function submit() {
    if (!title.trim()) {
      toast({ title: "Give the assignment a title", variant: "destructive" });
      return;
    }
    if (!courseId) {
      toast({ title: "Pick a course first", variant: "destructive" });
      return;
    }
    const assignment: Assignment = {
      id: newId("assign"),
      courseId,
      title: title.trim(),
      instructions: instructions.trim(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      type: detectAssignmentType(title),
      typeAutoDetected: true,
      source: "manual",
      status: "not_started",
      pointsPossible: null,
      pointsEarned: null,
      gradePercent: null,
      feedback: null,
      difficulty: null,
      estimatedMinutes: null,
      externalUrl: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    assignmentStore.save(assignment);
    setTitle("");
    setDueDate("");
    setInstructions("");
    onOpenChange(false);
    onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add assignment</DialogTitle>
        </DialogHeader>
        {courses.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">
            You need a course first. Sync Canvas from{" "}
            <Link href="/connections" className="text-primary hover:underline">
              Connections
            </Link>
            , or one will be created when you sync.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-title">Title</Label>
              <Input
                id="add-title"
                data-testid="input-add-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Essay on the French Revolution"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-course">Course</Label>
              <Select value={courseId} onValueChange={setCourseId}>
                <SelectTrigger id="add-course" data-testid="select-add-course">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-due">Due date</Label>
              <Input
                id="add-due"
                data-testid="input-add-due"
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-instructions">Instructions (optional)</Label>
              <Textarea
                id="add-instructions"
                data-testid="input-add-instructions"
                rows={4}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={courses.length === 0} data-testid="button-submit-assignment">
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
