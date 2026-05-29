export interface ModelProfile {
  id: string;
  name: string;
  runtimeType: "webllm";
  modelIdentifier: string;
  contextLength: number;
  temperature: number;
  topP: number;
  maxTokens: number;
  /**
   * When false (default), chat generation uses sensible defaults and the
   * per-profile temperature/topP/maxTokens fields are ignored. Lets casual
   * users skip the generation-settings knobs entirely without losing the
   * ability to tune later.
   */
  useCustomGeneration: boolean;
  compatibility: "supported" | "experimental" | "unsupported";
}

/** Defaults used when a profile has `useCustomGeneration: false`. Kept here
 *  so Chat and Tuning agree on what "use defaults" means. */
export const DEFAULT_GENERATION = {
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 2048,
} as const;

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  /**
   * What the user actually typed — this is the ONLY thing rendered in the
   * chat bubble. Attachment text, RAG excerpts and any other internal
   * plumbing never live here.
   */
  content: string;
  /**
   * The full prompt actually sent to the model: attachment text and/or
   * retrieved RAG excerpts prepended to `content`. Kept separate so the
   * user never sees the extracted text, while the model still does, and so
   * multi-turn history re-sends the same augmented context. Falls back to
   * `content` when there was nothing to augment.
   */
  modelContent?: string;
  /**
   * Files/images attached to this turn, shown as small chips on the bubble
   * so the user can see what they uploaded without seeing its contents.
   */
  attachments?: { name: string; kind: "file" | "image" }[];
  timestamp: string;
  stats?: { tokensPerSec: number; totalTimeMs: number; modelUsed: string; runtimeUsed: string; };
  /**
   * Set on assistant turns whose context was augmented via RAG. The UI
   * surfaces this as a "Used N excerpts from filename.pdf" badge so the
   * user knows the model saw retrieved passages, not the whole document.
   */
  ragMeta?: {
    excerptCount: number;
    docs: { docId: string; name: string; usedExcerpts: number }[];
  };
}

export interface AppSettings {
  // Reserved for future preferences. Kept as an object so settings can grow without migrations.
  _placeholder?: never;
}

const STORAGE_KEYS = {
  MODELS: "lms_model_profiles",
  CONVERSATIONS: "lms_conversations",
  SETTINGS: "lms_settings",
};

const DEFAULT_SETTINGS: AppSettings = {};

const VALID_WEBLLM_IDS = new Set([
  "Llama-3.2-1B-Instruct-q4f32_1-MLC",
  "Llama-3.2-3B-Instruct-q4f32_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
  "Qwen2.5-3B-Instruct-q4f32_1-MLC",
  "Phi-3.5-mini-instruct-q4f16_1-MLC",
  "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
  "Llama-3.1-8B-Instruct-q4f32_1-MLC",
]);

// Maps legacy short-form model identifiers from earlier versions of the app
// to their current WebLLM-compatible IDs. Pure backward-compatibility cleanup —
// new profiles always use the WebLLM IDs directly.
const LEGACY_ID_TO_WEBLLM: Record<string, { id: string; label: string }> = {
  "llama3.2:1b": { id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", label: "Llama 3.2 1B" },
  "llama3.2:3b": { id: "Llama-3.2-3B-Instruct-q4f32_1-MLC", label: "Llama 3.2 3B" },
  "qwen2.5:1.5b": { id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", label: "Qwen 2.5 1.5B" },
  "qwen2.5:3b": { id: "Qwen2.5-3B-Instruct-q4f32_1-MLC", label: "Qwen 2.5 3B" },
  "phi3.5:mini": { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 Mini" },
  "mistral:7b": { id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", label: "Mistral 7B" },
  "llama3.1:8b": { id: "Llama-3.1-8B-Instruct-q4f32_1-MLC", label: "Llama 3.1 8B" },
};

interface LegacyProfile {
  id: string;
  name: string;
  runtimeType: string;
  modelIdentifier: string;
  contextLength?: number;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  useCustomGeneration?: boolean;
  compatibility?: "supported" | "experimental" | "unsupported";
}

function migrateProfiles(raw: unknown): ModelProfile[] {
  if (!Array.isArray(raw)) return [];
  const migrated: ModelProfile[] = [];
  const seenIdentifiers = new Set<string>();

  for (const p of raw as LegacyProfile[]) {
    if (!p || typeof p !== "object" || !p.id || !p.modelIdentifier) continue;

    // Already a valid webllm profile. We accept either a built-in catalog id
    // OR an id that doesn't match any legacy short-form key — the latter is
    // how user-added Hugging Face / custom catalog entries survive across
    // reloads (their ids are sanitized labels, not WebLLM ids).
    const isBuiltin = VALID_WEBLLM_IDS.has(p.modelIdentifier);
    const isLegacy = p.modelIdentifier in LEGACY_ID_TO_WEBLLM;
    if (p.runtimeType === "webllm" && (isBuiltin || !isLegacy)) {
      if (seenIdentifiers.has(p.modelIdentifier)) continue;
      seenIdentifiers.add(p.modelIdentifier);
      migrated.push({
        id: p.id,
        name: p.name,
        runtimeType: "webllm",
        modelIdentifier: p.modelIdentifier,
        contextLength: p.contextLength ?? 4096,
        temperature: p.temperature ?? 0.7,
        topP: p.topP ?? 0.9,
        maxTokens: p.maxTokens ?? 2048,
        useCustomGeneration: p.useCustomGeneration ?? false,
        compatibility: p.compatibility ?? "supported",
      });
      continue;
    }

    // Legacy short-form identifier we know how to map to a WebLLM ID
    const mapped = LEGACY_ID_TO_WEBLLM[p.modelIdentifier];
    if (mapped && !seenIdentifiers.has(mapped.id)) {
      seenIdentifiers.add(mapped.id);
      migrated.push({
        id: p.id,
        name: mapped.label,
        runtimeType: "webllm",
        modelIdentifier: mapped.id,
        contextLength: p.contextLength ?? 4096,
        temperature: p.temperature ?? 0.7,
        topP: p.topP ?? 0.9,
        maxTokens: p.maxTokens ?? 2048,
        useCustomGeneration: p.useCustomGeneration ?? false,
        compatibility: "supported",
      });
    }
    // Otherwise: drop the legacy profile (unknown runtime or GGUF path).
  }

  return migrated;
}

export const storageService = {
  getSettings(): AppSettings {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(s: AppSettings): void {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
  },

  getModelProfiles(): ModelProfile[] {
    const raw = localStorage.getItem(STORAGE_KEYS.MODELS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const migrated = migrateProfiles(parsed);
      // If migration changed anything, persist the cleaned list so this only runs once.
      if (JSON.stringify(migrated) !== JSON.stringify(parsed)) {
        localStorage.setItem(STORAGE_KEYS.MODELS, JSON.stringify(migrated));
      }
      return migrated;
    } catch {
      return [];
    }
  },

  saveModelProfile(profile: ModelProfile): void {
    const profiles = this.getModelProfiles();
    const existingIndex = profiles.findIndex(p => p.id === profile.id);
    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }
    localStorage.setItem(STORAGE_KEYS.MODELS, JSON.stringify(profiles));
  },

  deleteModelProfile(id: string): void {
    const profiles = this.getModelProfiles();
    localStorage.setItem(STORAGE_KEYS.MODELS, JSON.stringify(profiles.filter(p => p.id !== id)));
  },

  getConversations(): Conversation[] {
    const raw = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    if (!raw) return [];
    try {
      return JSON.parse(raw).sort((a: Conversation, b: Conversation) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch {
      return [];
    }
  },

  saveConversation(conv: Conversation): void {
    const convs = this.getConversations();
    const existingIndex = convs.findIndex(c => c.id === conv.id);
    if (existingIndex >= 0) {
      convs[existingIndex] = conv;
    } else {
      convs.push(conv);
    }
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(convs));
  },

  deleteConversation(id: string): void {
    const convs = this.getConversations();
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(convs.filter(c => c.id !== id)));
  },

  seedInitialData(): void {
    if (!localStorage.getItem(STORAGE_KEYS.MODELS)) {
      this.saveModelProfile({
        id: "profile_1",
        name: "Llama 3.2 1B",
        runtimeType: "webllm",
        modelIdentifier: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
        contextLength: 4096,
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 2048,
        useCustomGeneration: false,
        compatibility: "supported"
      });
      this.saveModelProfile({
        id: "profile_2",
        name: "Qwen 2.5 1.5B",
        runtimeType: "webllm",
        modelIdentifier: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
        contextLength: 4096,
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 2048,
        useCustomGeneration: false,
        compatibility: "supported"
      });
    }

    if (!localStorage.getItem(STORAGE_KEYS.CONVERSATIONS)) {
      this.saveConversation({
        id: "conv_1",
        title: "Hello LocalModel",
        modelId: "profile_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [
          {
            id: "msg_1",
            role: "user",
            content: "Hello, are you running locally?",
            timestamp: new Date().toISOString()
          },
          {
            id: "msg_2",
            role: "assistant",
            content: "Yes! I am running entirely on your own device. No data is sent to the cloud.",
            timestamp: new Date().toISOString()
          }
        ]
      });
    }
  }
};
