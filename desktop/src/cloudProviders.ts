/**
 * Bring-your-own-API-key cloud provider integration for the desktop build.
 *
 * Mirrors artifacts/localmodel-studio/src/services/cloudProviders.ts. The
 * desktop build is fundamentally local-first (llama.cpp + bundled GGUF),
 * but users with an OpenAI or Anthropic API key can opt into using those
 * cloud models from the same chat UI.
 *
 * Calls go straight from the Tauri webview via fetch — no Rust hop. That
 * means the API key only ever lives in localStorage and in the request
 * headers, not in the native process. A future hardening step would move
 * keys behind Tauri's stronghold plugin.
 *
 * IMPORTANT: A ChatGPT Plus / Claude Pro consumer subscription cannot be
 * reused here. Only the developer API works, and it bills separately.
 */

export type CloudProvider = "openai" | "anthropic";

export interface CloudProviderConfig {
  openaiKey: string;
  openaiModel: string;
  anthropicKey: string;
  anthropicModel: string;
}

export const DEFAULT_CLOUD_CONFIG: CloudProviderConfig = {
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
  anthropicKey: "",
  anthropicModel: "claude-3-5-sonnet-20241022",
};

// Full set of model IDs publicly callable on each provider's standard chat API.
// Users can still paste a custom ID; this list just saves typing.
export const OPENAI_MODEL_PRESETS = [
  { id: "gpt-4.1", label: "GPT-4.1 (latest flagship)" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano (cheapest)" },
  { id: "o4-mini", label: "o4-mini (reasoning, cheap)" },
  { id: "o3", label: "o3 (top reasoning)" },
  { id: "o3-mini", label: "o3-mini (reasoning)" },
  { id: "o1", label: "o1 (older top reasoning)" },
  { id: "o1-mini", label: "o1-mini" },
  { id: "o1-preview", label: "o1-preview" },
  { id: "chatgpt-4o-latest", label: "ChatGPT-4o latest" },
  { id: "gpt-4o", label: "GPT-4o (multimodal flagship)" },
  { id: "gpt-4o-mini", label: "GPT-4o mini (cheap, fast)" },
  { id: "gpt-4o-2024-11-20", label: "GPT-4o (2024-11-20)" },
  { id: "gpt-4o-2024-08-06", label: "GPT-4o (2024-08-06)" },
  { id: "gpt-4o-2024-05-13", label: "GPT-4o (2024-05-13)" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { id: "gpt-4-turbo-2024-04-09", label: "GPT-4 Turbo (2024-04-09)" },
  { id: "gpt-4", label: "GPT-4 (original)" },
  { id: "gpt-4-32k", label: "GPT-4 32k" },
  { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo (legacy)" },
  { id: "gpt-3.5-turbo-16k", label: "GPT-3.5 Turbo 16k (legacy)" },
];

export const ANTHROPIC_MODEL_PRESETS = [
  { id: "claude-opus-4-5", label: "Claude Opus 4.5 (latest flagship)" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (latest balanced)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (latest cheap)" },
  { id: "claude-opus-4-0", label: "Claude Opus 4" },
  { id: "claude-sonnet-4-0", label: "Claude Sonnet 4" },
  { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet (latest)" },
  { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet (2025-02-19)" },
  { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet (latest)" },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (2024-10-22)" },
  { id: "claude-3-5-sonnet-20240620", label: "Claude 3.5 Sonnet (2024-06-20)" },
  { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (latest)" },
  { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (2024-10-22)" },
  { id: "claude-3-opus-latest", label: "Claude 3 Opus (latest)" },
  { id: "claude-3-opus-20240229", label: "Claude 3 Opus (2024-02-29)" },
  { id: "claude-3-sonnet-20240229", label: "Claude 3 Sonnet (legacy)" },
  { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku (legacy)" },
];

const STORAGE_KEY = "lms_desktop_cloud_config";

export function loadCloudConfig(): CloudProviderConfig {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_CLOUD_CONFIG };
  try {
    return { ...DEFAULT_CLOUD_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CLOUD_CONFIG };
  }
}

export function saveCloudConfig(cfg: CloudProviderConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function hasKey(cfg: CloudProviderConfig, provider: CloudProvider): boolean {
  return provider === "openai" ? cfg.openaiKey.trim().length > 0 : cfg.anthropicKey.trim().length > 0;
}

export interface CloudMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CloudStreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  /** Fired on user abort. If omitted, aborts complete silently. */
  onAbort?: () => void;
  onError: (err: Error) => void;
}

export async function streamCloudChat(
  provider: CloudProvider,
  model: string,
  messages: CloudMessage[],
  apiKey: string,
  cb: CloudStreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (!apiKey.trim()) {
      throw new Error(`No ${provider === "openai" ? "OpenAI" : "Anthropic"} API key configured. Open Cloud Keys to add one.`);
    }

    const req = buildRequest(provider, model, messages, apiKey);
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
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
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const token = extractToken(provider, event);
        if (token) cb.onToken(token);
      }
    }

    cb.onDone();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      cb.onAbort?.();
      return;
    }
    cb.onError(err instanceof Error ? err : new Error(String(err)));
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
    if (eventType === "content_block_delta") {
      const delta = data?.delta?.text;
      return typeof delta === "string" && delta.length > 0 ? delta : null;
    }
    if (data?.type === "error") {
      throw new Error(data?.error?.message ?? "Provider returned an error mid-stream.");
    }
    return null;
  } catch (e) {
    if (e instanceof Error && e.message.includes("Provider returned")) throw e;
    return null;
  }
}

function humanizeHttpError(provider: CloudProvider, status: number, body: string): string {
  const name = provider === "openai" ? "OpenAI" : "Anthropic";
  if (status === 401) return `${name} rejected the API key.`;
  if (status === 403) return `${name} blocked the request — the key may not have permission for this model.`;
  if (status === 404) return `${name} doesn't recognize that model name.`;
  if (status === 429) return `${name} rate-limited the request.`;
  if (status === 402 || status === 400) {
    const snippet = body.length > 240 ? body.slice(0, 240) + "…" : body;
    return `${name} returned ${status}: ${snippet || "Bad request."}`;
  }
  if (status >= 500) return `${name} is having problems (${status}). Try again in a moment.`;
  return `${name} returned HTTP ${status}.`;
}

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
