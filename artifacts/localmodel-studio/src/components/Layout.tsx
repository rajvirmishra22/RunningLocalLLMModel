import { Link, useLocation } from "wouter";
import {
  BookMarked,
  BookOpen,
  CalendarRange,
  Cpu,
  GraduationCap,
  Home,
  LayoutDashboard,
  Library,
  Link2,
  MessageSquare,
  Settings,
  Shield,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { courseLibraryStore } from "@/services/studycore/store";

interface NavItem {
  path: string;
  icon: typeof Home;
  label: string;
  /** Matches the start of the location for active state on detail routes. */
  match?: string;
}

const PRIMARY_NAV: NavItem[] = [
  { path: "/", icon: Home, label: "Home" },
  { path: "/assignments", icon: BookOpen, label: "Assignments", match: "/assignments" },
  { path: "/planner", icon: CalendarRange, label: "Planner" },
  { path: "/grades", icon: GraduationCap, label: "Grades" },
  { path: "/growth", icon: TrendingUp, label: "Growth" },
];

const LIBRARY_NAV: NavItem = { path: "/library", icon: Library, label: "Course Library" };

const STUDY_NAV: NavItem[] = [
  { path: "/study-space", icon: MessageSquare, label: "Study Space" },
  { path: "/rubric", icon: BookMarked, label: "Rubric Checker" },
  { path: "/models", icon: Cpu, label: "Models" },
];

const SYSTEM_NAV: NavItem[] = [
  { path: "/connections", icon: Link2, label: "Connections" },
  { path: "/privacy", icon: Shield, label: "Privacy Center" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

interface LayoutProps {
  children: React.ReactNode;
}

function NavLink({ item, location }: { item: NavItem; location: string }) {
  const target = item.match ?? item.path;
  const isActive =
    target === "/" ? location === "/" : location === target || location.startsWith(`${target}/`);
  const Icon = item.icon;
  return (
    <Link key={item.path} href={item.path}>
      <span
        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        {item.label}
      </span>
    </Link>
  );
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  // Course Library stays hidden from the primary nav until the student opts in
  // to the Course Knowledge Base. It still has a route (enable empty-state).
  const libraryEnabled = courseLibraryStore.get().enabled;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside
        data-testid="sidebar"
        className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-sidebar"
      >
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
            <LayoutDashboard className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-sidebar-foreground tracking-tight">
            StudyCore AI
          </span>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.path} item={item} location={location} />
          ))}
          {libraryEnabled && <NavLink item={LIBRARY_NAV} location={location} />}

          <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Study Tools
          </div>
          {STUDY_NAV.map((item) => (
            <NavLink key={item.path} item={item} location={location} />
          ))}

          <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            System
          </div>
          {SYSTEM_NAV.map((item) => (
            <NavLink key={item.path} item={item} location={location} />
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-sidebar-border">
          <div
            data-testid="local-mode-badge"
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-500/10 border border-green-500/20"
          >
            <Shield className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            <div>
              <div className="text-xs font-semibold text-green-500 leading-none">Local-First</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                Private by default
              </div>
            </div>
            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
