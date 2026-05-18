import { useState, useEffect, useRef } from "react";
import { Send, Square, Trash2, Plus, MessageSquare, Clock, Zap, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { storageService, Conversation, Message, ModelProfile } from "@/services/storageService";
import { ollamaService } from "@/services/ollamaService";

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const settings = storageService.getSettings();

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

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
    ollamaService.checkOllamaStatus(settings.ollamaUrl).then(setOllamaReachable);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages, streamingContent]);

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

    const profile = profiles.find((p) => p.id === selectedProfileId);
    if (!profile) return;

    let conv = activeConv;
    if (!conv) {
      conv = {
        id: `conv_${Date.now()}`,
        title: input.slice(0, 40) + (input.length > 40 ? "..." : ""),
        modelId: selectedProfileId,
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
      title: conv.messages.length === 0 ? (input.slice(0, 40) + (input.length > 40 ? "..." : "")) : conv.title,
      modelId: selectedProfileId,
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

    const messagesForOllama = updatedConv.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let fullContent = "";

    await ollamaService.streamChatCompletion(
      settings.ollamaUrl,
      profile.modelIdentifier,
      messagesForOllama,
      (token) => {
        fullContent += token;
        setStreamingContent(fullContent);
      },
      (stats) => {
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
      },
      (err) => {
        const errMsg: Message = {
          id: `msg_${Date.now()}_err`,
          role: "assistant",
          content: `Generation failed: ${err.message}. Check if your model is still loaded.`,
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
      },
      controller
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

  const ollamaProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <div className="flex h-full">
      <aside
        data-testid="chat-sidebar"
        className="w-52 flex-shrink-0 border-r border-border flex flex-col bg-sidebar"
      >
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

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 h-12 border-b border-border flex-shrink-0">
          {profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No models configured.{" "}
              <a href="/models" className="underline text-primary">Add a model</a> to get started.
            </p>
          ) : (
            <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
              <SelectTrigger
                className="h-7 w-48 text-xs border-border"
                data-testid="select-model"
              >
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {ollamaReachable === false && (
            <span className="text-[11px] text-destructive ml-auto">
              Ollama not running —{" "}
              <a href="/" className="underline">check setup</a>
            </span>
          )}

          {activeConv && (
            <button
              className="ml-auto p-1.5 rounded hover:bg-muted transition-colors"
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

        <ScrollArea className="flex-1 px-4">
          <div className="py-4 space-y-4 max-w-2xl mx-auto">
            {!activeConv || activeConv.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="chat-empty-state">
                <MessageSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Start a conversation</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {ollomaProfile(ollamaProfile) ? `Using ${ollamaProfile?.name}` : "Select a model above"}
                </p>
              </div>
            ) : (
              activeConv.messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))
            )}

            {isGenerating && streamingContent && (
              <div data-testid="streaming-message" className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">
                    {ollamaProfile?.name ?? "Assistant"}
                  </p>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
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

        <div className="px-4 py-3 border-t border-border flex-shrink-0">
          <div className="max-w-2xl mx-auto">
            <div className="relative flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                className="flex-1 min-h-[40px] max-h-36 resize-none text-sm py-2.5 pr-2"
                rows={1}
                data-testid="input-chat-message"
                disabled={isGenerating}
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
                  disabled={!input.trim() || profiles.length === 0}
                  data-testid="btn-send-message"
                  className="h-9"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              All messages stay local. No data leaves your device.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ollomaProfile(profile: ModelProfile | undefined) {
  return !!profile;
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div
      data-testid={`message-${message.id}`}
      className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}
    >
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-semibold",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? "U" : "AI"}
      </div>
      <div className={cn("flex-1 min-w-0", isUser ? "flex flex-col items-end" : "")}>
        {!isUser && (
          <p className="text-xs text-muted-foreground mb-1">Assistant</p>
        )}
        <div
          className={cn(
            "rounded-xl px-3.5 py-2.5 max-w-[85%]",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>
        {message.stats && (
          <div
            data-testid={`stats-${message.id}`}
            className="flex items-center gap-3 mt-1.5 px-1"
          >
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
