import { useMemo, useRef, useState } from "react";
import {
  Award,
  Loader2,
  Minus,
  Sparkles,
  Square,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import { useToast } from "@/hooks/use-toast";
import { assignmentStore, courseStore } from "@/services/studycore/store";
import {
  getAvailableModelGroups,
  isCloudChoice,
  recommendedChoice,
  runHelp,
  type ModelChoice,
} from "@/services/studycore/aiRunner";
import type { Assignment, Course } from "@/services/studycore/types";

// ---------------------------------------------------------------------------
// Helpers (pure — no AI involved in any of the math)
// ---------------------------------------------------------------------------

/** Resolve a graded assignment to a 0-100 percentage, if one exists. */
function gradeOf(a: Assignment): number | null {
  if (a.gradePercent != null) return a.gradePercent;
  if (a.pointsEarned != null && a.pointsPossible != null && a.pointsPossible > 0) {
    return (a.pointsEarned / a.pointsPossible) * 100;
  }
  return null;
}

/** Timeline date used to order graded work (due date, else updated date). */
function timelineDate(a: Assignment): string {
  return a.dueDate ?? a.updatedAt ?? a.createdAt;
}

function letterFor(pct: number): string {
  if (pct >= 93) return "A";
  if (pct >= 90) return "A-";
  if (pct >= 87) return "B+";
  if (pct >= 83) return "B";
  if (pct >= 80) return "B-";
  if (pct >= 77) return "C+";
  if (pct >= 73) return "C";
  if (pct >= 70) return "C-";
  if (pct >= 67) return "D+";
  if (pct >= 60) return "D";
  return "F";
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface GradedItem {
  assignment: Assignment;
  course?: Course;
  pct: number;
  date: string;
}

interface CourseBreakdown {
  course?: Course;
  courseId: string;
  items: GradedItem[];
  average: number;
  recent: number;
  trend: number; // recent half minus earlier half
}

type Choice = ModelChoice;

function encodeChoice(c: Choice): string {
  return c.kind === "local" ? `local::${c.modelId}` : `cloud::${c.provider}::${c.model}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Growth() {
  const { toast } = useToast();

  const courses = courseStore.list();
  const assignments = assignmentStore.list();

  const courseById = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.id, c] as const)),
    [courses],
  );

  // All graded items with a resolvable percentage, ordered chronologically.
  const graded = useMemo<GradedItem[]>(() => {
    const items: GradedItem[] = [];
    for (const a of assignments) {
      if (a.status !== "graded") continue;
      const pct = gradeOf(a);
      if (pct == null) continue;
      items.push({ assignment: a, course: courseById[a.courseId], pct, date: timelineDate(a) });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [assignments, courseById]);

  const overall = useMemo(() => avg(graded.map((g) => g.pct)), [graded]);

  // Overall trend: compare the earlier half to the most recent half.
  const overallTrend = useMemo(() => {
    if (graded.length < 2) return 0;
    const mid = Math.floor(graded.length / 2);
    const earlier = avg(graded.slice(0, mid).map((g) => g.pct));
    const recent = avg(graded.slice(mid).map((g) => g.pct));
    return recent - earlier;
  }, [graded]);

  // Chart series: each graded item plus a running cumulative average so the
  // student can see whether their trajectory is rising or falling.
  const chartData = useMemo(() => {
    let runningSum = 0;
    return graded.map((g, i) => {
      runningSum += g.pct;
      return {
        idx: i + 1,
        label: fmtDate(g.date),
        name: g.assignment.title,
        score: Math.round(g.pct * 10) / 10,
        average: Math.round((runningSum / (i + 1)) * 10) / 10,
        color: g.course?.color ?? "hsl(var(--primary))",
      };
    });
  }, [graded]);

  const breakdowns = useMemo<CourseBreakdown[]>(() => {
    const groups = new Map<string, GradedItem[]>();
    for (const g of graded) {
      const arr = groups.get(g.assignment.courseId) ?? [];
      arr.push(g);
      groups.set(g.assignment.courseId, arr);
    }
    const result: CourseBreakdown[] = [];
    for (const [courseId, items] of groups) {
      const average = avg(items.map((i) => i.pct));
      const recent = items[items.length - 1]?.pct ?? average;
      let trend = 0;
      if (items.length >= 2) {
        const mid = Math.floor(items.length / 2);
        trend =
          avg(items.slice(mid).map((i) => i.pct)) - avg(items.slice(0, mid).map((i) => i.pct));
      }
      result.push({ course: courseById[courseId], courseId, items, average, recent, trend });
    }
    return result.sort((a, b) => b.average - a.average);
  }, [graded, courseById]);

  // -------------------------------------------------------------------------
  // AI growth summary
  // -------------------------------------------------------------------------

  const modelGroups = useMemo(() => getAvailableModelGroups(), []);
  const [choice, setChoice] = useState<Choice | null>(() => recommendedChoice());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [running, setRunning] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ text: string; progress: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const choiceValue = choice ? encodeChoice(choice) : "";

  function onChoiceChange(value: string) {
    for (const group of modelGroups) {
      for (const m of group.models) {
        if (group.kind === "local" && value === `local::${m.id}`) {
          setChoice({ kind: "local", modelId: m.id, label: m.label });
          return;
        }
        if (
          group.kind === "cloud" &&
          group.provider &&
          value === `cloud::${group.provider}::${m.id}`
        ) {
          setChoice({ kind: "cloud", provider: group.provider, model: m.id, label: m.label });
          return;
        }
      }
    }
  }

  /** Plain-text metrics digest. This is exactly what gets sent to the model. */
  const metricsDigest = useMemo(() => {
    if (graded.length === 0) return "";
    const lines: string[] = [];
    lines.push(
      `Overall average: ${fmtPct(overall)} (${letterFor(overall)}) across ${graded.length} graded ${
        graded.length === 1 ? "item" : "items"
      }.`,
    );
    if (graded.length >= 2) {
      const dir = overallTrend > 0.5 ? "improving" : overallTrend < -0.5 ? "declining" : "steady";
      lines.push(`Overall trend: ${dir} (${overallTrend >= 0 ? "+" : ""}${overallTrend.toFixed(1)} pts).`);
    }
    lines.push("");
    lines.push("Per course:");
    for (const b of breakdowns) {
      const name = b.course?.name ?? "Untitled course";
      const trendTxt =
        b.items.length >= 2
          ? `, trend ${b.trend >= 0 ? "+" : ""}${b.trend.toFixed(1)} pts`
          : "";
      lines.push(
        `- ${name}: average ${fmtPct(b.average)} over ${b.items.length} ${
          b.items.length === 1 ? "item" : "items"
        }, most recent ${fmtPct(b.recent)}${trendTxt}.`,
      );
    }
    lines.push("");
    lines.push("Most recent results:");
    for (const g of graded.slice(-8).reverse()) {
      const name = g.course?.name ?? "Course";
      lines.push(`- ${g.assignment.title} (${name}): ${fmtPct(g.pct)} on ${fmtDate(g.date)}.`);
    }
    return lines.join("\n");
  }, [graded, breakdowns, overall, overallTrend]);

  function startSummary() {
    if (!choice) {
      toast({
        title: "No model available",
        description: "Add a local model or configure a cloud provider in Settings first.",
        variant: "destructive",
      });
      return;
    }
    if (isCloudChoice(choice)) {
      setConfirmOpen(true);
      return;
    }
    void runSummary();
  }

  async function runSummary() {
    if (!choice) return;
    setConfirmOpen(false);
    setRunning(true);
    setSummary("");
    setLoadProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const systemPrompt =
      "You are a supportive, honest study coach. Using ONLY the metrics provided, write a short, " +
      "encouraging progress summary for the student. Highlight genuine strengths, point out one or two " +
      "areas to focus on, and suggest concrete next steps. Be warm but realistic. Do not invent grades, " +
      "courses, or facts that are not in the data.";

    const prompt =
      `Here is a summary of my recent academic performance. Please summarize my progress:\n\n${metricsDigest}`;

    try {
      await runHelp({
        choice,
        systemPrompt,
        prompt,
        actionType: "growth_summary",
        includedFiles: false,
        includedCourseLibraryExcerpts: false,
        temperature: 0.6,
        maxTokens: 700,
        onToken: (t) => setSummary((prev) => prev + t),
        onDone: () => {
          setRunning(false);
          setLoadProgress(null);
          abortRef.current = null;
        },
        onError: (err) => {
          setRunning(false);
          setLoadProgress(null);
          abortRef.current = null;
          toast({
            title: "Could not generate summary",
            description: err.message,
            variant: "destructive",
          });
        },
        signal: controller.signal,
        onLoadProgress: (p) => setLoadProgress(p),
      });
    } catch (err) {
      setRunning(false);
      setLoadProgress(null);
      abortRef.current = null;
      toast({
        title: "Could not generate summary",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  function stopSummary() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setLoadProgress(null);
  }

  const cloudSelected = choice ? isCloudChoice(choice) : false;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="page-growth">
              Growth
            </h1>
            <p className="text-muted-foreground mt-1">
              Your progress over time, built from your graded work — all on your device.
            </p>
          </div>
        </div>
        <PrivacyBadge kind="local_only" />
      </header>

      {graded.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Summary stats */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Overall average"
              value={fmtPct(overall)}
              sub={`Letter: ${letterFor(overall)}`}
            />
            <StatCard label="Graded items" value={String(graded.length)} sub="counted in trends" />
            <StatCard label="Courses tracked" value={String(breakdowns.length)} sub="with graded work" />
            <TrendCard trend={overallTrend} count={graded.length} />
          </section>

          {/* Progress over time */}
          <section className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold">Progress over time</h2>
              <span className="text-xs text-muted-foreground">
                Score per graded item, with a running average
              </span>
            </div>
            <Card className="p-4" data-testid="growth-trend-chart">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(value: number, key: string) => [
                        `${value}%`,
                        key === "score" ? "Score" : "Running avg",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="average"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </section>

          {/* Per-course breakdown */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Per-course breakdown</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {breakdowns.map((b) => (
                <CourseCard key={b.courseId} breakdown={b} />
              ))}
            </div>
          </section>

          {/* AI growth summary */}
          <section className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                AI growth summary
              </h2>
              <PrivacyBadge kind={cloudSelected ? "cloud_processing" : "local_only"} size="sm" />
            </div>
            <Card className="p-4 space-y-4" data-testid="growth-ai-card">
              <p className="text-sm text-muted-foreground">
                Turn your numbers into an encouraging, plain-language recap. Only the aggregated
                metrics above are sent — never your assignment content or files.
              </p>

              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="growth-model">Model</Label>
                  <Select
                    value={choiceValue}
                    onValueChange={onChoiceChange}
                    disabled={running}
                  >
                    <SelectTrigger id="growth-model" data-testid="select-growth-model">
                      <SelectValue placeholder="Choose a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelGroups.map((group) => (
                        <SelectGroup key={`${group.kind}-${group.provider ?? "local"}`}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.models.map((m) => (
                            <SelectItem
                              key={`${group.kind}-${group.provider ?? "local"}-${m.id}`}
                              value={
                                group.kind === "local"
                                  ? `local::${m.id}`
                                  : `cloud::${group.provider}::${m.id}`
                              }
                            >
                              {m.label}
                              {m.note ? ` · ${m.note}` : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {running ? (
                  <Button
                    variant="destructive"
                    onClick={stopSummary}
                    data-testid="button-stop-summary"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    onClick={startSummary}
                    disabled={!choice}
                    data-testid="button-summarize-progress"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Summarize my progress
                  </Button>
                )}
              </div>

              {loadProgress && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {loadProgress.text}
                  </div>
                  <Progress value={Math.round(loadProgress.progress * 100)} />
                </div>
              )}

              {(summary || running) && (
                <>
                  <Separator />
                  <div
                    className="text-sm leading-relaxed whitespace-pre-wrap text-foreground"
                    data-testid="text-growth-summary"
                  >
                    {summary}
                    {running && !summary && !loadProgress && (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Thinking…
                      </span>
                    )}
                    {running && summary && <span className="inline-block w-2 h-4 ml-0.5 align-middle bg-primary/70 animate-pulse" />}
                  </div>
                </>
              )}
            </Card>
          </section>
        </>
      )}

      {/* Cloud confirmation: shown BEFORE any data leaves the device */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-cloud-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PrivacyBadge kind="cloud_processing" size="sm" />
              Send to {choice?.label ?? "cloud model"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This uses a cloud AI provider, so the summary below will leave your device. It
                  contains only aggregated grade metrics — no assignment content, files, or feedback.
                </p>
                <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap text-foreground">
                  {metricsDigest}
                </pre>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-cloud">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void runSummary()}
              data-testid="button-confirm-cloud"
            >
              Send &amp; summarize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Card className="p-10 text-center space-y-3" data-testid="growth-empty">
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
        <Award className="w-6 h-6 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">No graded work yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Once assignments are marked as graded with a score, your trends and per-course breakdowns
        will appear here. Sync a course or add a grade to get started.
      </p>
    </Card>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function TrendCard({ trend, count }: { trend: number; count: number }) {
  const enough = count >= 2;
  const up = trend > 0.5;
  const down = trend < -0.5;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const color = up
    ? "text-green-600 dark:text-green-400"
    : down
      ? "text-destructive"
      : "text-muted-foreground";
  return (
    <Card className="p-4" data-testid="stat-trend">
      <div className="text-xs text-muted-foreground">Recent trend</div>
      {enough ? (
        <>
          <div className={`text-2xl font-bold mt-1 flex items-center gap-1 ${color}`}>
            <Icon className="w-5 h-5" />
            {trend >= 0 ? "+" : ""}
            {trend.toFixed(1)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {up ? "Trending up" : down ? "Trending down" : "Holding steady"}
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground mt-2">Need more grades</div>
      )}
    </Card>
  );
}

function CourseCard({ breakdown }: { breakdown: CourseBreakdown }) {
  const { course, items, average, recent, trend } = breakdown;
  const color = course?.color ?? "hsl(var(--primary))";
  const up = trend > 0.5;
  const down = trend < -0.5;
  const TrendIcon = up ? TrendingUp : down ? TrendingDown : Minus;
  const trendColor = up
    ? "text-green-600 dark:text-green-400"
    : down
      ? "text-destructive"
      : "text-muted-foreground";

  const barData = items.map((it, i) => ({
    idx: i + 1,
    name: it.assignment.title,
    score: Math.round(it.pct * 10) / 10,
  }));

  return (
    <Card className="p-4 space-y-3" data-testid={`course-card-${breakdown.courseId}`}>
      <div className="flex items-center gap-3">
        <div className="w-1.5 h-9 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{course?.name ?? "Untitled course"}</div>
          <div className="text-xs text-muted-foreground">
            {items.length} graded {items.length === 1 ? "item" : "items"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">{fmtPct(average)}</div>
          <div className="text-xs text-muted-foreground">{letterFor(average)} avg</div>
        </div>
      </div>

      <div className="h-20 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(_, payload) =>
                (payload && payload[0] && (payload[0].payload as { name: string }).name) || ""
              }
              formatter={(value: number) => [`${value}%`, "Score"]}
            />
            <Bar dataKey="score" radius={[3, 3, 0, 0]}>
              {barData.map((_, i) => (
                <Cell key={i} fill={color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Most recent: <span className="font-medium text-foreground">{fmtPct(recent)}</span>
        </span>
        {items.length >= 2 && (
          <span className={`flex items-center gap-1 font-medium ${trendColor}`}>
            <TrendIcon className="w-3.5 h-3.5" />
            {trend >= 0 ? "+" : ""}
            {trend.toFixed(1)} pts
          </span>
        )}
      </div>
    </Card>
  );
}
