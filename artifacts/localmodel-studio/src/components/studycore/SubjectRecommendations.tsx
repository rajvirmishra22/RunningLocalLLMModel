import { useMemo } from "react";
import { Sparkles, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WebLLMModel } from "@/services/webllmService";
import type { Course } from "@/services/studycore/types";
import {
  SUBJECT_META,
  recommendForSubject,
  subjectsForCourses,
  type ModelRecommendation,
  type StudySubject,
} from "@/services/studycore/modelRecommendations";

interface SubjectRecommendationsProps {
  /** The live model catalog (web MLC ids or desktop GGUF ids). */
  catalog: WebLLMModel[];
  /** The user's courses, used to infer which subjects to recommend for. */
  courses: Course[];
  /** Called when the user adds a recommended model. */
  onAdd: (model: WebLLMModel) => void;
  /** Whether a given model is already in the user's profiles/library. */
  isAdded: (model: WebLLMModel) => boolean;
  /** Label for the add button (e.g. "Add" on web, "Download" on desktop). */
  addLabel?: string;
  /** Label shown once a model is added (e.g. "Added" / "On disk"). */
  addedLabel?: string;
}

interface SubjectBlock {
  subject: StudySubject;
  recs: ModelRecommendation[];
}

export function SubjectRecommendations({
  catalog,
  courses,
  onAdd,
  isAdded,
  addLabel = "Add",
  addedLabel = "Added",
}: SubjectRecommendationsProps) {
  const blocks = useMemo<SubjectBlock[]>(() => {
    const subjects = subjectsForCourses(courses);
    return subjects
      .map((subject) => ({
        subject,
        recs: recommendForSubject(subject, catalog),
      }))
      .filter((b) => b.recs.length > 0);
  }, [catalog, courses]);

  if (blocks.length === 0) return null;

  const hasCourses = courses.length > 0;

  return (
    <section data-testid="section-subject-recommendations">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold">Recommended for your subjects</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {hasCourses
          ? "Local models picked to match the courses you've connected. They run entirely on your device."
          : "Connect your courses to get tailored picks. Here's a solid all-rounder to start with."}
      </p>

      <div className="space-y-3">
        {blocks.map(({ subject, recs }) => {
          const meta = SUBJECT_META[subject];
          return (
            <div
              key={subject}
              className="rounded-lg border border-border p-3"
              data-testid={`rec-subject-${subject}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span aria-hidden className="text-base leading-none">
                  {meta.emoji}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{meta.label}</p>
                  <p className="text-[10px] text-muted-foreground">{meta.blurb}</p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {recs.map(({ model, reason }) => {
                  const added = isAdded(model);
                  return (
                    <div
                      key={model.id}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-muted/40 border border-border"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{model.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {(model.sizeMb / 1000).toFixed(1)} GB · {reason}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={added ? "outline" : "default"}
                        className="h-7 text-[11px] px-2.5 flex-shrink-0 gap-1"
                        disabled={added}
                        onClick={() => onAdd(model)}
                        data-testid={`btn-rec-add-${model.id}`}
                      >
                        {!added && <Plus className="w-3 h-3" />}
                        {added ? addedLabel : addLabel}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
