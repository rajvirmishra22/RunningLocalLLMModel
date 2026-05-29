import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Send, Square, Trash2, Plus, MessageSquare, Clock, Zap, Download, Loader2, AlertCircle, Globe, Sliders, Cloud, CloudOff, Paperclip, FileText, FileCode, FileSpreadsheet, X, BookOpen, ImageIcon } from "lucide-react";
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
import { webllmService, InitProgress, getCatalog, isCustomCatalogSupported } from "@/services/webllmService";
import {
  loadCloudConfig,
  streamCloudChat,
  hasKey,
  cloudModelSupportsVision,
  type CloudProvider,
  type CloudProviderConfig,
  type CloudMessage,
  type CloudContentPart,
} from "@/services/cloudProviders";
import { prepareImage, IMAGE_INPUT_ACCEPT, type PreparedImage } from "@/services/imageAttach";
import {
  extractFile,
  buildAttachmentBlock,
  FILE_INPUT_ACCEPT,
  type ExtractedFile,
} from "@/services/fileExtractor";
import {
  shouldIndex,
  indexFile,
  retrieveForQuery,
  buildRagBlock,
  deleteDocument as deleteRagDoc,
  isPersistent as isRagPersistent,
  type RagInitProgress,
} from "@/services/rag/rag";

/**
 * UI-level state we hold per attachment. Small files stay `inline` and get
 * inlined into the prompt as before. Large files start as `indexing` (we
 * chunk + embed in the background), then become `indexed` with a `docId`
 * we can use for retrieval at send time. `error` is shown on the chip.
 */
type AttachmentState =
  | { kind: "inline"; file: ExtractedFile }
  | {
      kind: "rag";
      file: ExtractedFile;
      status: "indexing" | "indexed" | "error";
      docId?: string;
      chunkCount?: number;
      progressText?: string;
      progressPct?: number;
      error?: string;
    };

type Provider = "local" | CloudProvider;

type LoadState =
  | { type: "idle" }
  | { type: "loading"; text: string; progress: number }
  | { type: "ready" }
  | { type: "error"; message: string };

/**
 * True when the bundle is running inside the Tauri desktop shell (vs. a plain
 * browser). Used to swap UI labels like the engine badge ("Native" vs
 * "In-Browser"). Checked once at module load — the runtime never changes
 * mid-session.
 */
const isTauriRuntime =
  typeof window !== "undefined" &&
  (("__TAURI_INTERNALS__" in window) || ("__TAURI__" in window));

/** Conversation sidebar resize bounds + persistence key. */
const SIDEBAR_KEY = "lmstudio:chat-sidebar-width";
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 208; // matches the previous hard-coded `w-52`

function readStoredSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT;
  const raw = window.localStorage.getItem(SIDEBAR_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT;
}

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
  // Attachments staged for the next message. Cleared after send.
  // Each entry is either an inline small file or a RAG-indexed large file.
  const [attachments, setAttachments] = useState<AttachmentState[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  // Image attachments are kept separate from file attachments because they
  // travel through a different pathway: instead of being inlined / chunked
  // into the prompt text, they're sent as native image parts to the vision
  // model. Cleared after every send.
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth());
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  /**
   * Begin a sidebar resize drag. Captures the pointer's start x and the
   * current width, then attaches window-level mousemove/mouseup listeners
   * that update the width until release. Persists the final value.
   */
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    setIsResizingSidebar(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const next = Math.max(
        SIDEBAR_MIN,
        Math.min(SIDEBAR_MAX, startWidth + (ev.clientX - startX)),
      );
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsResizingSidebar(false);
      // Persist final width using the latest committed value.
      setSidebarWidth((curr) => {
        try {
          window.localStorage.setItem(SIDEBAR_KEY, String(curr));
        } catch {
          /* localStorage can throw in private mode; harmless. */
        }
        return curr;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

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

  /**
   * Kick off background RAG indexing for one extracted file. Updates the
   * matching attachment's progress as it goes, and flips it to `indexed`
   * (with `docId`) or `error` when done.
   */
  const indexInBackground = (file: ExtractedFile) => {
    void (async () => {
      const updateThis = (mut: (a: AttachmentState) => AttachmentState) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.kind === "rag" && a.file === file ? mut(a) : a,
          ),
        );
      };
      try {
        const doc = await indexFile(file, (p: RagInitProgress) => {
          updateThis((a) => ({
            ...a,
            progressText: p.text,
            progressPct: p.progress,
          }));
        });
        updateThis((a) => ({
          ...a,
          status: "indexed",
          docId: doc.docId,
          chunkCount: doc.chunkCount,
          progressText: undefined,
          progressPct: undefined,
        }));
      } catch (e) {
        updateThis((a) => ({
          ...a,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
          progressText: undefined,
          progressPct: undefined,
        }));
      }
    })();
  };

  const handleFilesPicked = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachError(null);
    setAttaching(true);
    const picked: AttachmentState[] = [];
    for (const file of Array.from(files)) {
      try {
        const ex = await extractFile(file);
        if (shouldIndex(ex)) {
          picked.push({
            kind: "rag",
            file: ex,
            status: "indexing",
            progressText: "Preparing…",
            progressPct: 0,
          });
        } else {
          picked.push({ kind: "inline", file: ex });
        }
      } catch (e) {
        setAttachError(
          `${file.name}: ${e instanceof Error ? e.message : "could not read file"}`,
        );
      }
    }
    if (picked.length > 0) {
      setAttachments((prev) => [...prev, ...picked]);
      // Fire off indexing for any RAG entries. State update is async; we
      // reference the file objects directly, which match by identity.
      for (const a of picked) {
        if (a.kind === "rag") indexInBackground(a.file);
      }
    }
    setAttaching(false);
    // Reset the input so re-picking the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImagesPicked = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImageError(null);
    setPreparingImage(true);
    const prepared: PreparedImage[] = [];
    for (const file of Array.from(files)) {
      try {
        prepared.push(await prepareImage(file));
      } catch (e) {
        setImageError(e instanceof Error ? e.message : String(e));
      }
    }
    if (prepared.length > 0) setImages((prev) => [...prev, ...prepared]);
    setPreparingImage(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
    setImageError(null);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => {
      const removed = prev[idx];
      // Web's RAG index is in-memory; clean up to free RAM. On desktop the
      // index is persistent — the doc stays in the Knowledge Base until the
      // user explicitly deletes it there.
      if (
        removed &&
        removed.kind === "rag" &&
        removed.status === "indexed" &&
        removed.docId &&
        !isRagPersistent()
      ) {
        void deleteRagDoc(removed.docId).catch(() => {
          /* best-effort */
        });
      }
      return prev.filter((_, i) => i !== idx);
    });
    setAttachError(null);
  };

  /** True while any attachment is still being chunked + embedded. */
  const isAnyIndexing = attachments.some(
    (a) => a.kind === "rag" && a.status === "indexing",
  );

  /**
   * Whether the *currently selected* model can accept image inputs. Drives
   * the visibility of the image picker — we don't want to let the user
   * attach a PNG to gpt-3.5 and then get a confusing error from the API.
   *
   * For cloud: pattern-match on the model id via cloudModelSupportsVision.
   * For local: look the loaded model up in the catalog (built-ins +
   * customs) and honour its `vision` flag.
   */
  const currentModelSupportsVision = (() => {
    if (provider === "local") {
      if (!selectedProfile) return false;
      const entry = getCatalog().find(
        (m) => m.id === selectedProfile.modelIdentifier,
      );
      return !!entry?.vision;
    }
    const cloudModel =
      provider === "openai" ? cloudCfg.openaiModel : cloudCfg.anthropicModel;
    return cloudModelSupportsVision(provider, cloudModel);
  })();

  const sendMessage = async () => {
    if (
      (!input.trim() && attachments.length === 0 && images.length === 0) ||
      isGenerating
    )
      return;
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

    // Small attachments get inlined verbatim; large ones go through RAG so
    // only the most relevant chunks reach the model. Both blocks get prepended
    // to the user's typed text. The user only sees their own text in the
    // bubble (plus per-attachment chips).
    const visibleText = input.trim();
    const inlineFiles = attachments
      .filter((a): a is Extract<AttachmentState, { kind: "inline" }> => a.kind === "inline")
      .map((a) => a.file);
    const ragDocIds = attachments
      .filter(
        (a): a is Extract<AttachmentState, { kind: "rag" }> =>
          a.kind === "rag" && a.status === "indexed" && !!a.docId,
      )
      .map((a) => a.docId!);

    let ragBlock = "";
    // Per-document tally of which retrieved excerpts came from where. Stored
    // on the assistant message so the bubble can show a "Used N excerpts
    // from filename.pdf" badge — making it visible to the user that the
    // model saw retrieved passages, not the whole document.
    let ragMeta: Message["ragMeta"] | undefined;
    if (ragDocIds.length > 0) {
      try {
        // Retrieval query = the user's text (or the document name if no text).
        const queryText = visibleText || "summarise the document";
        const chunks = await retrieveForQuery(ragDocIds, queryText);
        ragBlock = buildRagBlock(chunks);
        if (chunks.length > 0) {
          const byDoc = new Map<string, { name: string; n: number }>();
          for (const c of chunks) {
            const cur = byDoc.get(c.docId);
            if (cur) cur.n += 1;
            else byDoc.set(c.docId, { name: c.docName, n: 1 });
          }
          ragMeta = {
            excerptCount: chunks.length,
            docs: Array.from(byDoc.entries()).map(([docId, v]) => ({
              docId,
              name: v.name,
              usedExcerpts: v.n,
            })),
          };
        }
      } catch (e) {
        // RAG failure shouldn't block the message — log and continue with
        // whatever inline context we have.
        console.error("RAG retrieval failed:", e);
      }
    }
    const attachmentBlock = ragBlock + buildAttachmentBlock(inlineFiles);
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: attachmentBlock + (visibleText || "(see attached files)"),
      timestamp: new Date().toISOString(),
    };

    const updatedConv: Conversation = {
      ...conv,
      title: conv.messages.length === 0 ? input.slice(0, 40) + (input.length > 40 ? "..." : "") : conv.title,
      modelId: convModelId,
      updatedAt: new Date().toISOString(),
      messages: [...conv.messages, userMsg],
    };

    // Snapshot images at send time. We clear `images` state next, but the
    // cloud request still needs the data URLs to build its multimodal parts.
    const imagesForSend = images;

    storageService.saveConversation(updatedConv);
    setActiveConvId(updatedConv.id);
    loadData();
    setInput("");
    setAttachments([]);
    setAttachError(null);
    setImages([]);
    setImageError(null);
    setIsGenerating(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    const messagesForLLM = updatedConv.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    /** Build the cloud-side message list, replacing the last user turn with
     *  a parts array when images are attached. We only attach images to the
     *  current user turn — past turns stay text-only since we don't persist
     *  raw image data in conversation history (would balloon localStorage). */
    const messagesForCloud: CloudMessage[] =
      imagesForSend.length > 0
        ? messagesForLLM.map((m, i) => {
            if (i !== messagesForLLM.length - 1 || m.role !== "user") return m;
            const parts: CloudContentPart[] = [
              { type: "text", text: m.content },
              ...imagesForSend.map(
                (img): CloudContentPart => ({
                  type: "image",
                  dataUrl: img.dataUrl,
                  mimeType: img.mimeType,
                }),
              ),
            ];
            return { role: m.role, content: parts };
          })
        : messagesForLLM;

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
        ragMeta,
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
        controller,
        imagesForSend.map((img) => img.dataUrl)
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
      messagesForCloud,
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
    (input.trim().length > 0 || attachments.length > 0 || images.length > 0) &&
    !isAnyIndexing &&
    !isGenerating &&
    !attaching &&
    !preparingImage &&
    (provider === "local" ? profiles.length > 0 && webllmReady : cloudReady);

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      <aside
        data-testid="chat-sidebar"
        className="flex-shrink-0 border-r border-border flex flex-col bg-sidebar relative"
        style={{ width: sidebarWidth }}
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
                    "w-full flex items-center gap-1.5 px-2.5 py-2 rounded-md cursor-pointer group transition-colors overflow-hidden",
                    activeConvId === conv.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-sidebar-accent text-sidebar-foreground"
                  )}
                >
                  <div className="flex-1 min-w-0 overflow-hidden">
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

        {/* Drag handle — sits on the sidebar's right edge. Mousedown captures
            the start position + current width, then a window-level mousemove
            updates width until mouseup. Width is persisted to localStorage so
            the user's choice survives reloads. */}
        <div
          onMouseDown={startSidebarResize}
          title="Drag to resize"
          className={cn(
            "absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10 transition-colors",
            isResizingSidebar ? "bg-primary/50" : "hover:bg-primary/30"
          )}
          data-testid="sidebar-resize-handle"
        />
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
              {isTauriRuntime ? "Native" : "In-Browser"}
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
            {/* Attachment chips — shown above the textarea so the user can see
                what's about to be sent. */}
            {(attachments.length > 0 || images.length > 0 || attachError || imageError) && (
              <div className="mb-2 space-y-1.5">
                {(attachments.length > 0 || images.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {images.map((img, idx) => (
                      <ImageChip
                        key={`${img.name}-${idx}`}
                        image={img}
                        onRemove={() => removeImage(idx)}
                      />
                    ))}
                    {attachments.map((att, idx) => (
                      <AttachmentChip
                        key={`${att.file.name}-${idx}`}
                        attachment={att}
                        onRemove={() => removeAttachment(idx)}
                      />
                    ))}
                  </div>
                )}
                {attachError && (
                  <div className="flex items-start gap-1.5 text-[11px] text-red-500">
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span className="flex-1">{attachError}</span>
                    <button
                      onClick={() => setAttachError(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {imageError && (
                  <div className="flex items-start gap-1.5 text-[11px] text-red-500">
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span className="flex-1">{imageError}</span>
                    <button
                      onClick={() => setImageError(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={FILE_INPUT_ACCEPT}
              className="hidden"
              onChange={(e) => void handleFilesPicked(e.target.files)}
              data-testid="input-file-attach"
            />
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept={IMAGE_INPUT_ACCEPT}
              className="hidden"
              onChange={(e) => void handleImagesPicked(e.target.files)}
              data-testid="input-image-attach"
            />

            <div className="relative flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating || attaching}
                title="Attach a file (PDF, text, code, CSV, JSON…)"
                data-testid="btn-attach-file"
                className="h-9 w-9 flex items-center justify-center rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {attaching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Paperclip className="w-4 h-4" />
                )}
              </button>
              {currentModelSupportsVision && (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isGenerating || preparingImage}
                  title="Attach an image (the model can see it)"
                  data-testid="btn-attach-image"
                  className="h-9 w-9 flex items-center justify-center rounded-md border border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/15 text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {preparingImage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImageIcon className="w-4 h-4" />
                  )}
                </button>
              )}
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  !chatReady
                    ? provider === "local"
                      ? "Load the model above before chatting..."
                      : `Add an ${provider === "openai" ? "OpenAI" : "Anthropic"} API key in Settings to chat.`
                    : attachments.length > 0
                      ? "Add a question about the attached files… (Enter to send)"
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
                <p className="text-xs font-medium">
                  {isCustomCatalogSupported()
                    ? `${modelName} runs natively on your machine`
                    : `${modelName} runs entirely in your browser`}
                </p>
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
        {message.ragMeta && message.ragMeta.excerptCount > 0 && (
          <div
            data-testid={`rag-badge-${message.id}`}
            className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-primary/30 bg-primary/5 text-[10px] text-primary"
            title={message.ragMeta.docs
              .map((d) => `${d.usedExcerpts} from ${d.name}`)
              .join(" · ")}
          >
            <BookOpen className="w-3 h-3" />
            <span>
              Used {message.ragMeta.excerptCount} excerpt
              {message.ragMeta.excerptCount === 1 ? "" : "s"} from{" "}
              {message.ragMeta.docs.length === 1
                ? message.ragMeta.docs[0].name
                : `${message.ragMeta.docs.length} documents`}
            </span>
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

function ImageChip({
  image,
  onRemove,
}: {
  image: PreparedImage;
  onRemove: () => void;
}) {
  const sizeLabel =
    image.byteSize < 1024
      ? `${image.byteSize} B`
      : image.byteSize < 1024 * 1024
        ? `${(image.byteSize / 1024).toFixed(1)} KB`
        : `${(image.byteSize / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div
      data-testid={`image-chip-${image.name}`}
      title={`${image.name} — ${image.width}×${image.height}, ${sizeLabel}`}
      className="flex items-center gap-1.5 rounded-md border border-purple-500/40 bg-purple-500/10 px-1.5 py-1 text-[11px] max-w-[220px]"
    >
      <img
        src={image.dataUrl}
        alt={image.name}
        className="w-8 h-8 rounded object-cover flex-shrink-0"
      />
      <div className="flex flex-col min-w-0">
        <span className="truncate text-purple-200">{image.name}</span>
        <span className="text-[10px] text-purple-300/70">
          {image.width}×{image.height} · {sizeLabel}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 text-purple-300/70 hover:text-purple-100 flex-shrink-0"
        title="Remove image"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: AttachmentState;
  onRemove: () => void;
}) {
  const file = attachment.file;
  const Icon =
    file.kind === "pdf"
      ? FileText
      : file.kind === "code"
        ? FileCode
        : file.kind === "data"
          ? FileSpreadsheet
          : FileText;
  const sizeLabel =
    file.bytes < 1024
      ? `${file.bytes} B`
      : file.bytes < 1024 * 1024
        ? `${(file.bytes / 1024).toFixed(1)} KB`
        : `${(file.bytes / 1024 / 1024).toFixed(1)} MB`;

  const isRag = attachment.kind === "rag";
  const isIndexing = isRag && attachment.status === "indexing";
  const isIndexed = isRag && attachment.status === "indexed";
  const isError = isRag && attachment.status === "error";

  const title = isError
    ? `Indexing failed: ${attachment.error ?? "unknown error"}`
    : isIndexing
      ? attachment.progressText ?? "Indexing…"
      : isIndexed
        ? `Indexed: ${attachment.chunkCount} chunks searchable`
        : `${file.chars.toLocaleString()} characters${file.pages ? ` · ${file.pages} pages` : ""}`;

  return (
    <div
      data-testid={`attach-chip-${file.name}`}
      className={cn(
        "inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md border bg-muted/50 max-w-[320px]",
        isError ? "border-destructive/40" : "border-border",
      )}
      title={title}
    >
      {isIndexing ? (
        <Loader2 className="w-3 h-3 text-primary animate-spin flex-shrink-0" />
      ) : isError ? (
        <AlertCircle className="w-3 h-3 text-destructive flex-shrink-0" />
      ) : (
        <Icon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      )}
      <span className="text-[11px] font-medium truncate">{file.name}</span>
      <span className="text-[10px] text-muted-foreground flex-shrink-0">{sizeLabel}</span>
      {isIndexing && (
        <span className="text-[9px] px-1 rounded bg-primary/10 text-primary border border-primary/20 flex-shrink-0">
          {attachment.progressPct != null
            ? `indexing ${Math.round(attachment.progressPct * 100)}%`
            : "indexing"}
        </span>
      )}
      {isIndexed && (
        <span className="text-[9px] px-1 rounded bg-green-500/10 text-green-500 border border-green-500/20 flex-shrink-0">
          {attachment.chunkCount} chunks
        </span>
      )}
      {isError && (
        <span className="text-[9px] px-1 rounded bg-destructive/10 text-destructive border border-destructive/20 flex-shrink-0">
          failed
        </span>
      )}
      {!isRag && file.pages != null && (
        <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground border border-border flex-shrink-0">
          {file.pages}p
        </span>
      )}
      <button
        onClick={onRemove}
        className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors flex-shrink-0"
        title="Remove attachment"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
