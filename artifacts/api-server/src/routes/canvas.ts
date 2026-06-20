import { lookup as dnsLookup } from "node:dns/promises";
import { Router, type IRouter } from "express";
import {
  CanvasListAssignmentFilesBody,
  CanvasListAssignmentFilesResponse,
  CanvasListAssignmentsBody,
  CanvasListAssignmentsResponse,
  CanvasListCoursesBody,
  CanvasListCoursesResponse,
  CanvasListSubmissionsBody,
  CanvasListSubmissionsResponse,
  CanvasTestConnectionBody,
  CanvasTestConnectionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Stateless Canvas LMS proxy. The student's personal access token is sent in
 * each request body, used once to call Canvas, and never persisted on the
 * server. The browser cannot call Canvas directly (CORS), so this proxy is the
 * minimum surface required. Nothing is logged that contains the token.
 */

/**
 * Reject IP-literal hosts that point at loopback, private, link-local, or
 * carrier-grade-NAT ranges. This is the core SSRF guard: even though the token
 * is user-supplied, the server must never be coaxed into fetching internal
 * services (e.g. cloud metadata at 169.254.169.254).
 */
function isBlockedIpHost(host: string): boolean {
  const v6 = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) {
    return true;
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * Validate and normalize the user-supplied Canvas base URL. Requires HTTPS (so
 * the bearer token is never sent in plaintext) and blocks internal/private
 * hosts to keep this proxy from being abused as an SSRF vector.
 */
async function validateCanvasBase(
  raw: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  let input = (raw ?? "").trim().replace(/\/+$/, "");
  if (!input) return { ok: false, message: "Canvas URL is required." };
  if (/^http:\/\//i.test(input)) {
    return { ok: false, message: "Canvas URL must use https:// so your token is never sent in the clear." };
  }
  if (!/^https:\/\//i.test(input)) input = `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, message: "That doesn't look like a valid Canvas URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Canvas URL must use https://." };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    isBlockedIpHost(host)
  ) {
    return { ok: false, message: "That host isn't allowed. Use your school's Canvas domain." };
  }
  // Defense-in-depth against DNS-based SSRF: resolve the host and reject if any
  // address lands in a loopback/private/link-local/ULA range. A public-looking
  // domain can still point at internal infrastructure.
  if (!isIpLiteral(host)) {
    let addrs: { address: string }[];
    try {
      addrs = await dnsLookup(host, { all: true });
    } catch {
      return { ok: false, message: "Couldn't resolve that Canvas host. Check the URL." };
    }
    if (addrs.length === 0 || addrs.some((a) => isBlockedIpHost(a.address.toLowerCase()))) {
      return { ok: false, message: "That host isn't allowed. Use your school's Canvas domain." };
    }
  }
  return { ok: true, url: `${parsed.protocol}//${parsed.host}` };
}

/** True if the host is already an IPv4/IPv6 literal (no DNS resolution needed). */
function isIpLiteral(host: string): boolean {
  const v6 = host.replace(/^\[/, "").replace(/\]$/, "");
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host) || v6.includes(":");
}

async function canvasFetch(base: string, token: string, path: string): Promise<Response> {
  const url = `${base}/api/v1${path}`;
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
}

/** Follow Canvas pagination via Link headers, capped to avoid runaway loops. */
async function canvasFetchAll<T>(
  base: string,
  token: string,
  path: string,
  maxPages = 10,
): Promise<{ ok: true; data: T[] } | { ok: false; status: number; message: string }> {
  const results: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  let next: string | null = `${base}/api/v1${path}${sep}per_page=100`;
  let pages = 0;
  while (next && pages < maxPages) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: await safeText(res) };
    }
    const page = (await res.json()) as T[];
    if (Array.isArray(page)) results.push(...page);
    // SSRF guard: Canvas controls the `Link: rel="next"` URL, so re-validate it
    // before following. Only same-origin HTTPS pagination is allowed — never let
    // a crafted Link header redirect the authenticated fetch elsewhere.
    next = sameOriginNext(parseNextLink(res.headers.get("link")), base);
    pages++;
  }
  return { ok: true, data: results };
}

/**
 * Accept a pagination `next` URL only if it stays on the validated HTTPS origin.
 * Returns null (stop paginating) for anything off-origin, non-HTTPS, or malformed.
 */
function sameOriginNext(next: string | null, base: string): string | null {
  if (!next) return null;
  try {
    const u = new URL(next);
    if (u.protocol !== "https:") return null;
    return u.origin === base ? u.toString() : null;
  } catch {
    return null;
  }
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 300);
  } catch {
    return res.statusText;
  }
}

function mapCanvasError(status: number): { code: number; message: string } {
  if (status === 401 || status === 403) {
    return { code: 401, message: "Canvas rejected the token. Check the token and its permissions." };
  }
  if (status === 404) {
    return { code: 404, message: "Canvas resource not found. Check the base URL and IDs." };
  }
  return { code: 502, message: `Canvas returned an error (HTTP ${status}).` };
}

router.post("/canvas/test", async (req, res) => {
  const parsed = CanvasTestConnectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_INPUT", message: "baseUrl and token are required." });
    return;
  }
  const { baseUrl, token } = parsed.data;
  const base = await validateCanvasBase(baseUrl);
  if (!base.ok) {
    res.status(400).json({ error: "INVALID_BASE_URL", message: base.message });
    return;
  }
  try {
    const r = await canvasFetch(base.url, token, "/users/self/profile");
    if (!r.ok) {
      const e = mapCanvasError(r.status);
      res.status(e.code).json({ error: "CANVAS_ERROR", message: e.message });
      return;
    }
    const profile = (await r.json()) as {
      id: number;
      name: string;
      primary_email?: string | null;
    };
    res.json(
      CanvasTestConnectionResponse.parse({
        id: profile.id,
        name: profile.name,
        primaryEmail: profile.primary_email ?? null,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Canvas test connection failed");
    res.status(502).json({ error: "CANVAS_UNREACHABLE", message: "Could not reach Canvas." });
  }
});

router.post("/canvas/courses", async (req, res) => {
  const parsed = CanvasListCoursesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_INPUT", message: "baseUrl and token are required." });
    return;
  }
  const { baseUrl, token } = parsed.data;
  const base = await validateCanvasBase(baseUrl);
  if (!base.ok) {
    res.status(400).json({ error: "INVALID_BASE_URL", message: base.message });
    return;
  }
  try {
    const r = await canvasFetchAll<{
      id: number;
      name: string;
      course_code?: string | null;
      term?: { name?: string } | null;
    }>(base.url, token, "/courses?enrollment_state=active&include[]=term");
    if (!r.ok) {
      const e = mapCanvasError(r.status);
      res.status(e.code).json({ error: "CANVAS_ERROR", message: e.message });
      return;
    }
    res.json(
      CanvasListCoursesResponse.parse(
        r.data
          .filter((c) => c && c.name)
          .map((c) => ({
            id: c.id,
            name: c.name,
            courseCode: c.course_code ?? null,
            term: c.term?.name ?? null,
          })),
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Canvas list courses failed");
    res.status(502).json({ error: "CANVAS_UNREACHABLE", message: "Could not reach Canvas." });
  }
});

router.post("/canvas/assignments", async (req, res) => {
  const parsed = CanvasListAssignmentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_INPUT", message: "baseUrl, token and courseId are required." });
    return;
  }
  const { baseUrl, token, courseId } = parsed.data;
  const base = await validateCanvasBase(baseUrl);
  if (!base.ok) {
    res.status(400).json({ error: "INVALID_BASE_URL", message: base.message });
    return;
  }
  try {
    const r = await canvasFetchAll<{
      id: number;
      course_id: number;
      name: string;
      description?: string | null;
      due_at?: string | null;
      points_possible?: number | null;
      html_url?: string | null;
      submission_types?: string[];
      rubric?: unknown[];
    }>(base.url, token, `/courses/${encodeURIComponent(courseId)}/assignments`);
    if (!r.ok) {
      const e = mapCanvasError(r.status);
      res.status(e.code).json({ error: "CANVAS_ERROR", message: e.message });
      return;
    }
    res.json(
      CanvasListAssignmentsResponse.parse(
        r.data.map((a) => ({
          id: a.id,
          courseId: a.course_id,
          name: a.name,
          description: a.description ?? null,
          dueAt: a.due_at ?? null,
          pointsPossible: a.points_possible ?? null,
          htmlUrl: a.html_url ?? null,
          submissionTypes: a.submission_types ?? [],
          hasRubric: Array.isArray(a.rubric) && a.rubric.length > 0,
        })),
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Canvas list assignments failed");
    res.status(502).json({ error: "CANVAS_UNREACHABLE", message: "Could not reach Canvas." });
  }
});

router.post("/canvas/submissions", async (req, res) => {
  const parsed = CanvasListSubmissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_INPUT", message: "baseUrl, token and courseId are required." });
    return;
  }
  const { baseUrl, token, courseId } = parsed.data;
  const base = await validateCanvasBase(baseUrl);
  if (!base.ok) {
    res.status(400).json({ error: "INVALID_BASE_URL", message: base.message });
    return;
  }
  try {
    const r = await canvasFetchAll<{
      assignment_id: number;
      score?: number | null;
      grade?: string | null;
      submitted_at?: string | null;
      late?: boolean;
      workflow_state?: string | null;
    }>(base.url, token, `/courses/${encodeURIComponent(courseId)}/students/submissions?student_ids[]=self`);
    if (!r.ok) {
      const e = mapCanvasError(r.status);
      res.status(e.code).json({ error: "CANVAS_ERROR", message: e.message });
      return;
    }
    res.json(
      CanvasListSubmissionsResponse.parse(
        r.data.map((s) => ({
          assignmentId: s.assignment_id,
          score: s.score ?? null,
          grade: s.grade ?? null,
          submittedAt: s.submitted_at ?? null,
          late: s.late ?? false,
          workflowState: s.workflow_state ?? null,
        })),
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Canvas list submissions failed");
    res.status(502).json({ error: "CANVAS_UNREACHABLE", message: "Could not reach Canvas." });
  }
});

router.post("/canvas/assignment-files", async (req, res) => {
  const parsed = CanvasListAssignmentFilesBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "INVALID_INPUT", message: "baseUrl, token, courseId and assignmentId are required." });
    return;
  }
  const { baseUrl, token, courseId } = parsed.data;
  const base = await validateCanvasBase(baseUrl);
  if (!base.ok) {
    res.status(400).json({ error: "INVALID_BASE_URL", message: base.message });
    return;
  }
  try {
    // Canvas exposes course files; assignment-specific attachments live in the
    // assignment description. We surface the course files list as the available
    // material set the student can choose to import.
    const r = await canvasFetchAll<{
      id: number;
      display_name: string;
      filename?: string | null;
      "content-type"?: string | null;
      content_type?: string | null;
      url?: string | null;
      size?: number | null;
      mime_class?: string | null;
    }>(base.url, token, `/courses/${encodeURIComponent(courseId)}/files`);
    if (!r.ok) {
      const e = mapCanvasError(r.status);
      res.status(e.code).json({ error: "CANVAS_ERROR", message: e.message });
      return;
    }
    res.json(
      CanvasListAssignmentFilesResponse.parse(
        r.data.map((f) => ({
          id: f.id,
          displayName: f.display_name,
          fileName: f.filename ?? null,
          contentType: f["content-type"] ?? f.content_type ?? null,
          url: f.url ?? null,
          sizeBytes: f.size ?? null,
          kind: f.mime_class ?? null,
        })),
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Canvas list assignment files failed");
    res.status(502).json({ error: "CANVAS_UNREACHABLE", message: "Could not reach Canvas." });
  }
});

export default router;
