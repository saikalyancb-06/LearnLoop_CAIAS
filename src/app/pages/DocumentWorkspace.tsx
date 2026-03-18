import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Sparkles, Send, CreditCard, GraduationCap, FileText } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../hooks/useAuth";
import { documentsService } from "../../services/documentsService";
import { flashcardsService } from "../../services/flashcardsService";
import { isSessionCacheFresh, readSessionCache, UI_CACHE_MAX_AGE, writeSessionCache } from "../../lib/cache";
import { localAiService } from "../../services/localAiService";
import { MarkdownText } from "../components/MarkdownText";
import { DocumentMindMap } from "../components/DocumentMindMap";

type ChatMessage = {
  id: string;
  role: "ai" | "user";
  content: string;
};

type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string };

function looksLikeFlattenedCode(content: string) {
  const hasFewLineBreaks = content.split("\n").length <= 2;
  const semicolonCount = (content.match(/;/g) ?? []).length;
  const codeHintCount = [
    /#include/i,
    /\bstruct\b/i,
    /\bclass\b/i,
    /\bfunction\b/i,
    /\breturn\b/i,
    /\{/,
    /\}/,
  ].filter((pattern) => pattern.test(content)).length;

  return hasFewLineBreaks && semicolonCount >= 4 && codeHintCount >= 3;
}

function inferCodeLanguage(content: string) {
  if (/#include|printf|scanf|malloc|\bstruct\b/i.test(content)) {
    return "c";
  }

  if (/function\s+\w+|\bconst\b|\blet\b|=>/.test(content)) {
    return "javascript";
  }

  return "text";
}

function formatFlattenedCode(content: string) {
  const withBreaks = content
    .replace(/\{/g, "{\n")
    .replace(/\}/g, "\n}\n")
    .replace(/;\s*/g, ";\n")
    .replace(/\n{3,}/g, "\n\n");

  let indentLevel = 0;

  return withBreaks
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("}")) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      const formattedLine = `${"  ".repeat(indentLevel)}${line}`;

      if (line.endsWith("{")) {
        indentLevel += 1;
      }

      return formattedLine;
    })
    .join("\n");
}

function parseMessageParts(content: string): MessagePart[] {
  const codeBlockPattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  const matches = [...content.matchAll(codeBlockPattern)];

  if (matches.length === 0) {
    if (looksLikeFlattenedCode(content)) {
      return [
        {
          type: "code",
          language: inferCodeLanguage(content),
          content: formatFlattenedCode(content),
        },
      ];
    }

    return [{ type: "text", content }];
  }

  const parts: MessagePart[] = [];
  let cursor = 0;

  for (const match of matches) {
    const matchIndex = match.index ?? 0;
    const textBefore = content.slice(cursor, matchIndex);

    if (textBefore.trim()) {
      parts.push({ type: "text", content: textBefore.trim() });
    }

    parts.push({
      type: "code",
      language: (match[1] ?? "text").trim() || "text",
      content: (match[2] ?? "").replace(/\n+$/, ""),
    });

    cursor = matchIndex + match[0].length;
  }

  const trailing = content.slice(cursor);

  if (trailing.trim()) {
    parts.push({ type: "text", content: trailing.trim() });
  }

  return parts.length ? parts : [{ type: "text", content }];
}

function truncateText(value: string, maxLength = 500) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function formatDenseStudyText(content: string, maxLength?: number) {
  const normalized = content
    .replace(/\u00a0/g, " ")
    .replace(/[□■▪▫◦•]/g, " • ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  let formatted = normalized
    .replace(/^\d+\s+(?=chapter\b)/i, "")
    .replace(/\s*•\s*/g, "\n• ")
    .replace(/\s+(?=\d+[.)]\s+)/g, "\n")
    .replace(/([.!?])\s+(?=[A-Z][a-z])/g, "$1\n");

  const objectiveCount = (formatted.match(/\bTo\s+[a-z]/g) ?? []).length;

  if (objectiveCount >= 3 && !formatted.includes("\n• To")) {
    const chunks = formatted
      .split(/\s+(?=To\s+[a-z])/g)
      .map((chunk) => chunk.trim())
      .filter(Boolean);

    if (chunks.length > 1) {
      const [lead, ...rest] = chunks;
      formatted = [lead, ...rest.map((chunk) => `• ${chunk}`)].join("\n");
    }
  }

  formatted = formatted.replace(/\n{3,}/g, "\n\n").trim();

  if (typeof maxLength === "number") {
    return truncateText(formatted, maxLength);
  }

  return formatted;
}

function buildInitialCopilotMessage(input: {
  title: string;
  summary: string | null | undefined;
  extractedText: string | null;
}) {
  const cleanedSummary = formatDenseStudyText(input.summary ?? "", 480);

  if (cleanedSummary) {
    return cleanedSummary;
  }

  const firstChunk =
    input.extractedText
      ?.split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .find((chunk) => chunk.length > 40) ??
    "";
  const cleanedChunk = formatDenseStudyText(firstChunk, 420);

  if (cleanedChunk) {
    return `I analyzed ${input.title}. Here is a clean summary:\n${cleanedChunk}`;
  }

  return `I analyzed ${input.title}. Ask me anything about the key ideas.`;
}

function buildCopilotReply(question: string, documentTitle: string, extractedText: string | null) {
  const summary = extractedText?.split("\n").slice(0, 2).join(" ") ?? "";
  const normalizedQuestion = question.toLowerCase();

  if (normalizedQuestion.includes("example")) {
    return `A practical example from ${documentTitle}: connect the concept to one everyday situation, then explain how the document's main idea applies. ${summary}`;
  }

  if (normalizedQuestion.includes("simple")) {
    return `${documentTitle} in simple terms: start with the core idea, explain why it matters, and then use one short example. ${summary}`;
  }

  if (normalizedQuestion.includes("code") || normalizedQuestion.includes("program")) {
    return [
      `Structured explanation for ${documentTitle}:`,
      "1. Identify the main purpose of the code and the key data structures.",
      "2. Break logic into small steps: input, processing, and output.",
      "3. Check edge cases and memory/error handling.",
      summary ? `Reference clue from document: ${summary}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Based on ${documentTitle}, here is a structured answer:`,
    "1. Main idea",
    "2. Why it matters",
    "3. One practical example",
    summary ? `Reference clue from document: ${summary}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const GENERIC_FOCUS_WORDS = new Set([
  "overview",
  "section",
  "document",
  "topic",
  "concept",
  "chapter",
  "unit",
  "introduction",
  "summary",
  "part",
  "lesson",
  "module",
  "hash",
  "probing",
  "quadratic",
  "mod",
  "table",
  "item",
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitIntoSentences(value: string) {
  return normalizeWhitespace(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isGenericTopic(value: string, documentTitle: string) {
  const normalized = normalizeWhitespace(value).toLowerCase();

  if (!normalized) {
    return true;
  }

  if (normalized === normalizeWhitespace(documentTitle).toLowerCase()) {
    return true;
  }

  if (/^section\s+\d+/i.test(normalized) || /^chapter\s+\d+/i.test(normalized) || /^unit\s+\d+/i.test(normalized)) {
    return true;
  }

  const tokens = normalized.match(/[a-z0-9]{3,}/g) ?? [];

  if (tokens.length <= 1) {
    return true;
  }

  return tokens.every((token) => GENERIC_FOCUS_WORDS.has(token));
}

function extractSectionFocus(section: any, documentTitle: string) {
  const title = normalizeWhitespace(section?.title ?? "");
  const sectionContent = typeof section?.content === "string" ? section.content : "";
  const bestSentence =
    splitIntoSentences(sectionContent).find((sentence) => {
      const tokens = sentence.match(/[a-z0-9]{3,}/gi) ?? [];
      return tokens.length >= 5 && !isGenericTopic(sentence, documentTitle);
    }) ?? "";

  if (bestSentence) {
    return truncateText(bestSentence, 80);
  }

  if (title && !isGenericTopic(title, documentTitle)) {
    return truncateText(title, 80);
  }

  return "";
}

function deriveFeynmanTopics(document: any) {
  const title = typeof document?.title === "string" ? document.title : "Document";
  const conceptTopics = (Array.isArray(document?.metadata?.concepts) ? document.metadata.concepts : [])
    .map((concept: any, index: number) => ({
      id: concept.id ?? `concept-${index}`,
      label: normalizeWhitespace(concept.label ?? ""),
    }))
    .filter((concept: { label: string }) => concept.label)
    .flatMap((concept) => {
      const tokens = concept.label.match(/[A-Za-z][A-Za-z-]{2,}/g) ?? [];
      return tokens.map((token, index) => ({
        id: `${concept.id}-token-${index}`,
        label: token.replace(/^\w/, (char) => char.toUpperCase()),
      }));
    })
    .filter((topic: { label: string }) => !isGenericTopic(topic.label, title))
    .filter((topic: { label: string }, index: number, values: Array<{ label: string }>) =>
      values.findIndex((candidate) => candidate.label.toLowerCase() === topic.label.toLowerCase()) === index,
    );

  if (conceptTopics.length > 0) {
    return conceptTopics.slice(0, 6);
  }

  return (Array.isArray(document?.sections) ? document.sections : [])
    .map((section: any, index: number) => ({
      id: section.id ?? `section-topic-${index}`,
      label: extractSectionFocus(section, title),
    }))
    .filter((topic: { label: string }, index: number, values: Array<{ label: string }>) =>
      topic.label && !isGenericTopic(topic.label, title) &&
      values.findIndex((candidate) => candidate.label === topic.label) === index,
    )
    .slice(0, 6);
}

export function DocumentWorkspace() {
  const { documentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [chatInput, setChatInput] = useState(() => readSessionCache(`workspace.${documentId}.chatInput`) ?? "");
  const [activeTab, setActiveTab] = useState<"flashcards" | "feynman" | "notes">("flashcards");
  const [document, setDocument] = useState<any | null>(() => readSessionCache(`workspace.${documentId}.document`));
  const [flashcards, setFlashcards] = useState<any[]>(() => readSessionCache(`workspace.${documentId}.flashcards`) ?? []);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => readSessionCache(`workspace.${documentId}.messages`) ?? []);
  const [notes, setNotes] = useState(() => readSessionCache(`workspace.${documentId}.notes`) ?? "");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeynmanTopic, setSelectedFeynmanTopic] = useState<string | null>(null);

  async function loadWorkspace() {
    if (!documentId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [nextDocument, nextFlashcards] = await Promise.all([
        documentsService.getDocument(documentId),
        flashcardsService.getFlashcards(documentId),
      ]);

      setDocument(nextDocument);
      setFlashcards(nextFlashcards);
      setNotes(nextDocument.user_notes ?? "");
      setChatMessages((currentMessages) =>
        currentMessages.length > 0
          ? currentMessages
          : [
              {
                id: "1",
                role: "ai",
                content: buildInitialCopilotMessage({
                  title: nextDocument.title,
                  summary: nextDocument.metadata?.summary as string | undefined,
                  extractedText: nextDocument.extracted_text,
                }),
              },
            ],
      );
      await documentsService.markDocumentOpened(documentId);
    } catch (workspaceError) {
      setError(
        workspaceError instanceof Error
          ? workspaceError.message
          : "Unable to load this workspace.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (
      documentId &&
      readSessionCache(`workspace.${documentId}.document`) &&
      isSessionCacheFresh(`workspace.${documentId}.document`, UI_CACHE_MAX_AGE) &&
      isSessionCacheFresh(`workspace.${documentId}.flashcards`, UI_CACHE_MAX_AGE)
    ) {
      setIsLoading(false);
      return;
    }

    void loadWorkspace();
  }, [documentId]);

  useEffect(() => {
    if (!documentId) {
      return;
    }

    writeSessionCache(`workspace.${documentId}.document`, document);
    writeSessionCache(`workspace.${documentId}.flashcards`, flashcards);
    writeSessionCache(`workspace.${documentId}.messages`, chatMessages);
    writeSessionCache(`workspace.${documentId}.notes`, notes);
    writeSessionCache(`workspace.${documentId}.chatInput`, chatInput);
  }, [chatInput, chatMessages, document, documentId, flashcards, notes]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!chatInput.trim() || !document || isSendingMessage) {
      return;
    }

    const question = chatInput.trim();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };

    setChatMessages((currentMessages) => [...currentMessages, userMessage]);
    setChatInput("");

    setIsSendingMessage(true);

    try {
      const aiReply = localAiService.isAvailable()
        ? await localAiService.askCopilot({
            documentTitle: document.title,
            extractedText: document.extracted_text,
            question,
            userNotes: notes,
            sections: document.sections,
          })
        : "";

      setChatMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: "ai",
          content: aiReply || buildCopilotReply(question, document.title, document.extracted_text),
        },
      ]);
    } catch {
      setChatMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: "ai",
          content: buildCopilotReply(question, document.title, document.extracted_text),
        },
      ]);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!documentId) {
      return;
    }

    setIsSavingNotes(true);
    setError(null);

    try {
      const updated = await documentsService.updateUserNotes(documentId, notes);
      setDocument((currentDocument: any) => ({
        ...currentDocument,
        user_notes: updated.user_notes,
      }));
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save your notes.",
      );
    } finally {
      setIsSavingNotes(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading document workspace...</div>;
  }

  if (!document) {
    return <div className="p-8 text-sm text-red-600">{error ?? "Document not found."}</div>;
  }

  const feynmanTopics = deriveFeynmanTopics(document);

  const activeFeynmanTopic = selectedFeynmanTopic ?? feynmanTopics[0]?.label ?? document.title;

  const startFeynmanSession = (topic?: string) => {
    const nextTopic = topic ?? activeFeynmanTopic;
    const searchParams = new URLSearchParams();

    if (nextTopic?.trim()) {
      searchParams.set("topic", nextTopic.trim());
    }

    navigate(`/notes/${document.id}/feynman?${searchParams.toString()}`);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/notes" className="text-gray-500 hover:text-gray-700">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{document.title}</h1>
            <p className="text-sm text-gray-500">{document.completion_percent}% completed</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm">
            {document.processing_status === "ready" ? "AI Analysis Complete" : "Processing"}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mx-8 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-2/5 border-r border-gray-200 bg-white p-6 overflow-auto">
          <DocumentMindMap
            title={document.title}
            summary={(document.metadata?.summary as string | undefined) ?? document.extracted_text}
            concepts={Array.isArray(document.metadata?.concepts) ? document.metadata.concepts : []}
            sections={document.sections}
          />

          <div className="mt-4 space-y-3">
            {document.sections.map((section: any) => (
              <div key={section.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-sm font-medium text-gray-900">{section.title}</div>
                <div className="mt-2 text-sm text-gray-500">
                  <MarkdownText content={section.content} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-gray-50">
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <h2 className="font-medium text-gray-900">AI Academic Copilot</h2>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-6 space-y-4">
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-2xl rounded-lg px-4 py-3 ${
                    message.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-white border border-gray-200 text-gray-900"
                  }`}
                >
                  {parseMessageParts(message.content).map((part, index) =>
                    part.type === "code" ? (
                      <div
                        key={`${message.id}-code-${index}`}
                        className="my-2 overflow-x-auto rounded-md border border-slate-700 bg-slate-950"
                      >
                        <div className="border-b border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                          {part.language}
                        </div>
                        <pre className="p-3 text-xs leading-6 text-slate-100">
                          <code>{part.content}</code>
                        </pre>
                      </div>
                    ) : (
                      <div
                        key={`${message.id}-text-${index}`}
                        className="break-words text-sm leading-relaxed [&:not(:last-child)]:mb-2"
                      >
                        <MarkdownText content={part.content} />
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="px-6 py-3 bg-white border-t border-gray-200">
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setChatInput("Explain this simply")}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg transition-colors"
              >
                Explain simply
              </button>
              <button
                onClick={() => setChatInput("Give an example from the document")}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg transition-colors"
              >
                Give example
              </button>
              <button
                onClick={() => setChatInput("What should I study next from this document?")}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg transition-colors"
              >
                Generate quiz
              </button>
            </div>

            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask a question about the document..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={isSendingMessage}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>

        <div className="w-80 border-l border-gray-200 bg-white flex flex-col">
          <div className="border-b border-gray-200 flex">
            <button
              onClick={() => setActiveTab("flashcards")}
              className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "flashcards"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <CreditCard className="w-4 h-4 mx-auto mb-1" />
              Flashcards
            </button>
            <button
              onClick={() => setActiveTab("feynman")}
              className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "feynman"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <GraduationCap className="w-4 h-4 mx-auto mb-1" />
              Feynman
            </button>
            <button
              onClick={() => setActiveTab("notes")}
              className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "notes"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <FileText className="w-4 h-4 mx-auto mb-1" />
              Notes
            </button>
          </div>

          <div className="flex-1 overflow-auto p-6">
            {activeTab === "flashcards" && (
              <div>
                <h3 className="font-medium text-gray-900 mb-4">Generated Flashcards</h3>
                <div className="space-y-3">
                  {flashcards.slice(0, 3).map((flashcard) => (
                    <Link
                      key={flashcard.id}
                      to={`/flashcards/${document.id}`}
                      className="block bg-gray-50 border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-indigo-300 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900 mb-2">{flashcard.question}</p>
                      <p className="text-xs text-gray-500">Click to practice this deck</p>
                    </Link>
                  ))}
                </div>
                <Link
                  to={`/flashcards/${document.id}`}
                  className="block mt-4 w-full px-4 py-2 bg-indigo-600 text-white text-center rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Practice All Cards
                </Link>
              </div>
            )}

            {activeTab === "feynman" && (
              <div>
                <h3 className="font-medium text-gray-900 mb-4">Feynman Mode</h3>
                <p className="text-sm text-gray-600 mb-6">
                  Test your understanding by teaching these concepts back to the AI.
                </p>
                <div className="space-y-3">
                  {feynmanTopics.map((concept) => (
                    <button
                      key={concept.id}
                      type="button"
                      onClick={() => setSelectedFeynmanTopic(concept.label)}
                      className={`block w-full rounded-lg border p-4 text-left transition-colors ${
                        activeFeynmanTopic === concept.label
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-gray-200 bg-gray-50 hover:border-indigo-300"
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900 mb-2">{concept.label}</p>
                      <p className="text-xs text-gray-500">Ready to teach</p>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => startFeynmanSession()}
                  className="block mt-4 w-full px-4 py-2 bg-indigo-600 text-white text-center rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Start Teaching Session
                </button>
              </div>
            )}

            {activeTab === "notes" && (
              <div>
                <h3 className="font-medium text-gray-900 mb-4">Your Notes</h3>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Take notes about this document..."
                  className="w-full h-64 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                ></textarea>
                <button
                  onClick={() => void handleSaveNotes()}
                  className="mt-4 w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  {isSavingNotes ? "Saving..." : "Save Notes"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
