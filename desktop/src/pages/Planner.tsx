import { useMemo, useState } from "react";
import {
  CalendarRange,
  Check,
  Clock,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import { useToast } from "@/hooks/use-toast";
import { generateStudyPlan } from "@/services/studycore/planner";
import {
  DEFAULT_PLANNER_PREFS,
  assignmentStore,
  courseStore,
  plannerPrefsStore,
  studyPlanStore,
} from "@/services/studycore/store";
import type {
  Course,
  PlannerPreferences,
  StudyBlock,
  StudyPlan,
} from "@/services/studycore/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  // local day key (yyyy-mm-dd) to keep grouping aligned with the user's clock
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function blockDayKey(b: StudyBlock): string {
  return dayKey(new Date(b.scheduledStart));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDayHeading(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86400000));
  const prefix = key === today ? "Today · " : key === tomorrow ? "Tomorrow · " : "";
  return prefix + d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export default function Planner() {
  const { toast } = useToast();
  const courses = courseStore.list();
  const courseById = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.id, c] as const)) as Record<string, Course>,
    [courses],
  );

  const [prefs, setPrefs] = useState<PlannerPreferences>(() => plannerPrefsStore.get());
  const [plan, setPlan] = useState<StudyPlan | undefined>(() => studyPlanStore.latest());
  const [showSetup, setShowSetup] = useState<boolean>(() => !plannerPrefsStore.get().configured);

  const upcoming = useMemo(
    () =>
      assignmentStore
        .list()
        .filter((a) => a.status !== "submitted" && a.status !== "graded")
        .filter((a) => a.dueDate),
    [],
  );

  function patchPrefs(patch: Partial<PlannerPreferences>) {
    setPrefs((p) => ({ ...p, ...patch }));
  }

  function toggleAvoidDay(day: number) {
    setPrefs((p) => ({
      ...p,
      avoidDays: p.avoidDays.includes(day)
        ? p.avoidDays.filter((d) => d !== day)
        : [...p.avoidDays, day].sort((a, b) => a - b),
    }));
  }

  function savePrefs() {
    const next = { ...prefs, configured: true };
    plannerPrefsStore.save(next);
    setPrefs(next);
    setShowSetup(false);
    toast({ title: "Availability saved", description: "Your study preferences are stored on this device." });
  }

  function handleGenerate() {
    if (upcoming.length === 0) {
      toast({
        title: "Nothing to schedule",
        description: "Add assignments with due dates first, then generate a plan.",
        variant: "destructive",
      });
      return;
    }
    const next = { ...prefs, configured: true };
    plannerPrefsStore.save(next);
    setPrefs(next);
    const newPlan = generateStudyPlan(upcoming, next);
    studyPlanStore.save(newPlan);
    setPlan(newPlan);
    setShowSetup(false);
    toast({
      title: "Study plan ready",
      description: `${newPlan.blocks.length} study block${newPlan.blocks.length === 1 ? "" : "s"} scheduled.`,
    });
  }

  function persistPlan(next: StudyPlan) {
    studyPlanStore.save(next);
    setPlan(next);
  }

  function toggleDone(id: string) {
    if (!plan) return;
    persistPlan({
      ...plan,
      blocks: plan.blocks.map((b) => (b.id === id ? { ...b, completed: !b.completed } : b)),
    });
  }

  function deleteBlock(id: string) {
    if (!plan) return;
    persistPlan({ ...plan, blocks: plan.blocks.filter((b) => b.id !== id) });
  }

  function moveBlock(id: string, key: string) {
    if (!plan) return;
    persistPlan({
      ...plan,
      blocks: plan.blocks
        .map((b) => {
          if (b.id !== id) return b;
          const old = new Date(b.scheduledStart);
          const nd = new Date(`${key}T00:00:00`);
          nd.setHours(old.getHours(), old.getMinutes(), 0, 0);
          return { ...b, scheduledStart: nd.toISOString() };
        })
        .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
    });
  }

  const blocks = plan?.blocks ?? [];
  const todayKey = dayKey(new Date());
  const todayBlocks = useMemo(
    () =>
      blocks
        .filter((b) => blockDayKey(b) === todayKey)
        .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
    [blocks, todayKey],
  );

  const weekDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dayKey(d);
      return {
        key,
        date: d,
        blocks: blocks
          .filter((b) => blockDayKey(b) === key)
          .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
      };
    });
  }, [blocks]);

  const agenda = useMemo(() => {
    const groups = new Map<string, StudyBlock[]>();
    for (const b of [...blocks].sort((a, c) => a.scheduledStart.localeCompare(c.scheduledStart))) {
      const k = blockDayKey(b);
      const arr = groups.get(k) ?? [];
      arr.push(b);
      groups.set(k, arr);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [blocks]);

  const moveOptions = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 21 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { key: dayKey(d), label: formatDayHeading(dayKey(d)) };
    });
  }, []);

  const totalMinutes = blocks.reduce((s, b) => s + b.durationMinutes, 0);
  const doneMinutes = blocks.filter((b) => b.completed).reduce((s, b) => s + b.durationMinutes, 0);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8" data-testid="page-planner">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarRange className="w-6 h-6 text-primary" />
            Planner
          </h1>
          <p className="text-muted-foreground mt-1">
            A study schedule built from your upcoming work and your availability. No AI — just
            transparent scheduling, on your device.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PrivacyBadge kind="local_only" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSetup((s) => !s)}
            data-testid="button-toggle-setup"
          >
            <Settings2 className="w-4 h-4 mr-1.5" />
            Availability
          </Button>
        </div>
      </header>

      {showSetup && (
        <Card className="p-6 space-y-6" data-testid="card-availability">
          <div>
            <h2 className="text-lg font-semibold">Your availability</h2>
            <p className="text-sm text-muted-foreground">
              Tell the planner how much time you have. It slices your assignments into sessions and
              fills each day up to your limit.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="weekday-min">Weekday minutes / day</Label>
              <Input
                id="weekday-min"
                type="number"
                min={0}
                step={15}
                value={prefs.weekdayMinutes}
                onChange={(e) => patchPrefs({ weekdayMinutes: Math.max(0, Number(e.target.value)) })}
                data-testid="input-weekday-minutes"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weekend-min">Weekend minutes / day</Label>
              <Input
                id="weekend-min"
                type="number"
                min={0}
                step={15}
                value={prefs.weekendMinutes}
                onChange={(e) => patchPrefs({ weekendMinutes: Math.max(0, Number(e.target.value)) })}
                data-testid="input-weekend-minutes"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-min">Session length (min)</Label>
              <Input
                id="session-min"
                type="number"
                min={15}
                step={5}
                value={prefs.sessionMinutes}
                onChange={(e) => patchPrefs({ sessionMinutes: Math.max(15, Number(e.target.value)) })}
                data-testid="input-session-minutes"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Days to avoid scheduling</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, day) => {
                const avoided = prefs.avoidDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleAvoidDay(day)}
                    className={
                      "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors " +
                      (avoided
                        ? "bg-muted text-muted-foreground border-border line-through"
                        : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20")
                    }
                    data-testid={`button-avoid-day-${day}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Tap a day to skip it. Highlighted days are available for studying.
            </p>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="prioritize-urgent" className="text-sm font-medium">
                  Prioritize urgent work
                </Label>
                <p className="text-xs text-muted-foreground">
                  Schedule the soonest-due assignments first.
                </p>
              </div>
              <Switch
                id="prioritize-urgent"
                checked={prefs.prioritizeUrgent}
                onCheckedChange={(v) => patchPrefs({ prioritizeUrgent: v })}
                data-testid="switch-prioritize-urgent"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="spread-projects" className="text-sm font-medium">
                  Spread big projects
                </Label>
                <p className="text-xs text-muted-foreground">
                  Break large essays and projects across multiple days.
                </p>
              </div>
              <Switch
                id="spread-projects"
                checked={prefs.spreadProjects}
                onCheckedChange={(v) => patchPrefs({ spreadProjects: v })}
                data-testid="switch-spread-projects"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={savePrefs} variant="outline" data-testid="button-save-prefs">
              <Check className="w-4 h-4 mr-1.5" />
              Save availability
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPrefs(DEFAULT_PLANNER_PREFS)}
              data-testid="button-reset-prefs"
            >
              Reset to defaults
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {upcoming.length === 0 ? (
            <span>No upcoming assignments with due dates to schedule.</span>
          ) : (
            <span data-testid="text-upcoming-count">
              {upcoming.length} upcoming assignment{upcoming.length === 1 ? "" : "s"} ready to plan.
            </span>
          )}
        </div>
        <Button onClick={handleGenerate} data-testid="button-generate-plan">
          {plan ? (
            <RefreshCw className="w-4 h-4 mr-1.5" />
          ) : (
            <Sparkles className="w-4 h-4 mr-1.5" />
          )}
          {plan ? "Regenerate plan" : "Generate study plan"}
        </Button>
      </div>

      {!plan || blocks.length === 0 ? (
        <Card className="p-10 text-center space-y-3" data-testid="empty-planner">
          <CalendarRange className="w-10 h-10 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-semibold">No study plan yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Set your availability above, then generate a plan. The planner will turn your upcoming
            assignments into bite-sized study blocks across the next few weeks.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 flex flex-wrap items-center gap-x-8 gap-y-2" data-testid="card-plan-summary">
            <SummaryStat label="Study blocks" value={String(blocks.length)} />
            <SummaryStat label="Total time" value={formatDuration(totalMinutes)} />
            <SummaryStat
              label="Completed"
              value={`${formatDuration(doneMinutes)} / ${formatDuration(totalMinutes)}`}
            />
            <SummaryStat
              label="Created"
              value={new Date(plan.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
            />
          </Card>

          <Tabs defaultValue="today">
            <TabsList data-testid="tabs-planner-views">
              <TabsTrigger value="today" data-testid="tab-today">
                Today
              </TabsTrigger>
              <TabsTrigger value="week" data-testid="tab-week">
                Week
              </TabsTrigger>
              <TabsTrigger value="agenda" data-testid="tab-agenda">
                Agenda
              </TabsTrigger>
            </TabsList>

            <TabsContent value="today">
              {todayBlocks.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground" data-testid="empty-today">
                  Nothing scheduled for today. Enjoy the breather or pull work forward from the Week
                  view.
                </Card>
              ) : (
                <div className="space-y-2">
                  {todayBlocks.map((b) => (
                    <BlockRow
                      key={b.id}
                      block={b}
                      course={b.courseId ? courseById[b.courseId] : undefined}
                      moveOptions={moveOptions}
                      onToggleDone={toggleDone}
                      onDelete={deleteBlock}
                      onMove={moveBlock}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="week">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
                {weekDays.map((d) => (
                  <div key={d.key} className="space-y-2" data-testid={`week-col-${d.key}`}>
                    <div className="text-center">
                      <div className="text-xs font-medium text-muted-foreground">
                        {DAY_LABELS[d.date.getDay()]}
                      </div>
                      <div
                        className={
                          "text-sm font-semibold " +
                          (d.key === todayKey ? "text-primary" : "text-foreground")
                        }
                      >
                        {d.date.getDate()}
                      </div>
                    </div>
                    <div className="space-y-2 min-h-[3rem]">
                      {d.blocks.length === 0 ? (
                        <div className="text-[11px] text-center text-muted-foreground py-2">—</div>
                      ) : (
                        d.blocks.map((b) => (
                          <WeekChip
                            key={b.id}
                            block={b}
                            course={b.courseId ? courseById[b.courseId] : undefined}
                            onToggleDone={toggleDone}
                          />
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="agenda">
              <div className="space-y-6">
                {agenda.map(([key, dayBlocks]) => (
                  <div key={key} className="space-y-2" data-testid={`agenda-day-${key}`}>
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      {formatDayHeading(key)}
                    </h3>
                    <div className="space-y-2">
                      {dayBlocks.map((b) => (
                        <BlockRow
                          key={b.id}
                          block={b}
                          course={b.courseId ? courseById[b.courseId] : undefined}
                          moveOptions={moveOptions}
                          onToggleDone={toggleDone}
                          onDelete={deleteBlock}
                          onMove={moveBlock}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function BlockRow({
  block,
  course,
  moveOptions,
  onToggleDone,
  onDelete,
  onMove,
}: {
  block: StudyBlock;
  course?: Course;
  moveOptions: { key: string; label: string }[];
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, key: string) => void;
}) {
  const color = course?.color ?? "hsl(var(--primary))";
  return (
    <Card
      className={"p-4 flex items-center gap-3 " + (block.completed ? "opacity-60" : "")}
      data-testid={`block-${block.id}`}
    >
      <button
        type="button"
        onClick={() => onToggleDone(block.id)}
        className={
          "w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors " +
          (block.completed
            ? "bg-primary border-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-primary")
        }
        aria-label={block.completed ? "Mark not done" : "Mark done"}
        data-testid={`button-done-${block.id}`}
      >
        {block.completed && <Check className="w-3 h-3" />}
      </button>

      <div className="w-1.5 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />

      <div className="min-w-0 flex-1">
        <div className={"font-medium truncate " + (block.completed ? "line-through" : "")}>
          {block.title}
        </div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {formatTime(block.scheduledStart)} · {formatDuration(block.durationMinutes)}
          {course && <span>· {course.name}</span>}
        </div>
        {block.generatedReason && (
          <div className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
            {block.generatedReason}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Select value={blockDayKey(block)} onValueChange={(v) => onMove(block.id, v)}>
          <SelectTrigger className="w-[150px] h-8 text-xs" data-testid={`select-move-${block.id}`}>
            <SelectValue placeholder="Move to…" />
          </SelectTrigger>
          <SelectContent>
            {moveOptions.map((o) => (
              <SelectItem key={o.key} value={o.key} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(block.id)}
          aria-label="Delete block"
          data-testid={`button-delete-${block.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}

function WeekChip({
  block,
  course,
  onToggleDone,
}: {
  block: StudyBlock;
  course?: Course;
  onToggleDone: (id: string) => void;
}) {
  const color = course?.color ?? "hsl(var(--primary))";
  return (
    <button
      type="button"
      onClick={() => onToggleDone(block.id)}
      className={
        "w-full text-left rounded-md border p-2 transition-colors hover:bg-muted/50 " +
        (block.completed ? "opacity-50" : "")
      }
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
      data-testid={`week-block-${block.id}`}
    >
      <div className={"text-xs font-medium truncate " + (block.completed ? "line-through" : "")}>
        {block.title}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {formatTime(block.scheduledStart)} · {formatDuration(block.durationMinutes)}
      </div>
    </button>
  );
}
