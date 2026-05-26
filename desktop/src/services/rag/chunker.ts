// Sentence-aware text chunker used by the RAG pipeline.
//
// We split a long document into overlapping ~CHUNK_SIZE-character windows
// that prefer to break at sentence / paragraph boundaries. Overlap means
// a single sentence on a chunk boundary still has its neighbours nearby
// when embedded, which keeps cosine retrieval from missing it.

export const CHUNK_SIZE = 600;
export const CHUNK_OVERLAP = 100;

/**
 * Split `text` into chunks of roughly `size` characters with `overlap` chars
 * of carry-over at each boundary. Sentence- and paragraph-aware: we never
 * cut mid-sentence unless a single sentence is longer than `size`, in which
 * case we hard-split it.
 */
export function chunkText(
  text: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= size) return [trimmed];

  // Split on sentence terminators and blank lines. The lookbehind keeps the
  // terminator attached to the previous sentence.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
  };

  for (const sent of sentences) {
    // Sentence longer than the chunk window — hard-split it.
    if (sent.length > size) {
      flush();
      current = "";
      for (let i = 0; i < sent.length; i += size - overlap) {
        chunks.push(sent.slice(i, i + size).trim());
      }
      continue;
    }

    if (current.length + sent.length + 1 <= size) {
      current = current ? current + " " + sent : sent;
    } else {
      flush();
      // Start the next chunk with the tail of the previous one for context.
      const tail = current.length > overlap ? current.slice(-overlap) : current;
      current = tail ? tail + " " + sent : sent;
    }
  }
  flush();
  return chunks;
}

/** Cosine similarity over two L2-normalized vectors (just a dot product). */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}
