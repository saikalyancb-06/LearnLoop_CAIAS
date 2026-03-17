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

type FeynmanEvaluation = {
  overallScore: number;
  conceptAccuracy: number;
  clarity: number;
  completeness: number;
  teachingAbility: number;
  strengths: string[];
  improvementPoints: string[];
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
  if (!env.localAiEnabled || !env.localAiBaseUrl) {
    throw new Error("Local AI is disabled.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.localAiTimeoutMs);

  try {
    const response = await fetch(`${env.localAiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.localAiModel,
        temperature: 0.2,
        messages,
        response_format: responseFormat,
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

export const localAiService = {
  isAvailable() {
    return env.localAiEnabled && Boolean(env.localAiBaseUrl);
  },

  async askCopilot(input: {
    documentTitle: string;
    extractedText: string | null;
    question: string;
    userNotes?: string | null;
  }) {
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
          `Study material:\n${limitContext(input.extractedText, 7000) || "No extracted text available."}`,
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
          "You are a Feynman study coach. Ask one short opening question that gets the student to explain the topic in simple language. Do not ask multiple questions.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.topic}`,
          `Study material:\n${limitContext(input.extractedText, 5000) || "No extracted text available."}`,
        ].join("\n\n"),
      },
    ]);

    return readChoiceContent(payload);
  },

  async createFeynmanFollowUp(input: {
    topic: string;
    extractedText: string | null;
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
          "You are a Feynman study coach. Ask one focused follow-up question that probes understanding, missing details, or examples. If the student has covered enough and completion is near 100, reply with one short sentence telling them to complete the session for evaluation.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.topic}`,
          `Completion percent: ${input.completionPercent}`,
          `Study material:\n${limitContext(input.extractedText, 5000) || "No extracted text available."}`,
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
            "You evaluate a student's explanation of an academic topic. Return valid JSON only with this schema: {\"overall_score\":0,\"concept_accuracy\":0,\"clarity\":0,\"completeness\":0,\"teaching_ability\":0,\"strengths\":[\"string\"],\"improvement_points\":[\"string\"],\"summary\":\"string\"}",
        },
        {
          role: "user",
          content: [
            `Topic: ${input.topic}`,
            `Reference material:\n${limitContext(input.extractedText, 7000) || "No extracted text available."}`,
            `Conversation transcript:\n${limitContext(transcript, 8000)}`,
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
      improvement_points?: unknown;
      summary?: unknown;
    }>(content);

    if (!parsed) {
      return null;
    }

    const strengths = Array.isArray(parsed.strengths)
      ? parsed.strengths.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    const improvementPoints = Array.isArray(parsed.improvement_points)
      ? parsed.improvement_points.map((item) => normalizeText(item)).filter(Boolean)
      : [];

    const evaluation: FeynmanEvaluation = {
      overallScore: clampScore(parsed.overall_score),
      conceptAccuracy: clampScore(parsed.concept_accuracy),
      clarity: clampScore(parsed.clarity),
      completeness: clampScore(parsed.completeness),
      teachingAbility: clampScore(parsed.teaching_ability),
      strengths,
      improvementPoints,
      summary: normalizeText(parsed.summary),
    };

    if (!evaluation.summary) {
      return null;
    }

    return evaluation;
  },
};
