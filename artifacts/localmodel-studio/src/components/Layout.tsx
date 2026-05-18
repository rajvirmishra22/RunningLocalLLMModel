import { Link, useLocation } from "wouter";
import { LayoutDashboard, MessageSquare, Cpu, Settings, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", icon: LayoutDashboard, label: "Dashboard" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/models", icon: Cpu, label: "Models" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside
        data-testid="sidebar"
        className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-sidebar"
      >
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
            <Cpu className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-sidebar-foreground tracking-tight">
            LocalModel Studio
          </span>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive = path === "/" ? location === "/" : location.startsWith(path);
            return (
              <Link key={path} href={path}>
                <span
                  data-testid={`nav-${label.toLowerCase()}`}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-sidebar-border">
          <div
            data-testid="local-mode-badge"
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-500/10 border border-green-500/20"
          >
            <Shield className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            <div>
              <div className="text-xs font-semibold text-green-500 leading-none">Local Mode</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-none">No cloud</div>
            </div>
            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
