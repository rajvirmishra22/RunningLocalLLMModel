// Extract text from user-uploaded files so it can be inlined into a chat
// prompt as context. Supports plain text/code files (read directly) and PDFs
// (via pdfjs-dist). Anything bigger than `MAX_CHARS` is truncated — we surface
// the truncation in the UI so users know not every page made it into context.

import * as pdfjs from "pdfjs-dist";
// Vite bundles the worker as a separate URL-addressable asset.
// pdfjs-dist v5 exposes the worker as an ES module.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- ?url is a Vite virtual import, not in the type defs
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl as string;

/** Hard cap on extracted text per file — protects the model's context window. */
// Per-attachment character budget. The desktop runs llama.cpp with a
// 16384-token context window (~50-65k chars of English). We allow a single
// attachment to consume up to ~48k chars (~12k tokens), which is enough for
// a 10-15 page student assignment / paper. Larger uploads are truncated
// with a visible badge so the user knows the rest didn't make it in.
// Remaining tokens cover the system prompt, chat history, your typed
// question, and the model's reply.
/**
 * Soft cap for inline attachments only. Files larger than this are routed
 * through the RAG pipeline (see `RAG_THRESHOLD_CHARS` in `services/rag/rag.ts`),
 * so this constant is effectively just a "what we'd inline whole if asked"
 * marker. Kept for backwards compatibility with older callers.
 */
export const MAX_CHARS = 48_000;

/** Hard cap on raw file size accepted (50 MB). PDFs above this fail fast. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type ExtractedFile = {
  /** Original filename including extension. Shown in the chip. */
  name: string;
  /**
   * Plain-text contents. Full document text — no truncation applied. The
   * caller (Chat) decides whether to inline the whole thing or route through
   * RAG based on `chars`.
   */
  text: string;
  /** Original file size in bytes. */
  bytes: number;
  /** Character count after extraction (post-truncation). */
  chars: number;
  /**
   * Page count for PDFs (undefined for other file kinds). Surfaced in the
   * Knowledge Base UI alongside chunk counts.
   */
  pages?: number;
  /** Coarse classification for the chip icon. */
  kind: "pdf" | "text" | "code" | "data";
};

/**
 * Extensions/mime patterns we'll accept as text-like and just read directly.
 * Anything else (images, archives, office docs) is rejected — we don't want
 * to feed binary garbage into the prompt.
 */
const TEXT_EXTS: Record<string, ExtractedFile["kind"]> = {
  txt: "text",
  md: "text",
  markdown: "text",
  rst: "text",
  log: "text",
  csv: "data",
  tsv: "data",
  json: "data",
  yaml: "data",
  yml: "data",
  xml: "data",
  toml: "data",
  ini: "data",
  env: "data",
  // common source code
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  kt: "code",
  swift: "code",
  c: "code",
  h: "code",
  cpp: "code",
  hpp: "code",
  cs: "code",
  php: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  sql: "code",
  html: "code",
  htm: "code",
  css: "code",
  scss: "code",
  less: "code",
  vue: "code",
  svelte: "code",
  dockerfile: "code",
  makefile: "code",
};

/** File extension list to put in the `accept=` attribute of the file picker. */
export const FILE_INPUT_ACCEPT =
  ".pdf," +
  Object.keys(TEXT_EXTS)
    .map((e) => `.${e}`)
    .join(",");

function classify(name: string): ExtractedFile["kind"] | "pdf" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : lower;
  return TEXT_EXTS[ext] ?? null;
}

async function extractPdf(file: File): Promise<{ text: string; pages: number }> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pageCount = doc.numPages;
  const pages: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // pdfjs returns positioned items; join with spaces and keep page boundaries.
    const text = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(`--- Page ${i} ---\n${text}`);
  }
  await doc.destroy();
  return { text: pages.join("\n\n"), pages: pageCount };
}

/**
 * Extract text from a single uploaded File. Throws a user-friendly Error
 * on rejection so the caller can display it inline next to the attachment.
 */
export async function extractFile(file: File): Promise<ExtractedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${
        MAX_FILE_BYTES / 1024 / 1024
      } MB.`,
    );
  }

  const kind = classify(file.name);
  if (kind == null) {
    throw new Error(
      `Unsupported file type. Supported: PDF, plain text, Markdown, code (.js/.ts/.py/.rs/etc.), CSV, JSON, YAML, XML.`,
    );
  }

  let raw: string;
  let pages: number | undefined;
  if (kind === "pdf") {
    try {
      const r = await extractPdf(file);
      raw = r.text;
      pages = r.pages;
    } catch (e) {
      throw new Error(
        `Couldn't read this PDF. ${
          e instanceof Error ? e.message : "It may be scanned-only or password-protected."
        }`,
      );
    }
  } else {
    raw = await file.text();
  }

  // No truncation: callers route long documents through the RAG pipeline
  // rather than dropping the tail. Inline attachments are bounded by the
  // RAG threshold (~4k chars), well under any model context limit.
  return {
    name: file.name,
    text: raw,
    bytes: file.size,
    chars: raw.length,
    pages,
    kind: kind === "pdf" ? "pdf" : kind,
  };
}

/**
 * Compose the labeled context block prepended to the user's message when
 * one or more files are attached. The model sees this verbatim, so we use
 * a clear, machine-readable structure.
 */
export function buildAttachmentBlock(files: ExtractedFile[]): string {
  if (files.length === 0) return "";
  const parts = files.map(
    (f) =>
      `=== Attached file: ${f.name} (${f.chars.toLocaleString()} chars${
        f.pages ? `, ${f.pages} page${f.pages === 1 ? "" : "s"}` : ""
      }) ===\n${f.text}\n=== End of ${f.name} ===`,
  );
  return parts.join("\n\n") + "\n\n";
}
