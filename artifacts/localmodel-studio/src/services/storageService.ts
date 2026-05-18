export interface ModelProfile {
  id: string;
  name: string;
  runtimeType: "ollama" | "llamacpp" | "transformers";
  modelIdentifier: string;
  contextLength: number;
  temperature: number;
  topP: number;
  maxTokens: number;
  gpuLayers?: number;
  compatibility: "supported" | "experimental" | "unsupported";
}

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
  content: string;
  timestamp: string;
  stats?: { tokensPerSec: number; totalTimeMs: number; modelUsed: string; runtimeUsed: string; };
}

export interface AppSettings {
  ollamaUrl: string;
  llamaServerUrl: string;
  modelDiscoveryEnabled: boolean;
}

const STORAGE_KEYS = {
  MODELS: "lms_model_profiles",
  CONVERSATIONS: "lms_conversations",
  SETTINGS: "lms_settings",
};

const DEFAULT_SETTINGS: AppSettings = {
  ollamaUrl: "http://localhost:11434",
  llamaServerUrl: "http://localhost:8080",
  modelDiscoveryEnabled: false,
};

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
      return JSON.parse(raw);
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
        runtimeType: "ollama",
        modelIdentifier: "llama3.2:1b",
        contextLength: 4096,
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 2048,
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
            content: "Yes! I am running entirely on your local machine. No data is sent to the cloud.",
            timestamp: new Date().toISOString()
          }
        ]
      });
    }
  }
};
