import { useEffect, useState } from "react";
import { BookOpen, Trash2, FileText, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listDocuments, deleteDocument, isPersistent, type IndexedDoc } from "@/services/rag/rag";

/**
 * Knowledge Base — desktop-only management page for documents the user has
 * indexed via chat attachments. Lists each doc with its chunk count + a
 * delete button. The Layout nav only links here when the runtime's RAG
 * backend is persistent (i.e. desktop). On web, this page still renders if
 * navigated to directly but will just show whatever ephemeral docs are in
 * the current session.
 */
export default function KnowledgeBase() {
  const [docs, setDocs] = useState<IndexedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const persistent = isPersistent();

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listDocuments();
      setDocs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load knowledge base.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleDelete = async (docId: string) => {
    try {
      await deleteDocument(docId);
      setDocs((prev) => prev.filter((d) => d.docId !== docId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document.");
    }
  };

  const formatDate = (created: string): string => {
    // Desktop's Rust store writes unix-seconds as a plain string; web writes ISO.
    const asNum = Number(created);
    const d = Number.isFinite(asNum) && asNum > 0 && created.length < 20
      ? new Date(asNum * 1000)
      : new Date(created);
    if (Number.isNaN(d.getTime())) return created;
    return d.toLocaleString();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <BookOpen className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Knowledge Base</h1>
          <p className="text-xs text-muted-foreground">
            Documents you've attached to chats are indexed locally so you can ask
            questions about them anytime. {persistent ? "Stored on this device." : "(session-only on web)"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          data-testid="btn-kb-refresh"
          className="gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/10 text-sm text-destructive mb-4">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && docs.length === 0 && (
            <div className="text-center py-16 text-muted-foreground" data-testid="kb-empty">
              <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No documents yet</p>
              <p className="text-xs mt-1">
                Attach a long file (PDF, notes, code) in Chat and it'll be indexed here automatically.
              </p>
            </div>
          )}

          {!loading && docs.length > 0 && (
            <div className="space-y-2">
              {docs.map((d) => (
                <div
                  key={d.docId}
                  data-testid={`kb-doc-${d.docId}`}
                  className="flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors"
                >
                  <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.chunkCount} chunk{d.chunkCount === 1 ? "" : "s"} · indexed {formatDate(d.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleDelete(d.docId)}
                    className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                    title="Delete from knowledge base"
                    data-testid={`btn-delete-kb-${d.docId}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
