import { useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BookOpen,
  CalendarRange,
  Clock,
  GraduationCap,
  Shield,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import { ASSIGNMENT_TYPE_LABELS, isAssessment } from "@/services/studycore/assignmentType";
import { assignmentStore, courseStore, studyPlanStore } from "@/services/studycore/store";
import type { Assignment, Course } from "@/services/studycore/types";

function dueLabel(iso?: string | null): { text: string; urgent: boolean; overdue: boolean } {
  if (!iso) return { text: "No due date", urgent: false, overdue: false };
  const due = new Date(iso);
  const now = new Date();
  const ms = due.getTime() - now.getTime();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (ms < 0) return { text: `Overdue`, urgent: true, overdue: true };
  if (days === 0) return { text: "Due today", urgent: true, overdue: false };
  if (days === 1) return { text: "Due tomorrow", urgent: true, overdue: false };
  return { text: `Due in ${days} days`, urgent: days <= 3, overdue: false };
}

export default function Home() {
  const courses = courseStore.list();
  const assignments = assignmentStore.list();
  const courseById = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.id, c] as const)),
    [courses],
  );

  const upcoming = useMemo(
    () =>
      assignments
        .filter((a) => a.status !== "submitted" && a.status !== "graded")
        .filter((a) => a.dueDate)
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
        .slice(0, 6),
    [assignments],
  );

  const latestPlan = studyPlanStore.latest();
  const todayBlocks = useMemo(() => {
    if (!latestPlan) return [];
    const today = new Date().toISOString().slice(0, 10);
    return latestPlan.blocks.filter((b) => b.scheduledStart.slice(0, 10) === today);
  }, [latestPlan]);

  const gradedCount = assignments.filter((a) => a.status === "graded").length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-home-title">
            Welcome back
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's what's ahead. Everything below lives on your device.
          </p>
        </div>
        <PrivacyBadge kind="local_only" />
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="Courses" value={courses.length} to="/grades" />
        <StatCard icon={Clock} label="Upcoming" value={upcoming.length} to="/assignments" />
        <StatCard icon={GraduationCap} label="Graded" value={gradedCount} to="/grades" />
        <StatCard
          icon={CalendarRange}
          label="Today's blocks"
          value={todayBlocks.length}
          to="/planner"
        />
      </section>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Upcoming assignments</h2>
            <Link href="/assignments">
              <Button variant="ghost" size="sm" data-testid="link-all-assignments">
                View all <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              Nothing due right now. Enjoy the breather.
            </Card>
          ) : (
            <div className="space-y-2">
              {upcoming.map((a) => (
                <UpcomingRow key={a.id} assignment={a} course={courseById[a.courseId]} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Quick actions</h2>
          <div className="space-y-2">
            <QuickAction to="/assignments" icon={Sparkles} label="Get AI help on an assignment" />
            <QuickAction to="/planner" icon={CalendarRange} label="Generate a study plan" />
            <QuickAction to="/rubric" icon={BookOpen} label="Check work against a rubric" />
            <QuickAction to="/grades" icon={GraduationCap} label="Run a What-If grade" />
            <QuickAction to="/privacy" icon={Shield} label="Review your privacy" />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: typeof BookOpen;
  label: string;
  value: number;
  to: string;
}) {
  return (
    <Link href={to}>
      <Card
        className="p-4 hover:border-primary/40 transition-colors cursor-pointer"
        data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Icon className="w-5 h-5 text-muted-foreground mb-2" />
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </Card>
    </Link>
  );
}

function UpcomingRow({ assignment, course }: { assignment: Assignment; course?: Course }) {
  const due = dueLabel(assignment.dueDate);
  return (
    <Link href={`/assignments/${assignment.id}`}>
      <Card
        className="p-4 flex items-center gap-3 hover:border-primary/40 transition-colors cursor-pointer"
        data-testid={`home-assignment-${assignment.id}`}
      >
        <div
          className="w-1.5 h-10 rounded-full flex-shrink-0"
          style={{ backgroundColor: course?.color ?? "hsl(var(--primary))" }}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{assignment.title}</div>
          <div className="text-xs text-muted-foreground truncate">
            {course?.name ?? "Course"} · {ASSIGNMENT_TYPE_LABELS[assignment.type]}
            {isAssessment(assignment.type) && " · Study Guide only"}
          </div>
        </div>
        <span
          className={
            "text-xs font-medium whitespace-nowrap " +
            (due.overdue
              ? "text-destructive"
              : due.urgent
                ? "text-amber-500"
                : "text-muted-foreground")
          }
        >
          {due.text}
        </span>
      </Card>
    </Link>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof BookOpen;
  label: string;
}) {
  return (
    <Link href={to}>
      <Card
        className="p-3 flex items-center gap-3 hover:border-primary/40 transition-colors cursor-pointer"
        data-testid={`quick-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
      >
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm font-medium">{label}</span>
        <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto" />
      </Card>
    </Link>
  );
}
