import { useRef, useState } from "react";
import {
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PrivacyBadge } from "@/components/studycore/PrivacyBadge";
import { extractFile, FILE_INPUT_ACCEPT } from "@/services/fileExtractor";
import { formatBytes } from "@/services/studycore/privacy";
import { materialStore, newId, nowIso } from "@/services/studycore/store";
import type { Assignment, AssignmentMaterial } from "@/services/studycore/types";

interface MaterialsPanelProps {
  assignment: Assignment;
  onChange: () => void;
}

export function MaterialsPanel({ assignment, onChange }: MaterialsPanelProps) {
  const { toast } = useToast();
  const materials = materialStore.list().filter((m) => m.assignmentId === assignment.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const extracted = await extractFile(file);
        const material: AssignmentMaterial = {
          id: newId("mat"),
          assignmentId: assignment.id,
          courseId: assignment.courseId,
          source: "student_upload",
          fileName: file.name,
          fileType: file.type || "application/octet-stream",
          extractedTextAvailable: !!extracted.text?.trim(),
          indexedInCourseLibrary: false,
          includedInCurrentAIContext: true,
          createdAt: nowIso(),
          extractedText: extracted.text,
          sizeBytes: file.size,
        };
        materialStore.save(material);
      }
      toast({ title: "Material added" });
      onChange();
    } catch (err) {
      toast({
        title: "Couldn't read that file",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function savePaste() {
    if (!pasteText.trim()) {
      toast({ title: "Nothing to save", variant: "destructive" });
      return;
    }
    const material: AssignmentMaterial = {
      id: newId("mat"),
      assignmentId: assignment.id,
      courseId: assignment.courseId,
      source: "student_upload",
      fileName: pasteName.trim() || "Pasted notes",
      fileType: "text/plain",
      extractedTextAvailable: true,
      indexedInCourseLibrary: false,
      includedInCurrentAIContext: true,
      createdAt: nowIso(),
      extractedText: pasteText,
      sizeBytes: new Blob([pasteText]).size,
    };
    materialStore.save(material);
    setPasteOpen(false);
    setPasteName("");
    setPasteText("");
    toast({ title: "Notes saved" });
    onChange();
  }

  function remove(id: string) {
    materialStore.remove(id);
    onChange();
  }

  function toggleContext(m: AssignmentMaterial) {
    materialStore.save({ ...m, includedInCurrentAIContext: !m.includedInCurrentAIContext });
    onChange();
  }

  return (
    <Card className="p-5 space-y-4" data-testid="materials-panel">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Paperclip className="w-4 h-4" /> Materials
        </h2>
        <PrivacyBadge kind="stored_on_device" size="sm" />
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        data-testid="input-material-file"
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          data-testid="button-upload-material"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-1.5" />
          )}
          Upload file
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPasteOpen(true)} data-testid="button-paste-material">
          <Type className="w-4 h-4 mr-1.5" /> Paste text
        </Button>
      </div>

      {materials.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No materials yet. Upload files or paste notes to give AI Help more context.
        </p>
      ) : (
        <div className="space-y-2">
          {materials.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 p-2.5 rounded-md border border-border"
              data-testid={`material-${m.id}`}
            >
              {m.source === "ai_generated" ? (
                <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{m.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {m.source === "ai_generated" ? "AI generated" : "Uploaded"}
                  {m.sizeBytes ? ` · ${formatBytes(m.sizeBytes)}` : ""}
                  {!m.extractedTextAvailable && " · no text"}
                </div>
              </div>
              <button
                onClick={() => toggleContext(m)}
                disabled={!m.extractedTextAvailable}
                className="flex-shrink-0 disabled:opacity-40"
                data-testid={`toggle-context-${m.id}`}
                title="Include in AI context"
              >
                <PrivacyBadge
                  kind={m.includedInCurrentAIContext ? "included_in_ai_context" : "not_included"}
                  size="sm"
                />
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                onClick={() => remove(m.id)}
                data-testid={`delete-material-${m.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Paste material text</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="paste-name">Name</Label>
              <Input
                id="paste-name"
                data-testid="input-paste-name"
                placeholder="Lecture notes, rubric, etc."
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paste-text">Text</Label>
              <Textarea
                id="paste-text"
                data-testid="input-paste-text"
                rows={8}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePaste} data-testid="button-save-paste">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
