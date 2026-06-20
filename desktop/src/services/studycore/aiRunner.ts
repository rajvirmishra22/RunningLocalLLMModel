// Unified AI execution for every StudyCore feature (assignment help, rubric
// check, study plan narration, growth summary). Wraps the local WebLLM engine
// and the cloud providers behind ONE streaming interface, and records a
// privacy/processing-history entry for each run (metadata only — never the
// prompt). Pages should never call webllmService/streamCloudChat directly for
// academic features; they go through here so logging + privacy stay consistent.

import {
  GEMINI_MODEL_PRESETS,
  hasKey,
  loadCloudConfig,
  streamCloudChat,
  type CloudMessage,
  type CloudProvider,
} from "../cloudProviders";
import { getCatalog, webllmService } from "../webllmService";
import { logProcessing } from "./privacy";
import type { ProcessingActionType } from "./types";

export type ModelChoice =
  | { kind: "local"; modelId: string; label: string }
  | { kind: "cloud"; provider: CloudProvider; model: string; label: string };

export function isCloudChoice(c: ModelChoice): c is Extract<ModelChoice, { kind: "cloud" }> {
  return c.kind === "cloud";
}

export interface AvailableModelGroup {
  kind: "local" | "cloud";
  provider?: CloudProvider;
  label: string;
  models: { id: string; label: string; note?: string }[];
}

/**
 * What model choices to surface in a "Choose Model" step: the in-browser local
 * catalog plus any cloud provider the student has configured a key for.
 */
export function getAvailableModelGroups(): AvailableModelGroup[] {
  const groups: AvailableModelGroup[] = [];

  groups.push({
    kind: "local",
    label: "On your device (private)",
    models: getCatalog().map((m) => ({
      id: m.id,
      label: m.label,
      note: m.sizeMb ? `${(m.sizeMb / 1000).toFixed(1)} GB` : undefined,
    })),
  });

  const cfg = loadCloudConfig();
  if (hasKey(cfg, "gemini")) {
    groups.push({
      kind: "cloud",
      provider: "gemini",
      label: "Google Gemini (cloud)",
      models: GEMINI_MODEL_PRESETS.map((m) => ({ id: m.id, label: m.label, note: m.note })),
    });
  }

  return groups;
}

/** Recommend a sensible default: the loaded local model, else first local. */
export function recommendedChoice(): ModelChoice | null {
  const loaded = webllmService.getLoadedModelId();
  const catalog = getCatalog();
  if (loaded) {
    const m = catalog.find((c) => c.id === loaded);
    return { kind: "local", modelId: loaded, label: m?.label ?? loaded };
  }
  if (catalog.length > 0) {
    return { kind: "local", modelId: catalog[0].id, label: catalog[0].label };
  }
  return null;
}

export interface RunHelpOptions {
  choice: ModelChoice;
  /** Optional system instruction (local models accept a system role). */
  systemPrompt?: string;
  /** The fully-assembled user prompt (context already built by aiContext/rubric). */
  prompt: string;
  /** For the privacy/processing log. */
  actionType: ProcessingActionType;
  includedFiles?: boolean;
  includedCourseLibraryExcerpts?: boolean;
  temperature?: number;
  maxTokens?: number;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  signal: AbortSignal;
  /** Local models may need to load first; report progress for a nice UI. */
  onLoadProgress?: (p: { text: string; progress: number }) => void;
}

/**
 * Run an AI request, streaming tokens via callbacks. Handles loading a local
 * model on demand. Logs a processing-history entry when the run completes.
 */
export async function runHelp(opts: RunHelpOptions): Promise<void> {
  const {
    choice,
    prompt,
    systemPrompt,
    onToken,
    onDone,
    onError,
    signal,
  } = opts;

  const logDone = () => {
    logProcessing({
      actionType: opts.actionType,
      modelId: choice.kind === "local" ? choice.modelId : choice.model,
      processingType: choice.kind === "local" ? "local" : "cloud",
      provider: choice.kind === "cloud" ? choice.provider : undefined,
      includedFiles: opts.includedFiles,
      includedCourseLibraryExcerpts: opts.includedCourseLibraryExcerpts,
    });
  };

  if (choice.kind === "cloud") {
    const cfg = loadCloudConfig();
    const apiKey = cfg.geminiKey;
    const messages: CloudMessage[] = [];
    // Gemini takes user/model turns; fold any system prompt into the first
    // user turn so a single assembled prompt reaches the model.
    const userContent = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    messages.push({ role: "user", content: userContent });
    await streamCloudChat(
      choice.provider,
      choice.model,
      messages,
      apiKey,
      {
        onToken,
        onDone: () => {
          logDone();
          onDone();
        },
        onAbort: () => onDone(),
        onError,
      },
      signal,
    );
    return;
  }

  // Local: ensure the engine is loaded for this model id.
  const abort = new AbortController();
  signal.addEventListener("abort", () => abort.abort());
  try {
    if (webllmService.getLoadedModelId() !== choice.modelId) {
      await webllmService.loadModel(choice.modelId, (p) =>
        opts.onLoadProgress?.({ text: p.text, progress: p.progress }),
      );
    }
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  await webllmService.streamChat(
    choice.modelId,
    messages,
    { temperature: opts.temperature ?? 0.7, maxTokens: opts.maxTokens ?? 2048 },
    onToken,
    () => {
      logDone();
      onDone();
    },
    onError,
    abort,
  );
}
