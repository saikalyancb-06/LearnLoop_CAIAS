import { supabase } from "../lib/supabaseClient";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export const progressService = {
  async updateDocumentCompletion(documentId: string) {
    const { data: flashcards, error: flashcardError } = await supabase
      .from("flashcards")
      .select("id, status")
      .eq("document_id", documentId);

    if (flashcardError) {
      throw flashcardError;
    }

    const { data: sessions, error: sessionError } = await supabase
      .from("feynman_sessions")
      .select("id, status")
      .eq("document_id", documentId);

    if (sessionError) {
      throw sessionError;
    }

    const totalFlashcards = flashcards.length;
    const completedFlashcards = flashcards.filter((card) => card.status !== "unseen").length;
    const flashcardScore =
      totalFlashcards > 0 ? (completedFlashcards / totalFlashcards) * 60 : 0;

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter((session) => session.status === "completed").length;
    const feynmanScore =
      totalSessions > 0 ? Math.min(40, (completedSessions / totalSessions) * 40) : 0;

    const completionPercent = clampScore(flashcardScore + feynmanScore);

    const { error: updateError } = await supabase
      .from("documents")
      .update({ completion_percent: completionPercent })
      .eq("id", documentId);

    if (updateError) {
      throw updateError;
    }

    return completionPercent;
  },

  async recordActivity(input: {
    userId: string;
    title: string;
    activityType: string;
    documentId?: string | null;
    sessionId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const { error } = await supabase.from("recent_activity").insert({
      user_id: input.userId,
      title: input.title,
      activity_type: input.activityType,
      document_id: input.documentId ?? null,
      session_id: input.sessionId ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      throw error;
    }
  },

  async upsertDailyStats(input: {
    userId: string;
    documentId?: string | null;
    studyMinutes?: number;
    flashcardsKnown?: number;
    flashcardsDifficult?: number;
    masteryScore?: number;
    feynmanScore?: number | null;
  }) {
    const statDate = new Date().toISOString().slice(0, 10);

    const { data: existing, error: fetchError } = await supabase
      .from("progress_stats")
      .select("*")
      .eq("user_id", input.userId)
      .eq("document_id", input.documentId ?? null)
      .eq("stat_date", statDate)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    if (!existing) {
      const { error: insertError } = await supabase.from("progress_stats").insert({
        user_id: input.userId,
        document_id: input.documentId ?? null,
        stat_date: statDate,
        study_minutes: input.studyMinutes ?? 0,
        flashcards_known: input.flashcardsKnown ?? 0,
        flashcards_difficult: input.flashcardsDifficult ?? 0,
        mastery_score: input.masteryScore ?? 0,
        feynman_score: input.feynmanScore ?? null,
      });

      if (insertError) {
        throw insertError;
      }

      return;
    }

    const { error: updateError } = await supabase
      .from("progress_stats")
      .update({
        study_minutes: existing.study_minutes + (input.studyMinutes ?? 0),
        flashcards_known: Math.max(existing.flashcards_known, input.flashcardsKnown ?? existing.flashcards_known),
        flashcards_difficult: Math.max(
          existing.flashcards_difficult,
          input.flashcardsDifficult ?? existing.flashcards_difficult,
        ),
        mastery_score: Math.max(existing.mastery_score, input.masteryScore ?? existing.mastery_score),
        feynman_score:
          input.feynmanScore === null || input.feynmanScore === undefined
            ? existing.feynman_score
            : Math.max(existing.feynman_score ?? 0, input.feynmanScore),
      })
      .eq("id", existing.id);

    if (updateError) {
      throw updateError;
    }
  },
};

