import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Send, Square, Trash2, Plus, MessageSquare, Clock, Zap, Download, Loader2, AlertCircle, Globe, Sliders, Cloud, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { storageService, Conversation, Message, ModelProfile, DEFAULT_GENERATION } from "@/services/storageService";
import { webllmService, InitProgress } from "@/services/webllmService";
import {
  loadCloudConfig,
  streamCloudChat,
  hasKey,
  type CloudProvider,
  type CloudProviderConfig,
} from "@/services/cloudProviders";

type Provider = "local" | CloudProvider;

type LoadState =
  | { type: "idle" }
  | { type: "loading"; text: string; progress: number }
  | { type: "ready" }
  | { type: "error"; message: string };

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [webllmLoad, setWebllmLoad] = useState<LoadState>({ type: "idle" });
  const [provider, setProvider] = useState<Provider>("local");
  const [cloudCfg, setCloudCfg] = useState<CloudProviderConfig>(() => loadCloudConfig());
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const webllmReady = !!selectedProfile && webllmService.getLoadedModelId() === selectedProfile.modelIdentifier;

  // Reload cloud config on focus so newly-saved keys from Settings show up
  // here without a page reload.
  useEffect(() => {
    const refresh = () => setCloudCfg(loadCloudConfig());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const cloudReady = provider !== "local" && hasKey(cloudCfg, provider);
  const chatReady = provider === "local" ? webllmReady : cloudReady;
  const activeCloudModel =
    provider === "openai" ? cloudCfg.openaiModel : provider === "anthropic" ? cloudCfg.anthropicModel : "";
  const providerLabel =
    provider === "local"
      ? selectedProfile?.name ?? "Local"
      : provider === "openai"
        ? `OpenAI · ${cloudCfg.openaiModel}`
        : `Anthropic · ${cloudCfg.anthropicModel}`;

  const loadData = () => {
    const convs = storageService.getConversations();
    setConversations(convs);
    const profs = storageService.getModelProfiles();
    setProfiles(profs);
    if (profs.length > 0 && !selectedProfileId) {
      setSelectedProfileId(profs[0].id);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedProfile) {
      setWebllmLoad({ type: "idle" });
      return;
    }
    const alreadyLoaded = webllmService.getLoadedModelId() === selectedProfile.modelIdentifier;
    setWebllmLoad(alreadyLoaded ? { type: "ready" } : { type: "idle" });
  }, [selectedProfileId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages, streamingContent]);

  const handleLoadWebLLM = async () => {
    if (!selectedProfile) return;
    if (!webllmService.checkWebGPU()) {
      setWebllmLoad({ type: "error", message: "WebGPU is not available in your browser. Use Chrome 113+ or Edge 113+." });
      return;
    }
    setWebllmLoad({ type: "loading", text: "Initializing...", progress: 0 });
    try {
      await webllmService.loadModel(selectedProfile.modelIdentifier, (p: InitProgress) => {
        setWebllmLoad({ type: "loading", text: p.text, progress: p.progress });
      });
      setWebllmLoad({ type: "ready" });
    } catch (err: unknown) {
      setWebllmLoad({ type: "error", message: err instanceof Error ? err.message : "Failed to load model." });
    }
  };

  const newConversation = () => {
    const conv: Conversation = {
      id: `conv_${Date.now()}`,
      title: "New Chat",
      modelId: selectedProfileId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    storageService.saveConversation(conv);
    loadData();
    setActiveConvId(conv.id);
  };

  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    storageService.deleteConversation(id);
    if (activeConvId === id) setActiveConvId(null);
    loadData();
  };

  const sendMessage = async () => {
    if (!input.trim() || isGenerating) return;
    if (provider === "local" && (!selectedProfile || !webllmReady)) return;
    if (provider !== "local" && !cloudReady) return;

    // The conversation's `modelId` is metadata only — for local runs it's the
    // selected profile id, for cloud runs we synthesize one like "openai:gpt-4o"
    // so conversation provenance stays accurate.
    const convModelId =
      provider === "local"
        ? selectedProfileId
        : `${provider}:${provider === "openai" ? cloudCfg.openaiModel : cloudCfg.anthropicModel}`;

    let conv = activeConv;
    if (!conv) {
      conv = {
        id: `conv_${Date.now()}`,
        title: input.slice(0, 40) + (input.length > 40 ? "..." : ""),
        modelId: convModelId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
    }

    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };

    const updatedConv: Conversation = {
      ...conv,
      title: conv.messages.length === 0 ? input.slice(0, 40) + (input.length > 40 ? "..." : "") : conv.title,
      modelId: convModelId,
      updatedAt: new Date().toISOString(),
      messages: [...conv.messages, userMsg],
    };

    storageService.saveConversation(updatedConv);
    setActiveConvId(updatedConv.id);
    loadData();
    setInput("");
    setIsGenerating(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    const messagesForLLM = updatedConv.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    let fullContent = "";

    const onToken = (token: string) => {
      fullContent += token;
      setStreamingContent(fullContent);
    };

    const onDone = (stats: { tokensPerSec: number; totalTimeMs: number; modelUsed: string; runtimeUsed: string }) => {
      // Avoid persisting empty assistant turns — they pollute history and
      // confuse the next round-trip to the provider.
      if (!fullContent.trim()) {
        setStreamingContent("");
        setIsGenerating(false);
        return;
      }
      const assistantMsg: Message = {
        id: `msg_${Date.now()}_a`,
        role: "assistant",
        content: fullContent,
        timestamp: new Date().toISOString(),
        stats,
      };
      const finalConv: Conversation = {
        ...updatedConv,
        updatedAt: new Date().toISOString(),
        messages: [...updatedConv.messages, assistantMsg],
      };
      storageService.saveConversation(finalConv);
      loadData();
      setStreamingContent("");
      setIsGenerating(false);
    };

    const onError = (err: Error) => {
      const errMsg: Message = {
        id: `msg_${Date.now()}_err`,
        role: "assistant",
        content: `Generation stopped: ${err.message}`,
        timestamp: new Date().toISOString(),
      };
      const errConv: Conversation = {
        ...updatedConv,
        updatedAt: new Date().toISOString(),
        messages: [...updatedConv.messages, errMsg],
      };
      storageService.saveConversation(errConv);
      loadData();
      setStreamingContent("");
      setIsGenerating(false);
    };

    if (provider === "local" && selectedProfile) {
      // Honour the profile's `useCustomGeneration` toggle: when off, we ignore
      // the per-profile knobs and use the shared defaults. This lets casual
      // users chat without ever touching temperature/top-p/max-tokens.
      const effectiveGen = selectedProfile.useCustomGeneration
        ? { temperature: selectedProfile.temperature, maxTokens: selectedProfile.maxTokens, topP: selectedProfile.topP }
        : { temperature: DEFAULT_GENERATION.temperature, maxTokens: DEFAULT_GENERATION.maxTokens, topP: DEFAULT_GENERATION.topP };

      await webllmService.streamChat(
        selectedProfile.modelIdentifier,
        messagesForLLM,
        effectiveGen,
        onToken,
        (stats) => onDone(stats),
        onError,
        controller
      );
      return;
    }

    // Cloud path. We track wall-clock time and approximate tok/s by character
    // count / 4 (rough English ratio) since the provider doesn't tell us the
    // exact token count mid-stream.
    const startedAt = performance.now();
    const cloudProvider: CloudProvider = provider === "openai" ? "openai" : "anthropic";
    const cloudModel = cloudProvider === "openai" ? cloudCfg.openaiModel : cloudCfg.anthropicModel;
    const cloudKey = cloudProvider === "openai" ? cloudCfg.openaiKey : cloudCfg.anthropicKey;
    const finishCloud = (aborted: boolean) => {
      const totalTimeMs = performance.now() - startedAt;
      const approxTokens = Math.max(1, Math.round(fullContent.length / 4));
      // Treat abort with no content as a no-op; abort with content as a
      // truncated reply so the user keeps what already streamed.
      if (aborted && !fullContent.trim()) {
        setStreamingContent("");
        setIsGenerating(false);
        return;
      }
      onDone({
        tokensPerSec: approxTokens / (totalTimeMs / 1000),
        totalTimeMs,
        modelUsed: aborted ? `${cloudModel} (stopped)` : cloudModel,
        runtimeUsed: cloudProvider === "openai" ? "OpenAI" : "Anthropic",
      });
    };

    await streamCloudChat(
      cloudProvider,
      cloudModel,
      messagesForLLM,
      cloudKey,
      {
        onToken,
        onDone: () => finishCloud(false),
        onAbort: () => finishCloud(true),
        onError,
      },
      controller.signal,
    );
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
    setStreamingContent("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const canSend =
    input.trim().length > 0 &&
    !isGenerating &&
    (provider === "local" ? profiles.length > 0 && webllmReady : cloudReady);

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      <aside data-testid="chat-sidebar" className="w-52 flex-shrink-0 border-r border-border flex flex-col bg-sidebar">
        <div className="p-2 border-b border-sidebar-border">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2 h-8 text-xs"
            onClick={newConversation}
            data-testid="btn-new-chat"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1.5 space-y-0.5">
            {conversations.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <MessageSquare className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No conversations yet</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  data-testid={`conv-item-${conv.id}`}
                  onClick={() => setActiveConvId(conv.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-2 rounded-md cursor-pointer group transition-colors",
                    activeConvId === conv.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-sidebar-accent text-sidebar-foreground"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{conv.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(conv.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-destructive transition-all flex-shrink-0"
                    data-testid={`btn-delete-conv-${conv.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 h-12 border-b border-border flex-shrink-0">
          <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
            <SelectTrigger className="h-7 w-36 text-xs border-border" data-testid="select-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local" className="text-xs">
                <span className="flex items-center gap-2">
                  <Globe className="w-3 h-3 text-green-500" />
                  Local
                </span>
              </SelectItem>
              <SelectItem value="openai" className="text-xs" disabled={!hasKey(cloudCfg, "openai")}>
                <span className="flex items-center gap-2">
                  <Cloud className="w-3 h-3 text-blue-400" />
                  OpenAI {!hasKey(cloudCfg, "openai") && "(add key)"}
                </span>
              </SelectItem>
              <SelectItem value="anthropic" className="text-xs" disabled={!hasKey(cloudCfg, "anthropic")}>
                <span className="flex items-center gap-2">
                  <Cloud className="w-3 h-3 text-orange-400" />
                  Anthropic {!hasKey(cloudCfg, "anthropic") && "(add key)"}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>

          {provider === "local" ? (
            profiles.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No models configured.{" "}
                <Link href="/models" className="underline text-primary">Add a model</Link> to get started.
              </p>
            ) : (
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger className="h-7 w-52 text-xs border-border" data-testid="select-model">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      <span className="flex items-center gap-2">
                        <Globe className="w-3 h-3 text-green-500" />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            <span className="text-xs font-mono text-muted-foreground" data-testid="active-cloud-model">
              {activeCloudModel}
            </span>
          )}

          {provider === "local" && selectedProfile && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 font-medium">
              In-Browser
            </span>
          )}
          {provider === "openai" && (
            <span
              data-testid="badge-cloud-openai"
              className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium flex items-center gap-1"
            >
              <Cloud className="w-2.5 h-2.5" />
              Sending to OpenAI
            </span>
          )}
          {provider === "anthropic" && (
            <span
              data-testid="badge-cloud-anthropic"
              className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 font-medium flex items-center gap-1"
            >
              <Cloud className="w-2.5 h-2.5" />
              Sending to Anthropic
            </span>
          )}
          {provider !== "local" && !cloudReady && (
            <Link href="/settings" className="text-[10px] underline text-muted-foreground hover:text-foreground">
              Add API key →
            </Link>
          )}

          <Link href="/tuning" className="ml-auto">
            <button
              data-testid="btn-tune-chat"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted px-2 py-1 rounded transition-colors"
              title="Open Model Tuning to pick a model and tweak generation settings"
            >
              <Sliders className="w-3 h-3" />
              Tune
            </button>
          </Link>

          {activeConv && (
            <button
              className="p-1.5 rounded hover:bg-muted transition-colors"
              onClick={() => {
                storageService.deleteConversation(activeConv.id);
                setActiveConvId(null);
                loadData();
              }}
              title="Clear conversation"
              data-testid="btn-clear-current-conv"
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* WebLLM load banner — only when local provider is active. */}
        {provider === "local" && selectedProfile && webllmLoad.type !== "ready" && (
          <WebLLMLoadBanner
            state={webllmLoad}
            modelName={selectedProfile.name}
            onLoad={handleLoadWebLLM}
          />
        )}

        {/* Messages */}
        <ScrollArea className="flex-1 px-4">
          <div className="py-4 space-y-4 max-w-2xl mx-auto">
            {!activeConv || activeConv.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="chat-empty-state">
                <MessageSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Start a conversation</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {provider === "local"
                    ? selectedProfile
                      ? `Using ${selectedProfile.name}`
                      : "Select a model above"
                    : `Using ${providerLabel}`}
                </p>
              </div>
            ) : (
              activeConv.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  // Use the provider/model captured at write time when we
                  // have it, so historical turns never get relabeled by a
                  // later provider switch.
                  modelName={
                    msg.role === "assistant" && msg.stats
                      ? `${msg.stats.runtimeUsed} · ${msg.stats.modelUsed}`
                      : providerLabel
                  }
                />
              ))
            )}

            {isGenerating && streamingContent && (
              <div data-testid="streaming-message" className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">{providerLabel}</p>
                  <div className="rounded-xl px-3.5 py-2.5 bg-muted max-w-[85%]">
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {streamingContent}
                      <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="px-4 py-3 border-t border-border flex-shrink-0">
          <div className="max-w-2xl mx-auto">
            <div className="relative flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  !chatReady
                    ? provider === "local"
                      ? "Load the model above before chatting..."
                      : `Add an ${provider === "openai" ? "OpenAI" : "Anthropic"} API key in Settings to chat.`
                    : "Type a message… (Enter to send, Shift+Enter for newline)"
                }
                className="flex-1 min-h-[40px] max-h-36 resize-none text-sm py-2.5 pr-2"
                rows={1}
                data-testid="input-chat-message"
                disabled={isGenerating || !chatReady}
              />
              {isGenerating ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={stopGeneration}
                  data-testid="btn-stop-generation"
                  className="h-9 gap-1.5"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={sendMessage}
                  disabled={!canSend}
                  data-testid="btn-send-message"
                  className="h-9"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center flex items-center justify-center gap-1.5">
              {provider === "local" ? (
                <>
                  <CloudOff className="w-2.5 h-2.5" />
                  All messages stay local. No data leaves your device.
                </>
              ) : (
                <>
                  <Cloud className="w-2.5 h-2.5" />
                  Messages are sent to {provider === "openai" ? "OpenAI" : "Anthropic"}. Billed to your account.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function WebLLMLoadBanner({
  state,
  modelName,
  onLoad,
}: {
  state: LoadState;
  modelName: string;
  onLoad: () => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
      <div className="max-w-2xl mx-auto">
        {state.type === "idle" && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Globe className="w-4 h-4 text-green-500 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium">{modelName} runs entirely in your browser</p>
                <p className="text-[11px] text-muted-foreground">
                  Downloads once (~0.7–5 GB) via internet, then runs fully offline.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={onLoad} data-testid="btn-load-webllm" className="gap-1.5 flex-shrink-0">
              <Download className="w-3.5 h-3.5" />
              Load Model
            </Button>
          </div>
        )}

        {state.type === "loading" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" />
                <span className="text-xs font-medium">Loading {modelName}…</span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(state.progress * 100)}%
              </span>
            </div>
            <Progress value={state.progress * 100} className="h-1.5" data-testid="webllm-progress" />
            <p className="text-[11px] text-muted-foreground truncate">{state.text}</p>
          </div>
        )}

        {state.type === "error" && (
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-destructive">Failed to load model</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{state.message}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onLoad} className="flex-shrink-0">
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message, modelName }: { message: Message; modelName?: string }) {
  const isUser = message.role === "user";
  return (
    <div data-testid={`message-${message.id}`} className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-semibold",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? "U" : "AI"}
      </div>
      <div className={cn("flex-1 min-w-0", isUser ? "flex flex-col items-end" : "")}>
        {!isUser && <p className="text-xs text-muted-foreground mb-1">{modelName ?? "Assistant"}</p>}
        <div
          className={cn(
            "rounded-xl px-3.5 py-2.5 max-w-[85%]",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
        >
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>
        {message.stats && (
          <div data-testid={`stats-${message.id}`} className="flex items-center gap-3 mt-1.5 px-1">
            <StatBit icon={<Zap className="w-3 h-3" />} value={`${message.stats.tokensPerSec.toFixed(1)} tok/s`} />
            <StatBit icon={<Clock className="w-3 h-3" />} value={`${(message.stats.totalTimeMs / 1000).toFixed(1)}s`} />
            <StatBit value={message.stats.runtimeUsed} />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-1 px-1">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function StatBit({ icon, value }: { icon?: React.ReactNode; value: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {icon}
      {value}
    </span>
  );
}
