// Rubric Checker prompt construction + robust parsing of the model's reply.
// The page runs the model (local or cloud); this module builds the instruction
// and turns the raw text back into a structured report. Hard rules: never claim
// an official score, never promise a grade, never auto-submit.

import type { RubricCriterionResult } from "./types";

export interface ParsedRubric {
  criteriaResults: RubricCriterionResult[];
  strengths: string[];
  priorityRevisions: string[];
  finalChecklist: string[];
  revisedOutline?: string;
}

export function buildRubricPrompt(rubricText: string, draftText: string): string {
  return [
    "You are an academic writing/work reviewer. Compare a student's draft against a rubric and produce structured, constructive feedback to help them revise BEFORE submitting.",
    "",
    "STRICT RULES:",
    "- Do NOT assign or claim an official score or grade.",
    "- Do NOT rewrite the entire assignment.",
    "- Treat your output as feedback, not grading.",
    "",
    "Respond with ONLY valid JSON matching this exact shape (no markdown, no commentary):",
    `{
  "criteriaResults": [
    {
      "criterionName": "string",
      "requirementSummary": "string",
      "evidenceFound": ["string"],
      "missingOrWeakElements": ["string"],
      "revisionSuggestions": ["string"],
      "confidence": "high" | "medium" | "low" | "needs_review"
    }
  ],
  "strengths": ["string"],
  "priorityRevisions": ["string"],
  "finalChecklist": ["string"],
  "revisedOutline": "string (optional revision plan)"
}`,
    "",
    "=== RUBRIC ===",
    rubricText.trim(),
    "",
    "=== STUDENT DRAFT ===",
    draftText.trim(),
    "",
    "Now produce the JSON report.",
  ].join("\n");
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/** Extract the first balanced JSON object from a possibly-noisy model reply. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse the model output into a ParsedRubric. Falls back to a single
 * "Needs student review" criterion containing the raw text when JSON parsing
 * fails, so the student always gets *something* actionable.
 */
export function parseRubricReport(raw: string): ParsedRubric {
  const json = extractJsonObject(raw);
  if (json) {
    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      const criteria = Array.isArray(obj.criteriaResults) ? obj.criteriaResults : [];
      const criteriaResults: RubricCriterionResult[] = criteria.map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const conf = o.confidence;
        return {
          criterionName: typeof o.criterionName === "string" ? o.criterionName : "Criterion",
          requirementSummary: typeof o.requirementSummary === "string" ? o.requirementSummary : "",
          evidenceFound: asStringArray(o.evidenceFound),
          missingOrWeakElements: asStringArray(o.missingOrWeakElements),
          revisionSuggestions: asStringArray(o.revisionSuggestions),
          confidence:
            conf === "high" || conf === "medium" || conf === "low" || conf === "needs_review"
              ? conf
              : "needs_review",
          completed: false,
        };
      });
      if (criteriaResults.length > 0) {
        return {
          criteriaResults,
          strengths: asStringArray(obj.strengths),
          priorityRevisions: asStringArray(obj.priorityRevisions),
          finalChecklist: asStringArray(obj.finalChecklist),
          revisedOutline:
            typeof obj.revisedOutline === "string" && obj.revisedOutline.trim()
              ? obj.revisedOutline.trim()
              : undefined,
        };
      }
    } catch {
      // fall through to fallback
    }
  }

  return {
    criteriaResults: [
      {
        criterionName: "Analysis (unstructured)",
        requirementSummary: "The model did not return structured JSON. Raw feedback below.",
        evidenceFound: [],
        missingOrWeakElements: [],
        revisionSuggestions: [raw.trim().slice(0, 4000)],
        confidence: "needs_review",
        completed: false,
      },
    ],
    strengths: [],
    priorityRevisions: [],
    finalChecklist: [],
  };
}
