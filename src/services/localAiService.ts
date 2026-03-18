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
    finish_reason?: string | null;
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
  knowledgeRating: string;
};

type FeynmanQuestionPlan = {
  estimatedQuestionCount: number;
  rationale: string;
};

type FeynmanTurnReview = {
  verdict: "correct" | "partially_correct" | "incorrect";
  score: number;
  strengths: string[];
  missingPoints: string[];
  incorrectPoints: string[];
  feedback: string;
  shouldAskFollowUp: boolean;
  nextQuestion: string;
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

function responseWasTruncated(payload: ChatCompletionResponse) {
  const finishReason = payload.choices?.[0]?.finish_reason;

  if (!finishReason) {
    return false;
  }

  return finishReason === "length" || finishReason === "max_tokens";
}

async function createChatCompletion(
  messages: ChatMessage[],
  responseFormat?: { type: "json_object" },
  options?: { maxTokens?: number; temperature?: number },
) {
  const provider = env.aiProvider as Provider;
  const isOllama = provider === "ollama";
  const baseUrl = isOllama ? env.localAiBaseUrl : env.groqBaseUrl;

  if (!baseUrl || (isOllama && !env.localAiEnabled) || (!isOllama && !env.groqApiKey)) {
    throw new Error("AI provider is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.localAiTimeoutMs);

  try {
    const maxTokens = Math.max(200, Math.min(1800, options?.maxTokens ?? 700));
    const temperature = options?.temperature ?? 0.2;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(isOllama ? {} : { Authorization: `Bearer ${env.groqApiKey}` }),
      },
      body: JSON.stringify({
        model: isOllama ? env.localAiModel : env.groqModel,
        temperature,
        messages,
        response_format: responseFormat,
        max_tokens: maxTokens,
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

function clampQuestionCount(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return 8;
  }

  return Math.max(5, Math.min(20, Math.round(numeric)));
}

function normalizeVerdict(value: unknown): FeynmanTurnReview["verdict"] {
  const normalized = normalizeText(value).toLowerCase();

  if (normalized === "correct" || normalized === "partially_correct" || normalized === "incorrect") {
    return normalized;
  }

  return "partially_correct";
}

function normalizeTurnScore(verdict: FeynmanTurnReview["verdict"], value: unknown) {
  const rawScore = clampScore(value);

  if (verdict === "correct") {
    return Math.max(75, rawScore);
  }

  if (verdict === "partially_correct") {
    return Math.max(45, rawScore);
  }

  return Math.min(rawScore, 35);
}

function tokenize(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) ?? [];
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
  "describe",
]);

function contentTokens(value: string) {
  return tokenize(value).filter((token) => !LOW_SIGNAL_TOKENS.has(token));
}

function normalizeQuestion(value: unknown) {
  const normalized = normalizeText(value).replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (/[?]$/.test(normalized)) {
    return normalized;
  }

  return `${normalized}?`;
}

function isUnsureAnswer(value: string) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    "dont know",
    "don't know",
    "idk",
    "i dont know",
    "i don't know",
    "no idea",
    "not sure",
    "unsure",
    "dunno",
    "i really dont know",
    "i really don't know",
  ].some((token) => normalized.includes(token));
}

function isGenericFlashcardQuestion(question: string) {
  const normalized = question.trim().toLowerCase();

  return [
    /^how does .+ relate to .+\??$/i,
    /^what is the main idea/i,
    /^what does this document/i,
    /^explain (this|the) (concept|topic)/i,
    /^summarize (the )?(document|topic)/i,
  ].some((pattern) => pattern.test(normalized));
}

function isFlashcardGrounded(input: {
  question: string;
  answer: string;
  title: string;
  materialTokens: Set<string>;
}) {
  if (isGenericFlashcardQuestion(input.question)) {
    return false;
  }

  const questionTokens = contentTokens(input.question);
  const answerTokens = contentTokens(input.answer);

  if (questionTokens.length < 2 || answerTokens.length < 2) {
    return false;
  }

  if (input.materialTokens.size === 0) {
    return input.question.length > 24 && input.answer.length > 24;
  }

  const questionOverlap = questionTokens.filter((token) => input.materialTokens.has(token)).length;
  const answerOverlap = answerTokens.filter((token) => input.materialTokens.has(token)).length;
  const totalOverlap = questionOverlap + answerOverlap;

  if (questionOverlap >= 1 && totalOverlap >= 3) {
    return true;
  }

  const titleTokens = new Set(contentTokens(input.title));
  const titleOverlap = questionTokens.filter((token) => titleTokens.has(token)).length;

  return questionOverlap >= 1 && answerOverlap >= 1 && titleOverlap >= 1;
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

    const baseMessages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are LearnLoop's academic copilot. Answer only from the provided study material and user notes. Give clear, well-structured answers with short sections. Keep the response complete and concise unless the user explicitly asks for deep detail. When the user asks about source code or the material includes code, return a properly formatted fenced code block first, then explain it step by step in simple language. Do not invent missing APIs or facts. If the material is insufficient, say exactly what is missing.",
      },
      {
        role: "user",
        content: [
          `Document title: ${input.documentTitle}`,
          `Relevant study material:\n${relevantContext || "No extracted text available."}`,
          `User notes:\n${limitContext(input.userNotes ?? "", 2000) || "No notes yet."}`,
          "Response format: start with the direct answer. If code is involved, include a cleaned code block and then a concise explanation of each important part.",
          `Question: ${input.question}`,
        ].join("\n\n"),
      },
    ];

    const payload = await createChatCompletion(baseMessages, undefined, { maxTokens: 1200 });
    let answer = readChoiceContent(payload);

    if (answer && responseWasTruncated(payload)) {
      const continuationPayload = await createChatCompletion(
        [
          ...baseMessages,
          { role: "assistant", content: answer },
          {
            role: "user",
            content:
              "Continue exactly from where you stopped. Do not repeat previous lines. Finish the answer cleanly with a short final summary.",
          },
        ],
        undefined,
        { maxTokens: 700 },
      ).catch(() => null);

      const continuation = continuationPayload ? readChoiceContent(continuationPayload) : "";

      if (continuation) {
        answer = `${answer}\n\n${continuation}`;
      }
    }

    return answer;
  },

  async generateFlashcards(input: {
    title: string;
    extractedText: string;
    regenerationNonce?: string;
  }) {
    // Retry with temperature variation if first attempt yields weak results
    for (let attempt = 0; attempt < 2; attempt++) {
      const temperature = attempt === 0 ? 0.2 : 0.4; // second try is more creative
      const materialExcerpt = limitContext(input.extractedText, 9000);
      const materialTokens = new Set(contentTokens(materialExcerpt));
      const payload = await createChatCompletion(
        [
          {
            role: "system",
            content:
              "You create high-quality academic flashcards strictly grounded in supplied notes. Return valid JSON only with this schema: {\"flashcards\":[{\"question\":\"string\",\"answer\":\"string\",\"difficulty\":\"easy|medium|hard\"}]}. Rules: each question must reference a concrete concept, term, function, or process explicitly present in the notes; avoid generic prompts like 'How does X relate to Y?' or 'What is the main idea?'; answers must be factual, concise (1-2 sentences), and include at least one concrete detail from the notes.",
          },
          {
            role: "user",
            content: [
              `Title: ${input.title}`,
              `Material:\n${materialExcerpt}`,
              input.regenerationNonce
                ? `Regeneration run: ${input.regenerationNonce}. Create a fresh but still grounded set that focuses on different angles than a previous run.`
                : "",
              "Generate 6 relevant flashcards with varied focus across definitions, process flow, differences, and practical understanding. Keep each question specific and unambiguous.",
            ].join("\n\n"),
          },
        ],
        { type: "json_object" },
        { maxTokens: 1300, temperature },
      );

      const content = readChoiceContent(payload);
      const parsed = extractJson<{ flashcards?: Array<{ question?: unknown; answer?: unknown; difficulty?: unknown }> }>(content);
      const flashcards = parsed?.flashcards
        ?.map((card, index) => {
          const question = normalizeQuestion(card.question);
          const answer = normalizeText(card.answer).replace(/\s+/g, " ").trim();

          if (!question || !answer) {
            return null;
          }

          if (
            !isFlashcardGrounded({
              question,
              answer,
              title: input.title,
              materialTokens,
            })
          ) {
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

      // Return if we got a decent set (4+ cards)
      if (flashcards?.length && flashcards.length >= 4) {
        return flashcards;
      }
    }

    // Exhausted retries
    return null;
  },

  async createFeynmanStarter(input: {
    topic: string;
    extractedText: string | null;
  }) {
    const payload = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You are a strict Feynman study coach. Ask exactly one focused opening question grounded in the reference material only. Avoid generic prompts. Do not ask about title meaning, chapter labels, or filenames. If the material is code, ask about program flow, key functions, data structures, or edge cases. Keep the question concise and clear.",
        },
        {
          role: "user",
          content: [
            `Content cue from the document: ${input.topic}`,
            `Study material:\n${limitContext(input.extractedText, 5000) || "No extracted text available."}`,
            "Question quality rules: specific, concept-driven, and answerable from the provided material.",
          ].join("\n\n"),
        },
      ],
      undefined,
      { maxTokens: 500, temperature: 0.35 },
    );

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

    const payload = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You are a strict Feynman study coach. Ask exactly one focused follow-up question that targets a concrete gap: misconception, missing step, weak reasoning, or absent example. Ground every question in the provided reference material only. If material is code, ask about control flow, function responsibilities, complexity, edge cases, or correctness. Never ask generic questions. If completion is near 100 and understanding is solid, respond with one short sentence telling the student to complete the session for evaluation.",
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
            "Question quality rules: specific, test understanding deeply, and avoid repeating earlier prompts.",
          ].join("\n\n"),
        },
      ],
      undefined,
      { maxTokens: 650, temperature: 0.35 },
    );

    return readChoiceContent(payload);
  },

  async estimateFeynmanQuestionCount(input: {
    topic: string;
    extractedText: string | null;
  }) {
    const payload = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You plan a short oral teaching assessment. Return valid JSON only with this schema: {\"estimated_question_count\":8,\"rationale\":\"string\"}. Choose an integer from 5 to 20 based on topic complexity, density, ambiguity, and likely misconceptions. Prefer fewer questions for narrow topics and more for dense or multi-step topics.",
        },
        {
          role: "user",
          content: [
            `Topic:\n${input.topic}`,
            `Reference material:\n${limitContext(input.extractedText, 5000) || "No extracted text available."}`,
          ].join("\n\n"),
        },
      ],
      { type: "json_object" },
      { maxTokens: 400, temperature: 0.2 },
    );

    const parsed = extractJson<{ estimated_question_count?: unknown; rationale?: unknown }>(
      readChoiceContent(payload),
    );

    if (!parsed) {
      return null;
    }

    return {
      estimatedQuestionCount: clampQuestionCount(parsed.estimated_question_count),
      rationale: normalizeText(parsed.rationale),
    } satisfies FeynmanQuestionPlan;
  },

  async reviewFeynmanTurn(input: {
    topic: string;
    extractedText: string | null;
    sessionSummary: string | null;
    conversation: Array<{ role: string; content: string }>;
    explanation: string;
    questionCount: number;
    targetQuestionCount: number;
  }) {
    const transcript = input.conversation
      .slice(-8)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const payload = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You are a strict but fair Feynman tutor evaluating one student answer at a time. Return valid JSON only with this schema: {\"verdict\":\"correct|partially_correct|incorrect\",\"score\":0,\"strengths\":[\"string\"],\"missing_points\":[\"string\"],\"incorrect_points\":[\"string\"],\"feedback\":\"string\",\"should_ask_follow_up\":true,\"next_question\":\"string\"}. Critical grading rules: 1. Mark an answer incorrect only if it directly contradicts the reference material. 2. If the answer is short, partial, or incomplete but not contradictory, mark it partially_correct, not incorrect. 3. If the student says they do not know, mark incorrect and ask a simpler, more guided next question instead of repeating the same wording. 4. In incorrect_points, mention only true contradictions, not missing details. 5. In missing_points, list omitted required ideas. 6. Score concise but directionally correct answers in a reasonable partial-credit range, not near zero.",
        },
        {
          role: "user",
          content: [
            `Content cue from the document: ${input.topic}`,
            `Answered questions so far: ${input.questionCount} / ${input.targetQuestionCount}`,
            `Reference material:\n${limitContext(input.extractedText, 4500) || "No extracted text available."}`,
            `Running session summary:\n${limitContext(input.sessionSummary, 1800) || "No prior summary yet."}`,
            `Recent conversation:\n${transcript || "No prior conversation."}`,
            `Latest student explanation:\n${limitContext(input.explanation, 2200)}`,
            isUnsureAnswer(input.explanation)
              ? "The latest student answer is an explicit 'I don't know' style response. Do not repeat the previous question wording. Ask a simpler guided next question."
              : "The latest student answer may be partial. If it is directionally correct, award partial credit rather than marking it wrong.",
          ].join("\n\n"),
        },
      ],
      { type: "json_object" },
      { maxTokens: 900, temperature: 0.25 },
    );

    const parsed = extractJson<{
      verdict?: unknown;
      score?: unknown;
      strengths?: unknown;
      missing_points?: unknown;
      incorrect_points?: unknown;
      feedback?: unknown;
      should_ask_follow_up?: unknown;
      next_question?: unknown;
    }>(readChoiceContent(payload));

    if (!parsed) {
      return null;
    }

    const verdict = normalizeVerdict(parsed.verdict);

    const review: FeynmanTurnReview = {
      verdict,
      score: normalizeTurnScore(verdict, parsed.score),
      strengths: trimList(parsed.strengths, 4),
      missingPoints: trimList(parsed.missing_points, 4),
      incorrectPoints: trimList(parsed.incorrect_points, 4),
      feedback: normalizeText(parsed.feedback),
      shouldAskFollowUp: Boolean(parsed.should_ask_follow_up),
      nextQuestion: normalizeQuestion(parsed.next_question),
    };

    if (!review.feedback || !review.nextQuestion) {
      return null;
    }

    return review;
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
      knowledgeRating:
        clampScore(parsed.overall_score) >= 85
          ? "Advanced"
          : clampScore(parsed.overall_score) >= 70
            ? "Proficient"
            : clampScore(parsed.overall_score) >= 50
              ? "Developing"
              : "Foundational",
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
