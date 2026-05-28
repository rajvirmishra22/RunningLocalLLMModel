/**
 * Image attachment helpers for chat.
 *
 * Browser-only: we read a File, decode it via an HTMLImageElement, and
 * re-encode it through an OffscreenCanvas (falling back to a regular Canvas)
 * at a bounded max dimension. This serves two purposes:
 *   1. Strips EXIF + any embedded payloads — the re-encoded JPEG is just
 *      pixels.
 *   2. Caps request size before it reaches the provider. A 12MP phone photo
 *      is ~3–6 MB; after a 2048px bound + JPEG q0.85 we're typically under
 *      400 KB, well inside OpenAI/Anthropic per-request limits.
 *
 * Output is always a `data:image/jpeg;base64,…` URL. We pick JPEG over PNG
 * because the providers happily accept it and it's an order of magnitude
 * smaller for photographic content. Transparency is lost — fine for camera
 * shots and screenshots-without-alpha; the alternative is a 4× payload.
 */

export interface PreparedImage {
  /** `data:image/jpeg;base64,…` */
  dataUrl: string;
  /** Always `"image/jpeg"` today. Kept on the type so Anthropic's
   *  `source.media_type` stays declarative and we can change formats later. */
  mimeType: "image/jpeg";
  /** Approx encoded byte size, for the UI chip. */
  byteSize: number;
  width: number;
  height: number;
  /** The original filename, for display. */
  name: string;
}

/** Hard upper bound on either side of the image. 2048 matches what OpenAI
 *  internally rescales to for its "high" detail vision mode, so we're not
 *  shipping pixels the model will throw away. */
const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

/** File types we'll accept from the picker. Everything else gets rejected
 *  with a clear error. PNG/JPEG/WEBP are the universally-supported set
 *  across OpenAI + Anthropic. GIF is animation-flattened by the browser
 *  when decoded into a canvas, which is the behaviour we want. */
export const IMAGE_INPUT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

const ACCEPTED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_MIMES.has(file.type)) {
    throw new Error(
      `${file.name}: unsupported image type (${file.type || "unknown"}). Use PNG, JPEG, WEBP, or GIF.`,
    );
  }

  const bitmap = await decodeToBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    const dataUrl = await encodeJpeg(bitmap, width, height, JPEG_QUALITY);
    // base64 is ~4/3 of binary, minus the data-URL prefix.
    const commaIdx = dataUrl.indexOf(",");
    const b64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
    const byteSize = Math.round((b64Len * 3) / 4);
    return {
      dataUrl,
      mimeType: "image/jpeg",
      byteSize,
      width,
      height,
      name: file.name,
    };
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") {
      (bitmap as ImageBitmap).close();
    }
  }
}

async function decodeToBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // Prefer createImageBitmap — it handles EXIF orientation natively in
  // modern browsers and is much faster than the <img> path.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to <img> for browsers that lack the option (older
      // Safari) or for image types they can't bitmap-decode directly.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`${file.name}: failed to decode image.`));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h };
  const scale = Math.min(maxEdge / w, maxEdge / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

async function encodeJpeg(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): Promise<string> {
  // OffscreenCanvas first — keeps the work off the layout thread when
  // available. We still need a dataURL at the end, so we go through a Blob.
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      return await blobToDataUrl(blob);
    } catch {
      // Fall through to the regular canvas path.
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser refused to provide a 2D canvas context.");
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
