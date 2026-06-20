/**
 * Desktop-only stub for `@workspace/api-client-react`.
 *
 * The web app imports the generated workspace API client, but the desktop build
 * lives outside the pnpm workspace and cannot resolve `@workspace/*` packages.
 * `Connections.tsx` is shared verbatim between web and desktop, so instead of
 * forking it we alias `@workspace/api-client-react` to this file (see
 * `desktop/vite.config.ts` + `desktop/tsconfig.json`).
 *
 * Unlike the web build (which calls the same-origin `/api` proxy), the Tauri
 * webview has no local API server. The Canvas proxy must be reached over the
 * network, so the deployed api-server origin is supplied at build time via
 * `VITE_API_BASE_URL`. If it isn't set, Canvas calls fail with a clear message
 * rather than silently hitting a dead relative URL. The token is still only
 * ever sent to the proxy, never persisted server-side (same contract as web).
 *
 * This file lives under `desktop/stubs/` (NOT `desktop/src/`) so the web→desktop
 * mirror (`cp -r artifacts/localmodel-studio/src/. desktop/src/`) never clobbers it.
 */

export interface CanvasAuthInput {
  baseUrl: string;
  token: string;
}

export interface CanvasCourseQuery {
  baseUrl: string;
  token: string;
  courseId: string;
}

export interface CanvasAssignmentQuery {
  baseUrl: string;
  token: string;
  courseId: string;
  assignmentId: string;
}

export interface CanvasProfile {
  id: number;
  name: string;
  primaryEmail?: string | null;
}

export interface CanvasCourse {
  id: number;
  name: string;
  courseCode?: string | null;
  term?: string | null;
}

export interface CanvasAssignment {
  id: number;
  courseId: number;
  name: string;
  description?: string | null;
  dueAt?: string | null;
  pointsPossible?: number | null;
  htmlUrl?: string | null;
  submissionTypes?: string[];
  hasRubric?: boolean;
}

export interface CanvasSubmission {
  assignmentId: number;
  score?: number | null;
  grade?: string | null;
  submittedAt?: string | null;
  late?: boolean;
  workflowState?: string | null;
}

export interface CanvasFile {
  id: number;
  displayName: string;
  fileName?: string | null;
  contentType?: string | null;
  url?: string | null;
  sizeBytes?: number | null;
  kind?: string | null;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!API_BASE) {
    throw new Error(
      "Canvas sync isn't configured for the desktop build. Rebuild with VITE_API_BASE_URL " +
        "set to your deployed StudyCore api-server URL (e.g. https://your-app.replit.app).",
    );
  }
  if (!API_BASE.startsWith("https://")) {
    throw new Error(
      "VITE_API_BASE_URL must be an https:// origin — the Canvas token is sent to it and " +
        "must never travel over plaintext http.",
    );
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Canvas request failed (HTTP ${res.status}).`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const canvasTestConnection = (input: CanvasAuthInput): Promise<CanvasProfile> =>
  post<CanvasProfile>("/api/canvas/test", input);

export const canvasListCourses = (input: CanvasAuthInput): Promise<CanvasCourse[]> =>
  post<CanvasCourse[]>("/api/canvas/courses", input);

export const canvasListAssignments = (query: CanvasCourseQuery): Promise<CanvasAssignment[]> =>
  post<CanvasAssignment[]>("/api/canvas/assignments", query);

export const canvasListSubmissions = (query: CanvasCourseQuery): Promise<CanvasSubmission[]> =>
  post<CanvasSubmission[]>("/api/canvas/submissions", query);

export const canvasListAssignmentFiles = (
  query: CanvasAssignmentQuery,
): Promise<CanvasFile[]> => post<CanvasFile[]>("/api/canvas/assignment-files", query);
