/**
 * Bring-your-own-API-key cloud provider integration.
 *
 * The app is local-first — running open-source models on the user's own
 * hardware is still the headline feature. This module is an *optional*
 * escape hatch: users who have a Google Gemini API key can paste it in
 * Settings and use Gemini's cloud models from the chat UI.
 *
 * Gemini is the only cloud provider here, chosen because Google AI Studio
 * gives out a genuinely free API key (no credit card required for the free
 * tier) at https://aistudio.google.com/apikey — a good fit for students.
 * Calls go DIRECTLY from the client to Google's Generative Language API; we
 * never proxy them through a backend.
 *
 * Keys live in localStorage. That's adequate for a personal-use app but is
 * NOT a hardened secret store — anyone with access to the user's browser
 * profile can read them. Settings makes that explicit. (Desktop uses the
 * same approach via the webview's localStorage; a future hardening step
 * would move keys behind Tauri's stronghold plugin.)
 */

export type CloudProvider = "gemini";

export interface CloudProviderConfig {
  /** Empty string = not configured. We never auto-default this from env. */
  geminiKey: string;
  geminiModel: string;
}

/** Currently-stable defaults. Users can override with any string in Settings,
 *  so new model IDs don't require a code change. */
export const DEFAULT_CLOUD_CONFIG: CloudProviderConfig = {
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
};

/**
 * Model IDs publicly callable on Gemini's Generative Language API
 * (`/v1beta/models/<id>:streamGenerateContent`). Users can still paste any
 * custom ID — this list is just to save typing. All listed models are
 * multimodal (accept image inputs). Kept "newest / most useful first".
 */
export const GEMINI_MODEL_PRESETS: Array<{ id: string; label: string; note: string }> = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Fast & free-tier friendly. Recommended." },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Most capable. Lower free limits." },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", note: "Cheapest & fastest 2.5." },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", note: "Fast, multimodal, generous free tier." },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite", note: "Lightest 2.0." },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", note: "Older fast model." },
  { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash-8B", note: "Smallest 1.5." },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", note: "Older capable model." },
];

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const STORAGE_KEY = "lms_cloud_config";

export function loadCloudConfig(): CloudProviderConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_CLOUD_CONFIG };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_CLOUD_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CLOUD_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CLOUD_CONFIG };
  }
}

export function saveCloudConfig(cfg: CloudProviderConfig): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearCloudConfig(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function hasKey(cfg: CloudProviderConfig, _provider: CloudProvider = "gemini"): boolean {
  return cfg.geminiKey.trim().length > 0;
}

/** A piece of a multimodal user message. Text-only conversations only ever
 *  use the `string` shortcut; vision-enabled chats pass a parts array. */
export type CloudContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      /** Full `data:image/...;base64,...` URL. Pre-resized client-side
       *  before reaching this layer so we don't ship 12MP photos over the
       *  wire and blow past provider request-size limits. */
      dataUrl: string;
      /** e.g. "image/jpeg" / "image/png" / "image/webp". Used as Gemini's
       *  `inlineData.mimeType` field. */
      mimeType: string;
    };

/** Trimmed view of one chat turn. */
export interface CloudMessage {
  role: "user" | "assistant";
  /** Either a plain string (text-only) or a parts array (text + images). */
  content: string | CloudContentPart[];
}

/**
 * Whether the given model id accepts image inputs. Every current Gemini chat
 * model (1.5, 2.0, 2.5) is multimodal, so we return true for any `gemini-1.5`
 * / `gemini-2.*` id and false otherwise (e.g. embedding models, custom typos).
 */
export function cloudModelSupportsVision(
  _provider: CloudProvider,
  model: string,
): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  if (m.includes("embedding") || m.includes("embed")) return false;
  return /^gemini-(1\.5|2)/.test(m);
}

export interface CloudStreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  /**
   * Called when the stream is aborted (user clicked Stop). Distinct from
   * `onDone` so callers can decide whether to persist a partial reply or drop
   * it. If omitted, aborts complete silently — no `onDone` is fired.
   */
  onAbort?: () => void;
  onError: (err: Error) => void;
}

/**
 * Streaming chat for Gemini. The Generative Language API streams Server-Sent
 * Events when called with `?alt=sse`; we parse each event into a flat token
 * stream and call back so the chat UI stays runtime-agnostic.
 *
 * Returns immediately and streams via the callbacks. Pass an AbortSignal to
 * support Stop.
 */
export async function streamCloudChat(
  provider: CloudProvider,
  model: string,
  messages: CloudMessage[],
  apiKey: string,
  callbacks: CloudStreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (!apiKey.trim()) {
      throw new Error("No Gemini API key configured. Add a free key from aistudio.google.com/apikey in Settings.");
    }

    const { url, headers, body } = buildRequest(provider, model, messages, apiKey);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(humanizeHttpError(provider, res.status, text));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by blank lines. Process whole events only.
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const token = extractToken(provider, event);
        if (token) callbacks.onToken(token);
      }
    }

    callbacks.onDone();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // User clicked Stop. Surface this distinctly from a clean finish so the
      // caller can decide whether to persist what was streamed so far.
      callbacks.onAbort?.();
      return;
    }
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

function buildRequest(
  _provider: CloudProvider,
  model: string,
  messages: CloudMessage[],
  apiKey: string,
): { url: string; headers: Record<string, string>; body: unknown } {
  // Gemini. The key goes in the query string per Google's docs; calls are made
  // directly from the client (no backend proxy). We fold any system role into
  // `systemInstruction` upstream, so here every turn is user/model content.
  return {
    url: `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      contents: messages.map(toGeminiContent),
      generationConfig: { maxOutputTokens: 4096 },
    },
  };
}

/** Strip the `data:<mime>;base64,` prefix off a data URL and return the raw
 *  base64 payload. Gemini's `inlineData.data` wants the base64 alone, with the
 *  mime type carried separately. */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function toGeminiContent(m: CloudMessage): unknown {
  // Gemini uses "user" / "model" roles (assistant -> model).
  const role = m.role === "assistant" ? "model" : "user";
  if (typeof m.content === "string") {
    return { role, parts: [{ text: m.content }] };
  }
  const parts = m.content.map((p) =>
    p.type === "text"
      ? { text: p.text }
      : {
          inlineData: {
            mimeType: p.mimeType,
            data: stripDataUrlPrefix(p.dataUrl),
          },
        },
  );
  return { role, parts };
}

/**
 * Parse a single SSE event block (everything between two blank lines) and
 * return the user-visible text delta it carries, if any.
 *
 * Gemini SSE events look like:
 * `data: {"candidates":[{"content":{"parts":[{"text":"hi"}],"role":"model"}}]}`
 */
function extractToken(_provider: CloudProvider, event: string): string | null {
  const lines = event.split("\n");
  let dataLine = "";
  for (const line of lines) {
    if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!dataLine || dataLine === "[DONE]") return null;

  try {
    const data = JSON.parse(dataLine);
    if (data?.error) {
      throw new Error(data?.error?.message ?? "Gemini returned an error mid-stream.");
    }
    const parts = data?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts
        .map((p: unknown) =>
          p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
            ? (p as { text: string }).text
            : "",
        )
        .join("");
      return text.length > 0 ? text : null;
    }
    return null;
  } catch (e) {
    // Malformed event — skip rather than crash the stream.
    if (e instanceof Error && e.message.includes("Gemini returned")) throw e;
    return null;
  }
}

/**
 * Pull the provider's structured error code/message out of a JSON error body.
 * Gemini: `{ error: { code, status, message } }`.
 */
function parseProviderError(body: string): { code?: string; message?: string } {
  try {
    const data = JSON.parse(body);
    const err = data?.error ?? data;
    const code =
      typeof err?.status === "string"
        ? err.status
        : typeof err?.code === "string"
          ? err.code
          : undefined;
    const message = typeof err?.message === "string" ? err.message : undefined;
    return { code, message };
  } catch {
    return {};
  }
}

function humanizeHttpError(_provider: CloudProvider, status: number, body: string): string {
  const name = "Gemini";
  const { code, message } = parseProviderError(body);
  const tag = `${code ?? ""} ${message ?? ""}`.toLowerCase();

  if (
    status === 400 &&
    (tag.includes("api key not valid") || tag.includes("api_key_invalid") || tag.includes("invalid api key"))
  ) {
    return `${name} rejected the API key. Get a free key at aistudio.google.com/apikey and paste it in Settings.`;
  }
  if (status === 401) {
    return `${name} rejected the API key. Get a free key at aistudio.google.com/apikey and paste it in Settings.`;
  }
  if (status === 403) {
    return `${name} blocked the request — the key may be restricted or the Generative Language API isn't enabled for it. Create a fresh free key at aistudio.google.com/apikey.`;
  }
  if (status === 404) {
    return `${name} doesn't recognize that model name. Pick a model like "gemini-2.5-flash" in Settings.`;
  }
  if (status === 429) {
    // Gemini's free tier is rate-limited (requests per minute AND per day), not
    // billing-gated — so a 429 means slow down or you've hit the daily cap.
    return `${name} hit its free-tier limit — Google caps free requests per minute and per day. Wait a minute and try again, switch to a lighter model like Gemini 2.0 Flash, or use a local model (always free, no limits).${message ? ` (${message})` : ""}`;
  }
  if (status === 400) {
    const snippet = body.length > 240 ? body.slice(0, 240) + "…" : body;
    return `${name} returned 400: ${snippet || "Bad request."}`;
  }
  if (status >= 500) return `${name} is having problems (${status}). Try again in a moment.`;
  return `${name} returned HTTP ${status}.`;
}

/**
 * Quick "does this key work" check, used by the Settings Test button. Hits the
 * free `GET /v1beta/models` list endpoint — no token spend, validates the key.
 */
export async function testProviderKey(
  _provider: CloudProvider,
  apiKey: string,
  _model?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiKey.trim()) return { ok: false, error: "Key is empty." };
  try {
    const res = await fetch(`${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`);
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, error: humanizeHttpError("gemini", res.status, text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
