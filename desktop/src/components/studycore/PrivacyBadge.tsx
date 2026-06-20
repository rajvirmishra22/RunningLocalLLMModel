import { Cloud, FileCheck, FileX, HardDrive, Lock, School, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIVACY_BADGE_LABELS } from "@/services/studycore/privacy";
import type { PrivacyBadgeKind } from "@/services/studycore/types";

const BADGE_META: Record<
  PrivacyBadgeKind,
  { icon: typeof Lock; className: string }
> = {
  local_only: {
    icon: Lock,
    className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  },
  cloud_processing: {
    icon: Cloud,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  canvas_synced: {
    icon: School,
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  teams_synced: {
    icon: Users,
    className: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  },
  stored_on_device: {
    icon: HardDrive,
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20",
  },
  included_in_ai_context: {
    icon: FileCheck,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
  not_included: {
    icon: FileX,
    className: "bg-muted text-muted-foreground border-border",
  },
};

interface PrivacyBadgeProps {
  kind: PrivacyBadgeKind;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}

/** Consistent privacy indicator used across assignments, rubric checks,
 *  growth summaries and study plans. */
export function PrivacyBadge({ kind, label, className, size = "md" }: PrivacyBadgeProps) {
  const meta = BADGE_META[kind];
  const Icon = meta.icon;
  return (
    <span
      data-testid={`privacy-badge-${kind}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        meta.className,
        className,
      )}
    >
      <Icon className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      {label ?? PRIVACY_BADGE_LABELS[kind]}
    </span>
  );
}
