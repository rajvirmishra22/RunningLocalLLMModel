/**
 * Bring-your-own-API-key cloud provider integration.
 *
 * The app is local-first — running open-source models on the user's own
 * hardware is still the headline feature. This module is an *optional*
 * escape hatch: users who already have an OpenAI or Anthropic API key can
 * paste it in Settings and use those models from the chat UI without ever
 * leaving the app.
 *
 * IMPORTANT: A ChatGPT Plus or Claude Pro consumer subscription is NOT the
 * same thing as API access. The two are billed and authenticated separately.
 * Third-party apps like this one can only use the developer API, which is
 * pay-per-token and requires an API key from platform.openai.com /
 * console.anthropic.com. We surface this clearly in Settings so users don't
 * paste their account password expecting it to work.
 *
 * Keys live in localStorage. That's adequate for a personal-use app but is
 * NOT a hardened secret store — anyone with access to the user's browser
 * profile can read them. Settings makes that explicit. (Desktop uses the
 * same approach via the webview's localStorage; a future hardening step
 * would move keys behind Tauri's stronghold plugin.)
 */

export type CloudProvider = "openai" | "anthropic";

export interface CloudProviderConfig {
  /** Empty string = not configured. We never auto-default this from env. */
  openaiKey: string;
  openaiModel: string;
  anthropicKey: string;
  anthropicModel: string;
}

/** Currently-stable defaults. Users can override with any string in Settings,
 *  so new model IDs don't require a code change. */
export const DEFAULT_CLOUD_CONFIG: CloudProviderConfig = {
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
  anthropicKey: "",
  anthropicModel: "claude-3-5-sonnet-20241022",
};

/** Curated dropdown options. Users can also paste any custom model ID. */
export const OPENAI_MODEL_PRESETS: Array<{ id: string; label: string; note: string }> = [
  { id: "gpt-4o-mini", label: "GPT-4o mini", note: "Cheapest. Great for chat." },
  { id: "gpt-4o", label: "GPT-4o", note: "Flagship multimodal model." },
  { id: "o1-mini", label: "o1-mini", note: "Reasoning model. Slower, costlier." },
  { id: "o1", label: "o1", note: "Top reasoning model. Pricey." },
];

export const ANTHROPIC_MODEL_PRESETS: Array<{ id: string; label: string; note: string }> = [
  { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", note: "Cheapest. Fast." },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", note: "Balanced default." },
  { id: "claude-3-opus-20240229", label: "Claude 3 Opus", note: "Older flagship. Costly." },
];

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

export function hasKey(cfg: CloudProviderConfig, provider: CloudProvider): boolean {
  return provider === "openai" ? cfg.openaiKey.trim().length > 0 : cfg.anthropicKey.trim().length > 0;
}

/** Trimmed view of one chat turn — same shape both providers accept. */
export interface CloudMessage {
  role: "user" | "assistant";
  content: string;
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
 * Unified streaming chat for OpenAI and Anthropic. Both APIs use Server-Sent
 * Events but with different payload shapes — we parse each into a flat token
 * stream and call back identically so the chat UI can be provider-agnostic.
 *
 * Returns immediately and streams via the callbacks. Pass an AbortController
 * to support Stop.
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
      throw new Error(`No ${provider === "openai" ? "OpenAI" : "Anthropic"} API key configured. Add one in Settings.`);
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
  provider: CloudProvider,
  model: string,
  messages: CloudMessage[],
  apiKey: string,
): { url: string; headers: Record<string, string>; body: unknown } {
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: { model, messages, stream: true },
    };
  }

  // Anthropic. The "dangerous-direct-browser-access" header is the official
  // opt-in for first-party browser calls without a backend proxy. It's not
  // dangerous in the security sense — it just signals the user accepts that
  // their key is reachable from JS.
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: { model, messages, max_tokens: 4096, stream: true },
  };
}

/**
 * Parse a single SSE event block (everything between two blank lines) and
 * return the user-visible text delta it carries, if any.
 *
 * OpenAI events look like: `data: {"choices":[{"delta":{"content":"hi"}}]}`
 * Anthropic events look like: `event: content_block_delta\ndata: {...}` and
 * we only care about the `content_block_delta` events.
 */
function extractToken(provider: CloudProvider, event: string): string | null {
  const lines = event.split("\n");
  let eventType = "";
  let dataLine = "";
  for (const line of lines) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
  }
  if (!dataLine || dataLine === "[DONE]") return null;

  try {
    const data = JSON.parse(dataLine);
    if (provider === "openai") {
      const delta = data?.choices?.[0]?.delta?.content;
      return typeof delta === "string" && delta.length > 0 ? delta : null;
    }
    // Anthropic
    if (eventType === "content_block_delta") {
      const delta = data?.delta?.text;
      return typeof delta === "string" && delta.length > 0 ? delta : null;
    }
    if (eventType === "message_delta" || eventType === "message_stop" || eventType === "ping") {
      return null;
    }
    if (data?.type === "error") {
      throw new Error(data?.error?.message ?? "Provider returned an error mid-stream.");
    }
    return null;
  } catch (e) {
    // Malformed event — skip rather than crash the stream.
    if (e instanceof Error && e.message.includes("Provider returned")) throw e;
    return null;
  }
}

function humanizeHttpError(provider: CloudProvider, status: number, body: string): string {
  const name = provider === "openai" ? "OpenAI" : "Anthropic";
  if (status === 401) return `${name} rejected the API key. Double-check it in Settings.`;
  if (status === 403) return `${name} blocked the request — the key may not have permission for this model.`;
  if (status === 404) return `${name} doesn't recognize that model name. Check the model ID in Settings.`;
  if (status === 429) return `${name} rate-limited the request. You've hit your usage cap, or you're sending too fast.`;
  if (status === 402 || status === 400) {
    // Surface the provider's own message — usually informative.
    const snippet = body.length > 240 ? body.slice(0, 240) + "…" : body;
    return `${name} returned ${status}: ${snippet || "Bad request."}`;
  }
  if (status >= 500) return `${name} is having problems (${status}). Try again in a moment.`;
  return `${name} returned HTTP ${status}.`;
}

/**
 * Quick "does this key work" check, used by the Settings Test button. Does a
 * minimal request to each provider — for OpenAI a free GET /v1/models, for
 * Anthropic a 1-token POST since they don't expose a free auth check.
 */
export async function testProviderKey(
  provider: CloudProvider,
  apiKey: string,
  model?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiKey.trim()) return { ok: false, error: "Key is empty." };
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) return { ok: true };
      const text = await res.text().catch(() => "");
      return { ok: false, error: humanizeHttpError("openai", res.status, text) };
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: model ?? DEFAULT_CLOUD_CONFIG.anthropicModel,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, error: humanizeHttpError("anthropic", res.status, text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
