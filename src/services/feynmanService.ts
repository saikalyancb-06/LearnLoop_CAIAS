import { supabase } from "../lib/supabaseClient";
import { progressService } from "./progressService";
import { localAiService } from "./localAiService";

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitIntoSentences(text: string) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isCodeLikeText(text: string) {
  const value = normalizeWhitespace(text);

  if (!value) {
    return false;
  }

  const hintCount = [
    /#include/i,
    /\b(int|void|return|struct|class|switch|case|printf|scanf|malloc|free)\b/i,
    /\{/, /\}/,
    /;\s*/,
    /\bmain\s*\(/i,
  ].filter((pattern) => pattern.test(value)).length;

  return hintCount >= 3;
}

function truncateSentence(value: string, maxLength = 170) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function extractMeaningfulCue(text: string) {
  const sentences = splitIntoSentences(text);

  const candidate =
    sentences.find((sentence) => sentence.split(/\s+/).length >= 7 && !isCodeLikeText(sentence)) ??
    sentences.find((sentence) => sentence.split(/\s+/).length >= 5) ??
    sentences[0] ??
    "";

  return truncateSentence(candidate);
}

function buildQuestions(topic: string, extractedText: string | null) {
  const normalizedTopic = truncateSentence(topic, 120) || "this document";
  const normalizedText = normalizeWhitespace(extractedText ?? "");

  if (!normalizedText) {
    return [
      `Explain the core idea of ${normalizedTopic} like you're teaching a beginner.`,
      "Give one concrete example that proves your explanation is correct.",
      "Which part still feels unclear, and how would you clarify it step by step?",
    ];
  }

  if (isCodeLikeText(normalizedText)) {
    return [
      `Walk me through the logic of ${normalizedTopic} from input to output in simple steps.`,
      "Which function or code block is most important, and why does it matter?",
      "Where can this code fail or break, and what improvement would you make first?",
    ];
  }

  const cue = extractMeaningfulCue(normalizedText) || normalizedTopic;

  return [
    `Teach this idea from the document in simple language: ${cue}`,
    "What specific detail from the document supports your explanation best?",
    "What important point is still missing, and how would you improve your explanation?",
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

function buildFallbackSessionSummary(input: {
  topic: string;
  previousSummary: string | null;
  messages: Array<{ role: string; content: string }>;
}) {
  const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const latestAiMessage = [...input.messages].reverse().find((message) => message.role === "ai")?.content ?? "";
  const trimmedSummary = input.previousSummary?.trim();

  return [
    trimmedSummary,
    `Topic: ${input.topic}.`,
    latestUserMessage ? `Latest student explanation: ${latestUserMessage.slice(0, 280)}` : null,
    latestAiMessage ? `Latest tutor prompt: ${latestAiMessage.slice(0, 200)}` : null,
    "Focus next on misconceptions, missing links, and one concrete example.",
  ]
    .filter(Boolean)
    .join(" ");
}

const LOW_SIGNAL_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "have",
  "will",
  "about",
  "what",
  "when",
  "where",
  "which",
  "while",
  "these",
  "those",
  "then",
  "than",
  "them",
  "they",
  "their",
  "there",
  "document",
  "topic",
  "concept",
  "main",
  "idea",
  "explain",
  "teach",
]);

function tokenizeContent(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g)
    ?.filter((token) => !LOW_SIGNAL_TOKENS.has(token)) ?? [];
}

function isGenericFeynmanPrompt(prompt: string) {
  const normalized = normalizeWhitespace(prompt).toLowerCase();

  return [
    /^can you explain/i,
    /^what is the main idea/i,
    /^tell me more/i,
    /^explain this/i,
    /^what does the title mean/i,
    /^summarize/i,
  ].some((pattern) => pattern.test(normalized));
}

function isFeynmanPromptGrounded(input: {
  prompt: string;
  topic: string;
  extractedText: string | null;
  completionPercent?: number;
}) {
  const prompt = normalizeWhitespace(input.prompt);

  if (!prompt || prompt.length < 16) {
    return false;
  }

  if (
    (input.completionPercent ?? 0) >= 95 &&
    /complete\s+the\s+session|see\s+your\s+evaluation/i.test(prompt)
  ) {
    return true;
  }

  if (isGenericFeynmanPrompt(prompt)) {
    return false;
  }

  const promptTokens = tokenizeContent(prompt);

  if (!promptTokens.length) {
    return false;
  }

  const materialTokens = new Set(tokenizeContent(input.extractedText ?? ""));

  if (!materialTokens.size) {
    return prompt.length > 24;
  }

  const overlap = promptTokens.filter((token) => materialTokens.has(token)).length;

  if (overlap >= 2) {
    return true;
  }

  const topicTokens = new Set(tokenizeContent(input.topic));
  const topicOverlap = promptTokens.filter((token) => topicTokens.has(token)).length;

  return overlap >= 1 && topicOverlap >= 1;
}

export const feynmanService = {
  async createSession(input: {
    documentId: string;
    userId: string;
    topic: string;
  }) {
    const { error: archiveError } = await supabase
      .from("feynman_sessions")
      .update({
        status: "archived",
      })
      .eq("document_id", input.documentId)
      .eq("user_id", input.userId)
      .eq("status", "active");

    if (archiveError) {
      throw archiveError;
    }

    const { data: session, error: sessionError } = await supabase
      .from("feynman_sessions")
      .insert({
        document_id: input.documentId,
        user_id: input.userId,
        topic: input.topic,
        session_summary: `Fresh session on ${input.topic}. No student explanation yet.`,
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

  async listSessions(input: {
    documentId: string;
    userId: string;
  }) {
    const { data: sessions, error: sessionsError } = await supabase
      .from("feynman_sessions")
      .select("*")
      .eq("document_id", input.documentId)
      .eq("user_id", input.userId)
      .order("created_at", { ascending: false });

    if (sessionsError) {
      throw sessionsError;
    }

    if (sessions.length === 0) {
      return [];
    }

    const { data: results, error: resultsError } = await supabase
      .from("feynman_results")
      .select("session_id, overall_score")
      .in(
        "session_id",
        sessions.map((session) => session.id),
      );

    if (resultsError) {
      throw resultsError;
    }

    const scoreBySessionId = new Map(
      results.map((result) => [result.session_id, result.overall_score]),
    );

    return sessions.map((session) => ({
      ...session,
      overall_score: scoreBySessionId.get(session.id) ?? null,
    }));
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
    const groundedStarter = isFeynmanPromptGrounded({
      prompt: aiStarter,
      topic: input.topic,
      extractedText: input.extractedText,
    })
      ? aiStarter
      : "";

    const { error } = await supabase.from("feynman_messages").insert({
      session_id: input.sessionId,
      role: "ai",
      content: groundedStarter || starterQuestions[0],
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

    const { data: currentSession, error: currentSessionError } = await supabase
      .from("feynman_sessions")
      .select("session_summary")
      .eq("id", input.sessionId)
      .single();

    if (currentSessionError) {
      throw currentSessionError;
    }

    const updatedSummary = localAiService.isAvailable()
      ? await localAiService
          .updateFeynmanSessionSummary({
            topic: input.topic,
            extractedText: input.extractedText,
            previousSummary: currentSession.session_summary,
            conversation: messages,
          })
          .catch(() =>
            buildFallbackSessionSummary({
              topic: input.topic,
              previousSummary: currentSession.session_summary,
              messages,
            }),
          )
      : buildFallbackSessionSummary({
          topic: input.topic,
          previousSummary: currentSession.session_summary,
          messages,
        });

    const userMessagesCount = messages.filter((message) => message.role === "user").length;
    const nextQuestion = questionFlow[Math.min(userMessagesCount, questionFlow.length - 1)];
    const completionPercent = Math.min(100, Math.round((userMessagesCount / questionFlow.length) * 100));
    const aiFollowUp = localAiService.isAvailable()
      ? await localAiService
          .createFeynmanFollowUp({
            topic: input.topic,
            extractedText: input.extractedText,
            sessionSummary: updatedSummary,
            conversation: messages,
            explanation: input.explanation,
            completionPercent,
          })
          .catch(() => "")
      : "";
    const groundedFollowUp = isFeynmanPromptGrounded({
      prompt: aiFollowUp,
      topic: input.topic,
      extractedText: input.extractedText,
      completionPercent,
    })
      ? aiFollowUp
      : "";

    const { error: aiError } = await supabase.from("feynman_messages").insert({
      session_id: input.sessionId,
      role: "ai",
      content:
        groundedFollowUp ||
        (completionPercent >= 100
          ? "You have explained the main ideas. Complete the session to see your evaluation."
          : nextQuestion),
    });

    if (aiError) {
      throw aiError;
    }

    const { error: sessionError } = await supabase
      .from("feynman_sessions")
      .update({
        completion_percent: completionPercent,
        session_summary: updatedSummary,
      })
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
            sessionSummary: session.session_summary,
            conversation: messages,
          })
          .catch(() => null)
      : null;
    const misconceptions = aiEvaluation?.misconceptions.length
      ? aiEvaluation.misconceptions
      : [];
    const improvementPoints = aiEvaluation?.improvementPoints.length
      ? [...misconceptions, ...aiEvaluation.improvementPoints].slice(0, 5)
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
          aiEvaluation
            ? [aiEvaluation.summary, misconceptions.length ? `Specific issues: ${misconceptions.join(" ")}` : null]
                .filter(Boolean)
                .join(" ")
            : 
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
