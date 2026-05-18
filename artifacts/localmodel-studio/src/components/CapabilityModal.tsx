import { useEffect, useState } from "react";
import { X, Cpu, Loader2 } from "lucide-react";
import { buildWebReport, probeBrowser, type CapabilityReport } from "@/services/capabilityReport";

/**
 * Dashboard popup that answers "what can my computer run?".
 *
 * Self-contained: probes hardware on mount and renders a static report. No
 * routing, no settings mutation, no chat impact — clicking the backdrop, the
 * X, or pressing Esc closes it. Deliberately distinct from the Tuning page,
 * which is interactive and writes back to your saved profiles.
 */
export function CapabilityModal({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<CapabilityReport | null>(null);

  useEffect(() => {
    let active = true;
    probeBrowser().then((probe) => {
      if (active) setReport(buildWebReport(probe));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="capability-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-card border border-border rounded-xl shadow-xl my-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="capability-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capability-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/15 flex items-center justify-center">
              <Cpu className="w-4 h-4 text-primary" />
            </div>
            <h2 id="capability-modal-title" className="text-sm font-semibold">
              What can your computer run?
            </h2>
          </div>
          <button
            onClick={onClose}
            data-testid="btn-capability-close"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {!report ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Probing your hardware…</span>
            </div>
          ) : (
            <ReportView report={report} />
          )}
        </div>
      </div>
    </div>
  );
}

function ReportView({ report }: { report: CapabilityReport }) {
  return (
    <>
      {/* Hardware summary strip. Keeps the user oriented on what we detected
          before showing recommendations derived from it. */}
      <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Your hardware:</span>{" "}
        {report.hardware.ramApproximate
          ? `≥ ${report.hardware.ramGb} GB`
          : `~${report.hardware.ramGb} GB`}{" "}
        RAM
        {report.hardware.cpuThreads ? ` · ${report.hardware.cpuThreads} threads` : ""}
        {report.hardware.webgpuAvailable ? " · WebGPU available" : " · WebGPU unavailable"}
        {report.hardware.gpuLabel ? ` · ${report.hardware.gpuLabel}` : ""}
      </div>

      <Section title="Your computer can comfortably run:">
        {report.comfortableModels.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing in the WebLLM catalog fits comfortably in your browser memory budget. Try the desktop build for more headroom.
          </p>
        ) : (
          <ul className="space-y-1" data-testid="comfortable-list">
            {report.comfortableModels.map((m) => (
              <li key={m.label} className="flex items-baseline gap-2 text-sm">
                <span className="text-primary">•</span>
                <span>{m.label}</span>
                <span className="text-[11px] text-muted-foreground">~{m.sizeGb.toFixed(1)} GB</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recommended setup:">
        <KV k="Model" v={report.recommended.modelLabel} highlight />
        <KV k="Context" v={String(report.recommended.context)} />
        <KV k="KV cache" v={report.recommended.kvCache} muted={report.recommended.kvCache.startsWith("Not")} />
        <KV
          k="FlashAttention"
          v={report.recommended.flashAttention}
          muted={report.recommended.flashAttention.startsWith("Not")}
        />
        <KV k="Backend" v={report.recommended.backend} />
        <KV k="Batch size" v={report.recommended.batchSize} muted />
      </Section>

      <Section title="Estimated performance:">
        <KVRow k="Memory fit">
          <FitChip fit={report.performance.memoryFit} />
        </KVRow>
        <KV k="Quality" v={report.performance.quality} />
        <KV k="Speed" v={report.performance.speed} />
      </Section>

      {report.caveats.length > 0 && (
        <div className="rounded-md bg-yellow-500/5 border border-yellow-500/20 px-3 py-2 space-y-1">
          {report.caveats.map((c, i) => (
            <p key={i} className="text-[11px] text-yellow-600 dark:text-yellow-400 leading-relaxed">
              {c}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ k, v, highlight, muted }: { k: string; v: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-xs text-muted-foreground flex-shrink-0">{k}</span>
      <span
        className={
          highlight
            ? "font-semibold text-right"
            : muted
              ? "text-muted-foreground text-xs text-right"
              : "font-medium text-right"
        }
      >
        {v}
      </span>
    </div>
  );
}

function KVRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-xs text-muted-foreground">{k}</span>
      {children}
    </div>
  );
}

function FitChip({ fit }: { fit: CapabilityReport["performance"]["memoryFit"] }) {
  const cls =
    fit === "Safe"
      ? "bg-green-500/15 text-green-500 border-green-500/30"
      : fit === "Tight"
        ? "bg-yellow-500/15 text-yellow-500 border-yellow-500/30"
        : fit === "Risky"
          ? "bg-red-500/15 text-red-500 border-red-500/30"
          : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-block text-[11px] px-2 py-0.5 rounded border font-medium ${cls}`}>{fit}</span>
  );
}
