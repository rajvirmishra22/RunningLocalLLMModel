import { useMemo, useState } from "react";
import {
  GraduationCap,
  Plus,
  Trash2,
  Save,
  Sparkles,
  Target,
  FolderOpen,
  Calculator,
  Info,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import { useToast } from "@/hooks/use-toast";
import {
  projectScenario,
  neededForTarget,
  scenarioFromAssignments,
  GRADE_MODE_DISCLAIMERS,
  UNOFFICIAL_DISCLAIMER,
  round1,
} from "@/services/studycore/grades";
import {
  courseStore,
  assignmentStore,
  gradeScenarioStore,
  newId,
  nowIso,
} from "@/services/studycore/store";
import type {
  Course,
  GradeCategory,
  GradeMode,
  GradeSimulationScenario,
  HypotheticalScore,
} from "@/services/studycore/types";

const MODE_LABELS: Record<GradeMode, string> = {
  weighted: "Weighted",
  points_estimate: "Points",
  manual: "Manual",
};

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function letterFromPct(pct: number): string {
  if (pct >= 93) return "A";
  if (pct >= 90) return "A-";
  if (pct >= 87) return "B+";
  if (pct >= 83) return "B";
  if (pct >= 80) return "B-";
  if (pct >= 77) return "C+";
  if (pct >= 73) return "C";
  if (pct >= 70) return "C-";
  if (pct >= 67) return "D+";
  if (pct >= 63) return "D";
  if (pct >= 60) return "D-";
  return "F";
}

function blankScenario(courseId: string, name: string, mode: GradeMode): GradeSimulationScenario {
  const now = nowIso();
  return {
    id: newId("scenario"),
    courseId,
    name,
    mode,
    categories: [],
    hypotheticalScores: [],
    createdAt: now,
    updatedAt: now,
  };
}

export default function Grades() {
  const { toast } = useToast();
  const courses = courseStore.list();
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(
    courses[0]?.id ?? null,
  );
  const [scenario, setScenario] = useState<GradeSimulationScenario | null>(() =>
    courses[0] ? blankScenario(courses[0].id, `What-If — ${courses[0].name}`, "points_estimate") : null,
  );
  const [savedRefresh, setSavedRefresh] = useState(0);

  // Target solver state
  const [targetPercent, setTargetPercent] = useState("90");
  const [targetPointsPossible, setTargetPointsPossible] = useState("100");
  const [targetCategoryId, setTargetCategoryId] = useState<string>("");

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );

  const savedScenarios = useMemo(
    () => (selectedCourseId ? gradeScenarioStore.listByCourse(selectedCourseId) : []),
    [selectedCourseId, savedRefresh],
  );

  const projected = scenario ? projectScenario(scenario) : null;

  const selectCourse = (course: Course) => {
    setSelectedCourseId(course.id);
    setScenario(blankScenario(course.id, `What-If — ${course.name}`, "points_estimate"));
    setTargetCategoryId("");
  };

  const patchScenario = (patch: Partial<GradeSimulationScenario>) => {
    setScenario((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  // ----- score editing -----
  const addScore = () => {
    if (!scenario) return;
    const score: HypotheticalScore = {
      id: newId("score"),
      name: `Item ${scenario.hypotheticalScores.length + 1}`,
      categoryId: scenario.categories?.[0]?.id,
      pointsEarned: null,
      pointsPossible: scenario.mode === "points_estimate" ? 100 : null,
      percentage: null,
      isHypothetical: true,
    };
    patchScenario({ hypotheticalScores: [...scenario.hypotheticalScores, score] });
  };

  const updateScore = (id: string, patch: Partial<HypotheticalScore>) => {
    if (!scenario) return;
    patchScenario({
      hypotheticalScores: scenario.hypotheticalScores.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    });
  };

  const removeScore = (id: string) => {
    if (!scenario) return;
    patchScenario({
      hypotheticalScores: scenario.hypotheticalScores.filter((s) => s.id !== id),
    });
  };

  // ----- category editing -----
  const addCategory = () => {
    if (!scenario) return;
    const cat: GradeCategory = {
      id: newId("cat"),
      name: `Category ${(scenario.categories?.length ?? 0) + 1}`,
      weight: 0,
    };
    patchScenario({ categories: [...(scenario.categories ?? []), cat] });
  };

  const updateCategory = (id: string, patch: Partial<GradeCategory>) => {
    if (!scenario) return;
    patchScenario({
      categories: (scenario.categories ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const removeCategory = (id: string) => {
    if (!scenario) return;
    patchScenario({
      categories: (scenario.categories ?? []).filter((c) => c.id !== id),
      hypotheticalScores: scenario.hypotheticalScores.map((s) =>
        s.categoryId === id ? { ...s, categoryId: undefined } : s,
      ),
    });
  };

  // ----- seed -----
  const seedFromAssignments = () => {
    if (!scenario || !selectedCourse) return;
    const courseAssignments = assignmentStore.listByCourse(selectedCourse.id);
    const seeded = scenarioFromAssignments(
      selectedCourse.id,
      scenario.name,
      courseAssignments,
      scenario.mode,
    );
    if (seeded.hypotheticalScores.length === 0) {
      toast({
        title: "Nothing to seed",
        description: "This course has no assignments with point values yet.",
      });
      return;
    }
    setScenario({
      ...scenario,
      categories: scenario.categories ?? [],
      hypotheticalScores: seeded.hypotheticalScores,
    });
    toast({
      title: "Seeded from assignments",
      description: `${seeded.hypotheticalScores.length} item(s) added. Edit any hypothetical scores below.`,
    });
  };

  // ----- save / load / delete -----
  const saveScenario = () => {
    if (!scenario) return;
    const toSave: GradeSimulationScenario = {
      ...scenario,
      updatedAt: nowIso(),
      projectedPercentage: projected ?? undefined,
    };
    gradeScenarioStore.save(toSave);
    setScenario(toSave);
    setSavedRefresh((n) => n + 1);
    toast({ title: "Scenario saved", description: `"${toSave.name}" is stored on your device.` });
  };

  const loadScenario = (id: string) => {
    const found = gradeScenarioStore.get(id);
    if (!found) return;
    const clone: GradeSimulationScenario = JSON.parse(JSON.stringify(found));
    setScenario(clone);
    setTargetCategoryId("");
  };

  const deleteScenario = (id: string) => {
    gradeScenarioStore.remove(id);
    setSavedRefresh((n) => n + 1);
    toast({ title: "Scenario deleted" });
  };

  // ----- target solver -----
  const targetResult = useMemo(() => {
    if (!scenario) return null;
    const tp = numOrNull(targetPercent);
    if (tp == null) return null;
    const needed = neededForTarget({
      mode: scenario.mode,
      targetPercent: tp,
      lockedScores: scenario.hypotheticalScores,
      categories: scenario.categories,
      targetPointsPossible: numOrNull(targetPointsPossible),
      targetCategoryId: targetCategoryId || undefined,
    });
    return needed;
  }, [scenario, targetPercent, targetPointsPossible, targetCategoryId]);

  const categories = scenario?.categories ?? [];
  const usesCategories = scenario?.mode === "weighted" || scenario?.mode === "manual";
  const totalWeight = categories.reduce((sum, c) => sum + (c.weight || 0), 0);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2" data-testid="page-grades">
          <GraduationCap className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Grades &amp; What-If</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Project your grade with hypothetical scores. All math runs on your device.
            </p>
          </div>
        </div>
        <PrivacyBadge kind="local_only" />
      </header>

      <div
        className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400"
        data-testid="grades-unofficial-disclaimer"
      >
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p className="text-xs">{UNOFFICIAL_DISCLAIMER}</p>
      </div>

      {courses.length === 0 ? (
        <Card className="p-10 text-center" data-testid="grades-empty">
          <GraduationCap className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
          <h2 className="text-lg font-semibold">No courses yet</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
            Connect a school account or add a course to start projecting grades. Everything
            you enter here stays on this device.
          </p>
        </Card>
      ) : (
        <>
          {/* Course list */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Your courses</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {courses.map((course) => {
                const active = course.id === selectedCourseId;
                const grade = course.currentGrade;
                return (
                  <Card
                    key={course.id}
                    onClick={() => selectCourse(course)}
                    className={
                      "p-4 cursor-pointer transition-colors " +
                      (active ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40")
                    }
                    data-testid={`grade-course-${course.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-1.5 h-10 rounded-full flex-shrink-0"
                        style={{ backgroundColor: course.color || "hsl(var(--primary))" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{course.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {course.instructor || course.term || "Course"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold leading-none">
                          {grade != null ? `${round1(grade)}%` : "—"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {course.letterGrade ??
                            (grade != null ? letterFromPct(grade) : "No grade")}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* What-If calculator */}
          {scenario && selectedCourse && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  What-If calculator · {selectedCourse.name}
                </h2>
              </div>

              <Card data-testid="whatif-card">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                      <Label htmlFor="scenario-name" className="text-xs whitespace-nowrap">
                        Name
                      </Label>
                      <Input
                        id="scenario-name"
                        value={scenario.name}
                        onChange={(e) => patchScenario({ name: e.target.value })}
                        className="h-8 text-sm"
                        data-testid="input-scenario-name"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs whitespace-nowrap">Mode</Label>
                      <Select
                        value={scenario.mode}
                        onValueChange={(v) => patchScenario({ mode: v as GradeMode })}
                      >
                        <SelectTrigger className="h-8 w-[140px] text-sm" data-testid="select-grade-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(MODE_LABELS) as GradeMode[]).map((m) => (
                            <SelectItem key={m} value={m} data-testid={`mode-option-${m}`}>
                              {MODE_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Projection result */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-md bg-primary/5 border border-primary/20">
                    <div>
                      <div className="text-xs text-muted-foreground">Projected grade</div>
                      <div className="text-3xl font-bold" data-testid="text-projected-grade">
                        {projected != null ? `${round1(projected)}%` : "—"}
                      </div>
                    </div>
                    {projected != null && (
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Letter</div>
                        <div className="text-2xl font-semibold">{letterFromPct(projected)}</div>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground" data-testid="text-mode-disclaimer">
                    {GRADE_MODE_DISCLAIMERS[scenario.mode]}
                  </p>

                  {/* Categories (weighted/manual) */}
                  {usesCategories && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">Categories</h3>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={addCategory}
                          className="gap-1.5 h-7"
                          data-testid="btn-add-category"
                        >
                          <Plus className="w-3.5 h-3.5" /> Category
                        </Button>
                      </div>
                      {categories.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Add categories (e.g. Homework, Exams) and give each a weight.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {categories.map((cat) => (
                            <div
                              key={cat.id}
                              className="flex items-center gap-2"
                              data-testid={`category-row-${cat.id}`}
                            >
                              <Input
                                value={cat.name}
                                onChange={(e) => updateCategory(cat.id, { name: e.target.value })}
                                className="h-8 text-sm flex-1"
                                placeholder="Category name"
                                data-testid={`input-category-name-${cat.id}`}
                              />
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={cat.weight === 0 ? "" : cat.weight}
                                  onChange={(e) =>
                                    updateCategory(cat.id, { weight: numOrNull(e.target.value) ?? 0 })
                                  }
                                  className="h-8 text-sm w-20"
                                  placeholder="Weight"
                                  data-testid={`input-category-weight-${cat.id}`}
                                />
                                <span className="text-xs text-muted-foreground">%</span>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeCategory(cat.id)}
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                data-testid={`btn-remove-category-${cat.id}`}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                          <p
                            className={
                              "text-xs " +
                              (totalWeight === 100 ? "text-muted-foreground" : "text-amber-500")
                            }
                          >
                            Total weight: {round1(totalWeight)}%
                            {totalWeight !== 100 &&
                              " — weights are re-normalized, but 100% is clearest."}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <Separator />

                  {/* Scores */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="text-sm font-medium">Scores</h3>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={seedFromAssignments}
                          className="gap-1.5 h-7"
                          data-testid="btn-seed-assignments"
                        >
                          <Sparkles className="w-3.5 h-3.5" /> Seed from assignments
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={addScore}
                          className="gap-1.5 h-7"
                          data-testid="btn-add-score"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add row
                        </Button>
                      </div>
                    </div>

                    {scenario.hypotheticalScores.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        No scores yet. Seed from your real assignments or add rows to model a
                        what-if.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {scenario.hypotheticalScores.map((s) => (
                          <div
                            key={s.id}
                            className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-border bg-card"
                            data-testid={`score-row-${s.id}`}
                          >
                            <Input
                              value={s.name}
                              onChange={(e) => updateScore(s.id, { name: e.target.value })}
                              className="h-8 text-sm flex-1 min-w-[140px]"
                              placeholder="Item name"
                              data-testid={`input-score-name-${s.id}`}
                            />

                            {usesCategories && (
                              <Select
                                value={s.categoryId ?? "none"}
                                onValueChange={(v) =>
                                  updateScore(s.id, { categoryId: v === "none" ? undefined : v })
                                }
                              >
                                <SelectTrigger
                                  className="h-8 w-[130px] text-sm"
                                  data-testid={`select-score-category-${s.id}`}
                                >
                                  <SelectValue placeholder="Category" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No category</SelectItem>
                                  {categories.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}

                            {usesCategories ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={s.percentage ?? ""}
                                  onChange={(e) =>
                                    updateScore(s.id, { percentage: numOrNull(e.target.value) })
                                  }
                                  className="h-8 text-sm w-20"
                                  placeholder="%"
                                  data-testid={`input-score-percentage-${s.id}`}
                                />
                                <span className="text-xs text-muted-foreground">%</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={s.pointsEarned ?? ""}
                                  onChange={(e) =>
                                    updateScore(s.id, { pointsEarned: numOrNull(e.target.value) })
                                  }
                                  className="h-8 text-sm w-20"
                                  placeholder="Earned"
                                  data-testid={`input-score-earned-${s.id}`}
                                />
                                <span className="text-xs text-muted-foreground">/</span>
                                <Input
                                  type="number"
                                  value={s.pointsPossible ?? ""}
                                  onChange={(e) =>
                                    updateScore(s.id, { pointsPossible: numOrNull(e.target.value) })
                                  }
                                  className="h-8 text-sm w-20"
                                  placeholder="Total"
                                  data-testid={`input-score-possible-${s.id}`}
                                />
                              </div>
                            )}

                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => removeScore(s.id)}
                              className="h-8 w-8 text-muted-foreground hover:text-destructive ml-auto"
                              data-testid={`btn-remove-score-${s.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={saveScenario} className="gap-1.5" data-testid="btn-save-scenario">
                      <Save className="w-4 h-4" /> Save scenario
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Target solver */}
              <Card data-testid="target-solver-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Target solver
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    What do you need on one upcoming item to reach a target overall grade?
                    Existing scores above are held fixed.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="target-pct" className="text-xs">
                        Target overall %
                      </Label>
                      <Input
                        id="target-pct"
                        type="number"
                        value={targetPercent}
                        onChange={(e) => setTargetPercent(e.target.value)}
                        className="h-9 w-28"
                        data-testid="input-target-percent"
                      />
                    </div>

                    {scenario.mode === "points_estimate" ? (
                      <div className="space-y-1">
                        <Label htmlFor="target-points" className="text-xs">
                          Upcoming item points
                        </Label>
                        <Input
                          id="target-points"
                          type="number"
                          value={targetPointsPossible}
                          onChange={(e) => setTargetPointsPossible(e.target.value)}
                          className="h-9 w-32"
                          data-testid="input-target-points"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs">Upcoming item category</Label>
                        <Select value={targetCategoryId} onValueChange={setTargetCategoryId}>
                          <SelectTrigger
                            className="h-9 w-[160px]"
                            data-testid="select-target-category"
                          >
                            <SelectValue placeholder="Pick category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div
                    className="p-3 rounded-md bg-muted/40 border border-border"
                    data-testid="target-result"
                  >
                    {targetResult == null ? (
                      <p className="text-sm text-muted-foreground">
                        Enter a target{" "}
                        {scenario.mode === "points_estimate"
                          ? "and the upcoming item's point value"
                          : "and pick a category"}{" "}
                        to see what you need.
                      </p>
                    ) : targetResult > 100 ? (
                      <p className="text-sm">
                        You'd need <strong>{round1(targetResult)}%</strong> — that's above 100%, so
                        this target isn't reachable with this single item alone.
                      </p>
                    ) : targetResult < 0 ? (
                      <p className="text-sm">
                        You've already secured this target — even a 0% wouldn't drop you below it.
                      </p>
                    ) : (
                      <p className="text-sm">
                        You need about <strong>{round1(targetResult)}%</strong> on that item to reach{" "}
                        {round1(numOrNull(targetPercent) ?? 0)}% overall.
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{UNOFFICIAL_DISCLAIMER}</p>
                </CardContent>
              </Card>

              {/* Saved scenarios */}
              <Card data-testid="saved-scenarios-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <FolderOpen className="w-4 h-4" />
                    Saved scenarios
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {savedScenarios.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No saved scenarios for this course yet. Build one above and hit Save.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {savedScenarios.map((sc) => (
                        <div
                          key={sc.id}
                          className="flex items-center gap-3 p-2.5 rounded-md border border-border"
                          data-testid={`saved-scenario-${sc.id}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{sc.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {MODE_LABELS[sc.mode]} ·{" "}
                              {sc.projectedPercentage != null
                                ? `${round1(sc.projectedPercentage)}%`
                                : "—"}{" "}
                              · {sc.hypotheticalScores.length} item(s)
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => loadScenario(sc.id)}
                            className="h-7"
                            data-testid={`btn-load-scenario-${sc.id}`}
                          >
                            Load
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteScenario(sc.id)}
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            data-testid={`btn-delete-scenario-${sc.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
