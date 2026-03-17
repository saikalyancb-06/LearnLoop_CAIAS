import { env } from "../lib/env";
import type { GeneratedFlashcard } from "./documentProcessing";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type Provider = "ollama" | "groq";

type FeynmanEvaluation = {
  overallScore: number;
  conceptAccuracy: number;
  clarity: number;
  completeness: number;
  teachingAbility: number;
  strengths: string[];
  improvementPoints: string[];
  misconceptions: string[];
  summary: string;
};

function clampScore(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stripCodeFences(content: string) {
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractJson<T>(content: string): T | null {
  const stripped = stripCodeFences(content);

  try {
    return JSON.parse(stripped) as T;
  } catch {
    const objectMatch = stripped.match(/\{[\s\S]*\}/);

    if (!objectMatch) {
      return null;
    }

    try {
      return JSON.parse(objectMatch[0]) as T;
    } catch {
      return null;
    }
  }
}

function readChoiceContent(payload: ChatCompletionResponse) {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  return "";
}

async function createChatCompletion(messages: ChatMessage[], responseFormat?: { type: "json_object" }) {
  const provider = env.aiProvider as Provider;
  const isOllama = provider === "ollama";
  const baseUrl = isOllama ? env.localAiBaseUrl : env.groqBaseUrl;

  if (!baseUrl || (isOllama && !env.localAiEnabled) || (!isOllama && !env.groqApiKey)) {
    throw new Error("AI provider is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.localAiTimeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(isOllama ? {} : { Authorization: `Bearer ${env.groqApiKey}` }),
      },
      body: JSON.stringify({
        model: isOllama ? env.localAiModel : env.groqModel,
        temperature: 0.2,
        messages,
        response_format: responseFormat,
        max_tokens: 500,
        stream: false,
        ...(isOllama ? { keep_alive: env.localAiKeepAlive } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Local AI request failed with status ${response.status}.`);
    }

    return (await response.json()) as ChatCompletionResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function limitContext(text: string | null | undefined, maxLength = 6000) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "";
  }

  return normalized.slice(0, maxLength);
}

function trimList(value: unknown, limit = 4) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean).slice(0, limit)
    : [];
}

function tokenize(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) ?? [];
}

function selectRelevantPassages(input: {
  query: string;
  extractedText?: string | null;
  sections?: Array<{ title?: string | null; content: string }>;
  limit?: number;
}) {
  const limit = input.limit ?? 5;
  const queryTokens = new Set(tokenize(input.query));
  const sectionCandidates =
    input.sections?.map((section) => ({
      text: [section.title, section.content].filter(Boolean).join("\n"),
    })) ?? [];

  const fallbackChunks =
    sectionCandidates.length > 0
      ? sectionCandidates
      : limitContext(input.extractedText, 5000)
          .split(/\n{2,}/)
          .map((chunk) => ({ text: chunk.trim() }))
          .filter((chunk) => chunk.text);

  const scored = fallbackChunks
    .map((chunk) => {
      const chunkTokens = tokenize(chunk.text);
      const overlap = chunkTokens.filter((token) => queryTokens.has(token)).length;
      return { ...chunk, score: overlap };
    })
    .sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, limit).map((chunk) => chunk.text).filter(Boolean);
  return selected.length ? selected.join("\n\n") : limitContext(input.extractedText, 3500);
}

export const localAiService = {
  isAvailable() {
    return env.aiProvider === "groq"
      ? Boolean(env.groqBaseUrl && env.groqApiKey)
      : env.localAiEnabled && Boolean(env.localAiBaseUrl);
  },

  async getStatus() {
    if (!this.isAvailable()) {
      return {
        connected: false,
        model: env.aiProvider === "groq" ? env.groqModel : env.localAiModel,
        provider: env.aiProvider,
        mode: "disabled" as const,
      };
    }

    try {
      const provider = env.aiProvider as Provider;
      const isOllama = provider === "ollama";
      const response = await fetch(
        `${isOllama ? env.localAiBaseUrl : env.groqBaseUrl}/models`,
        {
          headers: isOllama ? undefined : { Authorization: `Bearer ${env.groqApiKey}` },
        },
      );

      if (!response.ok) {
        throw new Error("Unable to reach local AI.");
      }

      const payload = (await response.json()) as {
        data?: Array<{ id?: string }>;
      };
      const availableModels = payload.data?.map((model) => model.id).filter(Boolean) ?? [];

      return {
        connected: true,
        model: isOllama ? env.localAiModel : env.groqModel,
        provider,
        mode: availableModels.includes(isOllama ? env.localAiModel : env.groqModel)
          ? ("live" as const)
          : ("fallback" as const),
      };
    } catch {
      return {
        connected: false,
        model: env.aiProvider === "groq" ? env.groqModel : env.localAiModel,
        provider: env.aiProvider,
        mode: "fallback" as const,
      };
    }
  },

  async askCopilot(input: {
    documentTitle: string;
    extractedText: string | null;
    question: string;
    userNotes?: string | null;
    sections?: Array<{ title?: string | null; content: string }>;
  }) {
    const relevantContext = selectRelevantPassages({
      query: input.question,
      extractedText: input.extractedText,
      sections: input.sections,
      limit: 5,
    });

    const payload = await createChatCompletion([
      {
        role: "system",
          content:
          "You are LearnLoop's academic copilot. Answer only from the provided study material and user notes. Be concise, direct, and helpful. If the material is insufficient, say so clearly.",
      },
      {
        role: "user",
        content: [
          `Document title: ${input.documentTitle}`,
          `Relevant study material:\n${relevantContext || "No extracted text available."}`,
          `User notes:\n${limitContext(input.userNotes ?? "", 2000) || "No notes yet."}`,
          `Question: ${input.question}`,
        ].join("\n\n"),
      },
    ]);

    return readChoiceContent(payload);
  },

  async generateFlashcards(input: {
    title: string;
    extractedText: string;
  }) {
    const payload = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You create concise academic flashcards from notes. Return valid JSON only with this schema: {\"flashcards\":[{\"question\":\"string\",\"answer\":\"string\",\"difficulty\":\"easy|medium|hard\"}]}",
        },
        {
          role: "user",
          content: [
            `Title: ${input.title}`,
            `Material:\n${limitContext(input.extractedText, 8000)}`,
            "Generate 6 high-value flashcards that test core understanding, not trivia.",
          ].join("\n\n"),
        },
      ],
      { type: "json_object" },
    );

    const content = readChoiceContent(payload);
    const parsed = extractJson<{ flashcards?: Array<{ question?: unknown; answer?: unknown; difficulty?: unknown }> }>(content);
    const flashcards = parsed?.flashcards
      ?.map((card, index) => {
        const question = normalizeText(card.question);
        const answer = normalizeText(card.answer);

        if (!question || !answer) {
          return null;
        }

        return {
          question,
          answer,
          sortOrder: index,
          difficulty: normalizeText(card.difficulty),
        };
      })
      .filter(Boolean) as Array<GeneratedFlashcard & { difficulty?: string }>;

    return flashcards?.length ? flashcards : null;
  },

  async createFeynmanStarter(input: {
    topic: string;
    extractedText: string | null;
  }) {
    const payload = await createChatCompletion([
      {
        role: "system",
        content:
          "You are a Feynman study coach. Ask one short opening question that gets the student to explain the actual content of the uploaded document in simple language. Ignore generic chapter names, filenames, and labels like UNIT3DBMS. Do not ask what the title means. Do not speculate from the title. Ask about the ideas present in the reference material only.",
      },
      {
        role: "user",
        content: [
          `Content cue from the document: ${input.topic}`,
          `Study material:\n${limitContext(input.extractedText, 5000) || "No extracted text available."}`,
        ].join("\n\n"),
      },
    ]);

    return readChoiceContent(payload);
  },

  async createFeynmanFollowUp(input: {
    topic: string;
    extractedText: string | null;
    sessionSummary: string | null;
    conversation: Array<{ role: string; content: string }>;
    explanation: string;
    completionPercent: number;
  }) {
    const transcript = input.conversation
      .slice(-8)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const payload = await createChatCompletion([
      {
        role: "system",
        content:
          "You are a strict Feynman study coach. Ask one focused follow-up question that targets misunderstandings, missing causal links, vague wording, or missing examples in the uploaded document content. Ignore generic chapter names, filenames, and labels like UNIT3DBMS. Never ask what the title means or infer concepts from the title alone. If the student has covered enough and completion is near 100, reply with one short sentence telling them to complete the session for evaluation.",
      },
      {
        role: "user",
        content: [
          `Content cue from the document: ${input.topic}`,
          `Completion percent: ${input.completionPercent}`,
          `Reference material:\n${limitContext(input.extractedText, 3500) || "No extracted text available."}`,
          `Running session summary:\n${limitContext(input.sessionSummary, 1800) || "No prior summary yet."}`,
          `Recent conversation:\n${transcript || "No prior conversation."}`,
          `Latest student explanation:\n${limitContext(input.explanation, 2500)}`,
        ].join("\n\n"),
      },
    ]);

    return readChoiceContent(payload);
  },

  async evaluateFeynman(input: {
    topic: string;
    extractedText: string | null;
    sessionSummary: string | null;
    conversation: Array<{ role: string; content: string }>;
  }) {
    const transcript = input.conversation
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const payload = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You evaluate a student's explanation of an academic topic. Compare the student's explanation against the reference material. Identify what was incorrect, what was missing, and what was vague. Return valid JSON only with this schema: {\"overall_score\":0,\"concept_accuracy\":0,\"clarity\":0,\"completeness\":0,\"teaching_ability\":0,\"strengths\":[\"string\"],\"misconceptions\":[\"string\"],\"improvement_points\":[\"string\"],\"summary\":\"string\"}",
        },
        {
          role: "user",
          content: [
            `Content cue from the document: ${input.topic}`,
            `Reference material:\n${limitContext(input.extractedText, 4000) || "No extracted text available."}`,
            `Running session summary:\n${limitContext(input.sessionSummary, 2200) || "No prior summary yet."}`,
            `Conversation transcript:\n${limitContext(transcript, 4500)}`,
          ].join("\n\n"),
        },
      ],
      { type: "json_object" },
    );

    const content = readChoiceContent(payload);
    const parsed = extractJson<{
      overall_score?: unknown;
      concept_accuracy?: unknown;
      clarity?: unknown;
      completeness?: unknown;
      teaching_ability?: unknown;
      strengths?: unknown;
      misconceptions?: unknown;
      improvement_points?: unknown;
      summary?: unknown;
    }>(content);

    if (!parsed) {
      return null;
    }

    const strengths = trimList(parsed.strengths);
    const misconceptions = trimList(parsed.misconceptions);
    const improvementPoints = trimList(parsed.improvement_points, 5);

    const evaluation: FeynmanEvaluation = {
      overallScore: clampScore(parsed.overall_score),
      conceptAccuracy: clampScore(parsed.concept_accuracy),
      clarity: clampScore(parsed.clarity),
      completeness: clampScore(parsed.completeness),
      teachingAbility: clampScore(parsed.teaching_ability),
      strengths,
      misconceptions,
      improvementPoints,
      summary: normalizeText(parsed.summary),
    };

    if (!evaluation.summary) {
      return null;
    }

    return evaluation;
  },

  async updateFeynmanSessionSummary(input: {
    topic: string;
    extractedText: string | null;
    previousSummary: string | null;
    conversation: Array<{ role: string; content: string }>;
  }) {
    const transcript = input.conversation
      .slice(-6)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const payload = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You maintain a compact study-session memory. Return valid JSON only with this schema: {\"session_summary\":\"string\"}. The summary must capture what the student understands, what is wrong, what is missing, and what the tutor should probe next. Keep it under 160 words.",
        },
        {
          role: "user",
          content: [
            `Content cue from the document: ${input.topic}`,
            `Reference material:\n${limitContext(input.extractedText, 3000) || "No extracted text available."}`,
            `Previous summary:\n${limitContext(input.previousSummary, 1400) || "No prior summary yet."}`,
            `Recent conversation:\n${transcript || "No recent conversation."}`,
          ].join("\n\n"),
        },
      ],
      { type: "json_object" },
    );

    const content = readChoiceContent(payload);
    const parsed = extractJson<{ session_summary?: unknown }>(content);
    const sessionSummary = normalizeText(parsed?.session_summary);

    return sessionSummary || null;
  },
};
