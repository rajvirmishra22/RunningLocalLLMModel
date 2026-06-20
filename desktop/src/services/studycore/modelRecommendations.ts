/**
 * Per-subject local-model recommendations.
 *
 * Pure, presentation-agnostic helpers shared by the web build and the desktop
 * overlay. This file intentionally imports ONLY from `webllmService`
 * (`getCatalog`, the `WebLLMModel`/`ModelCategory` types) and the local
 * `studycore` types — never `@tauri-apps/*` or `@workspace/*`, both of which
 * break the web Vite build when pulled into a shared module.
 *
 * Web and desktop ship DIFFERENT catalogs (MLC ids vs GGUF ids), so we never
 * hardcode model ids here — recommendations are resolved against whatever
 * `getCatalog()` returns at runtime, ranked by category + size.
 */
import type { ModelCategory, WebLLMModel } from "@/services/webllmService";
import type { Course } from "@/services/studycore/types";

export type StudySubject =
  | "computer-science"
  | "math"
  | "science"
  | "writing"
  | "humanities"
  | "language"
  | "business"
  | "general";

export interface SubjectMeta {
  /** Human label shown as the section heading. */
  label: string;
  /** Short emoji used as a lightweight, dependency-free icon. */
  emoji: string;
  /** One-line description of why these models suit the subject. */
  blurb: string;
  /**
   * Model categories that suit this subject, most-preferred first. Used to
   * rank the live catalog.
   */
  preferredCategories: ModelCategory[];
}

export const SUBJECT_META: Record<StudySubject, SubjectMeta> = {
  "computer-science": {
    label: "Computer Science",
    emoji: "💻",
    blurb: "Code-focused models that explain, write, and debug programs.",
    preferredCategories: ["coding", "reasoning", "general"],
  },
  math: {
    label: "Math",
    emoji: "📐",
    blurb: "Step-by-step reasoning models for proofs and problem solving.",
    preferredCategories: ["reasoning", "coding", "general"],
  },
  science: {
    label: "Science",
    emoji: "🔬",
    blurb: "Reasoning models that work through multi-step explanations.",
    preferredCategories: ["reasoning", "general"],
  },
  writing: {
    label: "Writing & English",
    emoji: "✍️",
    blurb: "Fluent general models for drafting, editing, and feedback.",
    preferredCategories: ["general", "reasoning"],
  },
  humanities: {
    label: "Humanities & Social Science",
    emoji: "📚",
    blurb: "Well-rounded models for essays, analysis, and discussion.",
    preferredCategories: ["general", "reasoning"],
  },
  language: {
    label: "World Languages",
    emoji: "🌍",
    blurb: "Multilingual models strong at translation and practice.",
    preferredCategories: ["general"],
  },
  business: {
    label: "Business & Economics",
    emoji: "📈",
    blurb: "Balanced general models for cases, summaries, and analysis.",
    preferredCategories: ["general", "reasoning"],
  },
  general: {
    label: "General Study",
    emoji: "🎓",
    blurb: "A solid all-rounder that handles most coursework.",
    preferredCategories: ["general", "reasoning"],
  },
};

interface SubjectKeywordRule {
  subject: StudySubject;
  keywords: string[];
}

/**
 * Keyword rules, evaluated in order — the first matching rule wins. More
 * specific subjects are listed before broader ones.
 */
const KEYWORD_RULES: SubjectKeywordRule[] = [
  {
    subject: "computer-science",
    keywords: [
      "computer science",
      "comp sci",
      "compsci",
      "cs ",
      "programming",
      "software",
      "coding",
      "data structure",
      "algorithm",
      "web dev",
      "python",
      "java",
      "javascript",
      "c++",
      "database",
      "machine learning",
      "informatics",
    ],
  },
  {
    subject: "math",
    keywords: [
      "math",
      "calculus",
      "algebra",
      "geometry",
      "trigonometry",
      "statistic",
      "probability",
      "precalc",
      "linear algebra",
      "discrete",
      "number theory",
    ],
  },
  {
    subject: "science",
    keywords: [
      "physics",
      "chemistry",
      "chem ",
      "biology",
      "bio ",
      "anatomy",
      "geology",
      "astronomy",
      "environmental",
      "science",
      "lab",
    ],
  },
  {
    subject: "writing",
    keywords: [
      "english",
      "writing",
      "composition",
      "literature",
      "rhetoric",
      "creative writing",
      "essay",
      "poetry",
    ],
  },
  {
    subject: "language",
    keywords: [
      "spanish",
      "french",
      "german",
      "chinese",
      "mandarin",
      "japanese",
      "latin",
      "italian",
      "korean",
      "arabic",
      "language",
      "linguistic",
      "esl",
    ],
  },
  {
    subject: "business",
    keywords: [
      "business",
      "econ",
      "economics",
      "accounting",
      "finance",
      "marketing",
      "management",
      "entrepreneur",
    ],
  },
  {
    subject: "humanities",
    keywords: [
      "history",
      "philosophy",
      "psychology",
      "sociology",
      "political",
      "government",
      "geography",
      "anthropology",
      "religion",
      "ethics",
      "civics",
      "humanities",
      "social studies",
    ],
  },
];

/** Map a free-text course name to a study subject. */
export function classifyCourse(name: string): StudySubject {
  const haystack = ` ${name.toLowerCase()} `;
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) {
      return rule.subject;
    }
  }
  return "general";
}

/**
 * Derive the distinct subjects present across a set of courses, preserving the
 * order in which they first appear. Falls back to `["general"]` when there are
 * no courses so the section always has something useful to show.
 */
export function subjectsForCourses(courses: Course[]): StudySubject[] {
  const seen = new Set<StudySubject>();
  const ordered: StudySubject[] = [];
  for (const course of courses) {
    const subject = classifyCourse(course.name);
    if (!seen.has(subject)) {
      seen.add(subject);
      ordered.push(subject);
    }
  }
  return ordered.length > 0 ? ordered : ["general"];
}

export interface ModelRecommendation {
  model: WebLLMModel;
  /** Why this model was picked for the subject. */
  reason: string;
}

/**
 * Rank the live catalog for a subject and return the top picks.
 *
 * Models are scored by how early their category appears in the subject's
 * `preferredCategories`, then by size (smaller first, so the suggestions stay
 * approachable on modest hardware). Custom user-added models are skipped — we
 * only recommend known catalog entries.
 */
export function recommendForSubject(
  subject: StudySubject,
  catalog: WebLLMModel[],
  max = 2,
): ModelRecommendation[] {
  const meta = SUBJECT_META[subject];
  const prefs = meta.preferredCategories;

  const scored = catalog
    .filter((m) => !m.custom)
    .map((model) => {
      const category = model.category ?? "general";
      const rank = prefs.indexOf(category);
      return { model, category, rank };
    })
    .filter((entry) => entry.rank !== -1)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.model.sizeMb - b.model.sizeMb;
    });

  // If nothing matched the preferred categories (unusual catalog), fall back to
  // the smallest general-purpose models so the section is never empty.
  const ranked =
    scored.length > 0
      ? scored
      : catalog
          .filter((m) => !m.custom)
          .sort((a, b) => a.sizeMb - b.sizeMb)
          .map((model) => ({ model, category: model.category ?? "general", rank: 0 }));

  return ranked.slice(0, max).map(({ model, category }) => ({
    model,
    reason: reasonFor(subject, category),
  }));
}

function reasonFor(subject: StudySubject, category: ModelCategory): string {
  switch (category) {
    case "coding":
      return "Tuned for code — great for assignments and debugging.";
    case "reasoning":
      return "Thinks step-by-step, ideal for problem solving.";
    case "vision":
      return "Can read images alongside your questions.";
    default:
      return `Well-rounded pick for ${SUBJECT_META[subject].label.toLowerCase()}.`;
  }
}
