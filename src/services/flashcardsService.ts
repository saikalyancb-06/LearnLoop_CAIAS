import { supabase } from "../lib/supabaseClient";
import { progressService } from "./progressService";

export const flashcardsService = {
  async getFlashcards(documentId: string) {
    const { data, error } = await supabase
      .from("flashcards")
      .select("*")
      .eq("document_id", documentId)
      .order("sort_order", { ascending: true });

    if (error) {
      throw error;
    }

    return data;
  },

  async updateFlashcardStatus(input: {
    flashcardId: string;
    documentId: string;
    status: "known" | "difficult" | "unseen";
  }) {
    const difficulty = input.status === "difficult" ? "high" : null;
    const { data, error } = await supabase
      .from("flashcards")
      .update({
        status: input.status,
        difficulty,
      })
      .eq("id", input.flashcardId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    await progressService.updateDocumentCompletion(input.documentId);

    const { data: stats, error: statsError } = await supabase
      .from("flashcards")
      .select("status")
      .eq("document_id", input.documentId);

    if (statsError) {
      throw statsError;
    }

    const known = stats.filter((card) => card.status === "known").length;
    const difficult = stats.filter((card) => card.status === "difficult").length;
    const masteryBase = stats.length > 0 ? (known / stats.length) * 100 : 0;

    await progressService.upsertDailyStats({
      userId: data.user_id,
      documentId: input.documentId,
      flashcardsKnown: known,
      flashcardsDifficult: difficult,
      masteryScore: Math.round(masteryBase),
      studyMinutes: 5,
    });

    return data;
  },
};

