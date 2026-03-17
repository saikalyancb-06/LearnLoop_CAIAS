import { supabase } from "../lib/supabaseClient";
import { progressService } from "./progressService";
import { localAiService } from "./localAiService";

function splitIntoSentences(text: string) {
  return text
    .split(/[.!?]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildQuestions(topic: string, extractedText: string | null) {
  const sentences = splitIntoSentences(extractedText ?? "").slice(0, 3);

  if (sentences.length === 0) {
    return [
      `Can you explain ${topic} like I am a beginner?`,
      `What real-world example helps you understand ${topic}?`,
      `What part of ${topic} still feels unclear?`,
    ];
  }

  return [
    `Can you teach ${topic} using simple language?`,
    `How would you connect ${topic} to this idea: ${sentences[0]}?`,
    `What would you improve in your explanation of ${topic}?`,
  ];
}

function scoreExplanation(userMessages: string[]) {
  const combined = userMessages.join(" ").trim();
  const wordCount = combined.split(/\s+/).filter(Boolean).length;
  const baseScore = Math.min(100, 40 + wordCount);

  return {
    overall: Math.min(100, Math.round(baseScore * 0.9)),
    conceptAccuracy: Math.min(100, Math.round(baseScore * 0.95)),
    clarity: Math.min(100, Math.round(baseScore * 0.8)),
    completeness: Math.min(100, Math.round(baseScore * 0.85)),
    teachingAbility: Math.min(100, Math.round(baseScore * 0.9)),
  };
}

function fallbackImprovementPoints() {
  return [
    "Add one more real-world example.",
    "Explain the concept in fewer steps first, then expand.",
    "Call out the most important takeaway explicitly.",
  ];
}

function fallbackStrengths() {
  return [
    "You used your own words instead of repeating the document.",
    "Your explanation was structured around the main concept.",
    "You identified at least one supporting example or detail.",
  ];
}

export const feynmanService = {
  async getOrCreateSession(input: {
    documentId: string;
    userId: string;
    topic: string;
  }) {
    const { data: existing, error: existingError } = await supabase
      .from("feynman_sessions")
      .select("*")
      .eq("document_id", input.documentId)
      .eq("user_id", input.userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      return existing;
    }

    const { data: session, error: sessionError } = await supabase
      .from("feynman_sessions")
      .insert({
        document_id: input.documentId,
        user_id: input.userId,
        topic: input.topic,
      })
      .select()
      .single();

    if (sessionError) {
      throw sessionError;
    }

    await progressService.recordActivity({
      userId: input.userId,
      title: `Started Feynman session on ${input.topic}`,
      activityType: "feynman_started",
      documentId: input.documentId,
      sessionId: session.id,
    });

    return session;
  },

  async getSessionWithMessages(sessionId: string) {
    const [{ data: session, error: sessionError }, { data: messages, error: messagesError }] =
      await Promise.all([
        supabase.from("feynman_sessions").select("*").eq("id", sessionId).single(),
        supabase
          .from("feynman_messages")
          .select("*")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true }),
      ]);

    if (sessionError) {
      throw sessionError;
    }

    if (messagesError) {
      throw messagesError;
    }

    return { session, messages };
  },

  async ensureStarterMessage(input: {
    sessionId: string;
    topic: string;
    extractedText: string | null;
  }) {
    const { data: existing, error: existingError } = await supabase
      .from("feynman_messages")
      .select("id")
      .eq("session_id", input.sessionId)
      .limit(1);

    if (existingError) {
      throw existingError;
    }

    if (existing.length > 0) {
      return;
    }

    const starterQuestions = buildQuestions(input.topic, input.extractedText);
    const aiStarter = localAiService.isAvailable()
      ? await localAiService
          .createFeynmanStarter({
            topic: input.topic,
            extractedText: input.extractedText,
          })
          .catch(() => "")
      : "";

    const { error } = await supabase.from("feynman_messages").insert({
      session_id: input.sessionId,
      role: "ai",
      content: aiStarter || starterQuestions[0],
    });

    if (error) {
      throw error;
    }
  },

  async submitExplanation(input: {
    sessionId: string;
    topic: string;
    extractedText: string | null;
    explanation: string;
  }) {
    const questionFlow = buildQuestions(input.topic, input.extractedText);

    const { error: userError } = await supabase.from("feynman_messages").insert({
      session_id: input.sessionId,
      role: "user",
      content: input.explanation,
    });

    if (userError) {
      throw userError;
    }

    const { data: messages, error: messagesError } = await supabase
      .from("feynman_messages")
      .select("*")
      .eq("session_id", input.sessionId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      throw messagesError;
    }

    const userMessagesCount = messages.filter((message) => message.role === "user").length;
    const nextQuestion = questionFlow[Math.min(userMessagesCount, questionFlow.length - 1)];
    const completionPercent = Math.min(100, Math.round((userMessagesCount / questionFlow.length) * 100));
    const aiFollowUp = localAiService.isAvailable()
      ? await localAiService
          .createFeynmanFollowUp({
            topic: input.topic,
            extractedText: input.extractedText,
            conversation: messages,
            explanation: input.explanation,
            completionPercent,
          })
          .catch(() => "")
      : "";

    const { error: aiError } = await supabase.from("feynman_messages").insert({
      session_id: input.sessionId,
      role: "ai",
      content:
        aiFollowUp ||
        (completionPercent >= 100
          ? "You have explained the main ideas. Complete the session to see your evaluation."
          : nextQuestion),
    });

    if (aiError) {
      throw aiError;
    }

    const { error: sessionError } = await supabase
      .from("feynman_sessions")
      .update({ completion_percent: completionPercent })
      .eq("id", input.sessionId);

    if (sessionError) {
      throw sessionError;
    }

    return completionPercent;
  },

  async completeSession(input: {
    sessionId: string;
    userId: string;
    documentId: string;
  }) {
    const { session, messages } = await this.getSessionWithMessages(input.sessionId);
    const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content);
    const scores = scoreExplanation(userMessages);
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("extracted_text")
      .eq("id", input.documentId)
      .single();

    if (documentError) {
      throw documentError;
    }

    const aiEvaluation = localAiService.isAvailable()
      ? await localAiService
          .evaluateFeynman({
            topic: session.topic,
            extractedText: document.extracted_text,
            conversation: messages,
          })
          .catch(() => null)
      : null;
    const improvementPoints = aiEvaluation?.improvementPoints.length
      ? aiEvaluation.improvementPoints
      : fallbackImprovementPoints();
    const strengths = aiEvaluation?.strengths.length ? aiEvaluation.strengths : fallbackStrengths();

    const { data: result, error: resultError } = await supabase
      .from("feynman_results")
      .upsert({
        session_id: input.sessionId,
        overall_score: aiEvaluation?.overallScore ?? scores.overall,
        concept_accuracy: aiEvaluation?.conceptAccuracy ?? scores.conceptAccuracy,
        clarity: aiEvaluation?.clarity ?? scores.clarity,
        completeness: aiEvaluation?.completeness ?? scores.completeness,
        teaching_ability: aiEvaluation?.teachingAbility ?? scores.teachingAbility,
        strengths,
        improvement_points: improvementPoints,
        ai_feedback:
          aiEvaluation?.summary ??
          `You made solid progress explaining ${session.topic}. Focus on sharper examples and more complete step-by-step teaching next time.`,
      })
      .select()
      .single();

    if (resultError) {
      throw resultError;
    }

    const { error: sessionError } = await supabase
      .from("feynman_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_percent: 100,
      })
      .eq("id", input.sessionId);

    if (sessionError) {
      throw sessionError;
    }

    await progressService.recordActivity({
      userId: input.userId,
      title: `Completed Feynman session on ${session.topic}`,
      activityType: "feynman_completed",
      documentId: input.documentId,
      sessionId: input.sessionId,
      metadata: {
        score: result.overall_score,
      },
    });

    await progressService.upsertDailyStats({
      userId: input.userId,
      documentId: input.documentId,
      feynmanScore: result.overall_score,
      masteryScore: result.overall_score,
      studyMinutes: 15,
    });

    await progressService.updateDocumentCompletion(input.documentId);

    return result;
  },

  async getResult(sessionId: string) {
    const { data, error } = await supabase
      .from("feynman_results")
      .select("*")
      .eq("session_id", sessionId)
      .single();

    if (error) {
      throw error;
    }

    return data;
  },
};
