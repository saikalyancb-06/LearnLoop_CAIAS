import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Mic, Trash2, Volume2 } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../../hooks/useAuth";
import { isSessionCacheFresh, readSessionCache, removeSessionCache, UI_CACHE_MAX_AGE, writeSessionCache } from "../../lib/cache";
import { MarkdownText } from "../components/MarkdownText";
import { documentsService } from "../../services/documentsService";
import { feynmanService } from "../../services/feynmanService";

type SessionSummary = {
  id: string;
  topic: string;
  status: string;
  completion_percent: number;
  created_at: string;
  overall_score: number | null;
};

type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isCodeLikeText(value: string) {
  const text = normalizeWhitespace(value);

  if (!text) {
    return false;
  }

  const hintCount = [
    /#include|#define/i,
    /\b(int|void|return|struct|class|switch|case|printf|scanf|malloc|free)\b/i,
    /\bmain\s*\(/i,
    /\{/, /\}/,
    /;\s*/,
  ].filter((pattern) => pattern.test(text)).length;

  return hintCount >= 3;
}

function looksLikeFlattenedCode(content: string) {
  const lineCount = content.split("\n").length;
  const semicolonCount = (content.match(/;/g) ?? []).length;
  return isCodeLikeText(content) && lineCount <= 2 && semicolonCount >= 3;
}

function inferCodeLanguage(content: string) {
  if (/#include|printf|scanf|malloc|\bstruct\b/i.test(content)) {
    return "c";
  }

  if (/\b(const|let|function|return)\b|=>/.test(content)) {
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

      const output = `${"  ".repeat(indentLevel)}${line}`;

      if (line.endsWith("{")) {
        indentLevel += 1;
      }

      return output;
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
          content: formatFlattenedCode(content),
          language: inferCodeLanguage(content),
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

  return parts.length > 0 ? parts : [{ type: "text", content }];
}

function extractCodeTargets(text: string) {
  const candidates =
    text.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g)?.map((match) => match.replace(/\($/, "").trim()) ?? [];

  const blacklist = new Set([
    "if",
    "for",
    "while",
    "switch",
    "return",
    "sizeof",
    "main",
  ]);

  return [...new Set(candidates.map((value) => value.toLowerCase()))]
    .filter((name) => !blacklist.has(name))
    .slice(0, 3);
}

function toDisplayTopic(value: string) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return "Study Topic";
  }

  if (looksLikeFlattenedCode(normalized)) {
    return formatFlattenedCode(normalized).split("\n").slice(0, 8).join("\n");
  }

  return normalized.length > 170 ? `${normalized.slice(0, 170).trimEnd()}...` : normalized;
}

function toSessionLabel(value: string) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return "Untitled session";
  }

  if (isCodeLikeText(normalized)) {
    return "Code walkthrough session";
  }

  return normalized.length > 90 ? `${normalized.slice(0, 90).trimEnd()}...` : normalized;
}

function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") {
    return null;
  }

  const scope = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };

  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function deriveFeynmanTopic(document: any) {
  const title = typeof document?.title === "string" ? normalizeWhitespace(document.title) : "uploaded document";
  const summary =
    typeof document?.metadata?.summary === "string" ? normalizeWhitespace(document.metadata.summary) : "";
  const extractedText =
    typeof document?.extracted_text === "string" ? normalizeWhitespace(document.extracted_text) : "";
  const conceptLabels = Array.isArray(document?.metadata?.concepts)
    ? document.metadata.concepts
        .map((concept: any) => (typeof concept?.label === "string" ? normalizeWhitespace(concept.label) : ""))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  if (isCodeLikeText(summary) || isCodeLikeText(extractedText)) {
    const targets = extractCodeTargets(extractedText || summary);

    if (targets.length > 0) {
      return `Explain how ${targets.join(", ")} work together in ${title}`;
    }

    return `Explain the core logic and control flow in ${title}`;
  }

  const firstSummarySentence = summary.split(/(?<=[.!?])\s+/).find(Boolean) ?? "";

  if (firstSummarySentence && !isCodeLikeText(firstSummarySentence)) {
    return toDisplayTopic(firstSummarySentence);
  }

  if (conceptLabels.length > 0) {
    return `Teach these key ideas from ${title}: ${conceptLabels.join(", ")}`;
  }

  const extractedSentence = extractedText.split(/(?<=[.!?])\s+/).find(Boolean) ?? "";

  if (extractedSentence && !isCodeLikeText(extractedSentence)) {
    return toDisplayTopic(extractedSentence);
  }

  return `Core ideas from ${title}`;
}

export function FeynmanMode() {
  const navigate = useNavigate();
  const { documentId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const requestedTopic = normalizeWhitespace(searchParams.get("topic") ?? "");
  const topicCacheSegment = requestedTopic ? encodeURIComponent(requestedTopic.toLowerCase()) : "auto";
  const sessionCacheKey = documentId ? `feynman.${documentId}.${topicCacheSegment}.session` : null;
  const conversationCacheKey = documentId ? `feynman.${documentId}.${topicCacheSegment}.conversation` : null;
  const documentCacheKey = documentId ? `feynman.${documentId}.${topicCacheSegment}.document` : null;
  const historyCacheKey = documentId ? `feynman.${documentId}.${topicCacheSegment}.history` : null;
  const inputCacheKey = documentId ? `feynman.${documentId}.${topicCacheSegment}.input` : null;
  const [userInput, setUserInput] = useState(() => (inputCacheKey ? readSessionCache(inputCacheKey) ?? "" : ""));
  const [isRecording, setIsRecording] = useState(false);
  const [document, setDocument] = useState<any | null>(() => (documentCacheKey ? readSessionCache(documentCacheKey) : null));
  const [currentSession, setCurrentSession] = useState<any | null>(() => (sessionCacheKey ? readSessionCache(sessionCacheKey) : null));
  const [currentConversation, setCurrentConversation] = useState<any[]>(() => (conversationCacheKey ? readSessionCache(conversationCacheKey) ?? [] : []));
  const [sessionHistory, setSessionHistory] = useState<SessionSummary[]>(() => (historyCacheKey ? readSessionCache(historyCacheKey) ?? [] : []));
  const [selectedHistorySession, setSelectedHistorySession] = useState<any | null>(null);
  const [selectedHistoryConversation, setSelectedHistoryConversation] = useState<any[]>([]);
  const [selectedHistoryResult, setSelectedHistoryResult] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isVoiceSupported, setIsVoiceSupported] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);

  const isViewingHistory = Boolean(selectedHistorySession);
  const visibleSession = selectedHistorySession ?? currentSession;
  const visibleConversation = selectedHistorySession ? selectedHistoryConversation : currentConversation;

  async function refreshHistory(activeSessionId?: string) {
    if (!documentId || !user) {
      return;
    }

    const sessions = await feynmanService.listSessions({
      documentId,
      userId: user.id,
    });

    setSessionHistory(
      sessions.filter((session) => session.id !== activeSessionId),
    );
  }

  useEffect(() => {
    async function loadFreshSession() {
      if (!documentId || !user) {
        return;
      }

      if (
        sessionCacheKey &&
        conversationCacheKey &&
        documentCacheKey &&
        historyCacheKey &&
        readSessionCache(sessionCacheKey) &&
        readSessionCache(documentCacheKey) &&
        isSessionCacheFresh(sessionCacheKey, UI_CACHE_MAX_AGE) &&
        isSessionCacheFresh(conversationCacheKey, UI_CACHE_MAX_AGE) &&
        isSessionCacheFresh(documentCacheKey, UI_CACHE_MAX_AGE)
      ) {
        const cachedSession = readSessionCache<any>(sessionCacheKey);

        if (cachedSession?.status === "active") {
          setCurrentSession(cachedSession);
          setCurrentConversation(readSessionCache(conversationCacheKey) ?? []);
          setDocument(readSessionCache(documentCacheKey));
          setSessionHistory(readSessionCache(historyCacheKey) ?? []);
          setIsLoading(false);
          setError(null);
          return;
        }

        removeSessionCache(sessionCacheKey);
        removeSessionCache(conversationCacheKey);
        removeSessionCache(documentCacheKey);
        removeSessionCache(historyCacheKey);
        if (inputCacheKey) {
          removeSessionCache(inputCacheKey);
        }
      }

      setIsLoading(true);
      setError(null);
      setSelectedHistorySession(null);
      setSelectedHistoryConversation([]);
      setSelectedHistoryResult(null);

      try {
        const nextDocument = await documentsService.getDocument(documentId);
        const topic = requestedTopic || deriveFeynmanTopic(nextDocument);
        const nextSession = await feynmanService.createSession({
          documentId,
          userId: user.id,
          topic,
          extractedText: nextDocument.extracted_text,
        });

        await feynmanService.ensureStarterMessage({
          sessionId: nextSession.id,
          topic,
          extractedText: nextDocument.extracted_text,
        });

        const sessionData = await feynmanService.getSessionWithMessages(nextSession.id);
        setDocument(nextDocument);
        setCurrentSession(sessionData.session);
        setCurrentConversation(sessionData.messages);
        setUserInput("");
        await refreshHistory(nextSession.id);
      } catch (sessionError) {
        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "Unable to start the Feynman session.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadFreshSession();
  }, [conversationCacheKey, documentCacheKey, documentId, historyCacheKey, inputCacheKey, requestedTopic, sessionCacheKey, user]);

  useEffect(() => {
    if (!documentId || !sessionCacheKey || !conversationCacheKey || !documentCacheKey || !historyCacheKey || !inputCacheKey) {
      return;
    }

    writeSessionCache(sessionCacheKey, currentSession);
    writeSessionCache(conversationCacheKey, currentConversation);
    writeSessionCache(documentCacheKey, document);
    writeSessionCache(historyCacheKey, sessionHistory);
    writeSessionCache(inputCacheKey, userInput);
  }, [
    conversationCacheKey,
    currentConversation,
    currentSession,
    document,
    documentId,
    documentCacheKey,
    historyCacheKey,
    inputCacheKey,
    sessionCacheKey,
    sessionHistory,
    userInput,
  ]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visibleConversation, isViewingHistory]);

  useEffect(() => {
    setIsVoiceSupported(Boolean(getSpeechRecognitionCtor()));

    return () => {
      stopRequestedRef.current = true;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const updateElapsed = () => {
      if (!recordingStartedAtRef.current) {
        return;
      }

      setRecordingSeconds(
        Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
      );
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isRecording]);

  const currentTopic = useMemo(
    () => visibleSession?.topic ?? document?.title ?? "Study Topic",
    [document, visibleSession],
  );
  const topicLooksLikeCode = useMemo(() => isCodeLikeText(currentTopic), [currentTopic]);
  const displayTopic = useMemo(() => toDisplayTopic(currentTopic), [currentTopic]);
  const progressPercent = visibleSession?.completion_percent ?? 0;
  const targetQuestionCount = visibleSession?.target_question_count ?? 0;
  const answeredQuestionCount = visibleSession?.current_question_count ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentSession || !document || !userInput.trim() || isViewingHistory) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await feynmanService.submitExplanation({
        sessionId: currentSession.id,
        topic: currentSession.topic,
        extractedText: document.extracted_text,
        explanation: userInput.trim(),
      });

      const nextData = await feynmanService.getSessionWithMessages(currentSession.id);
      setCurrentSession(nextData.session);
      setCurrentConversation(nextData.messages);
      setUserInput("");
      await refreshHistory(currentSession.id);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to send your explanation.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleComplete = async () => {
    if (!currentSession || !document || !user || isViewingHistory) {
      return;
    }

    try {
      await feynmanService.completeSession({
        sessionId: currentSession.id,
        userId: user.id,
        documentId: document.id,
      });
      if (sessionCacheKey) {
        removeSessionCache(sessionCacheKey);
      }
      if (conversationCacheKey) {
        removeSessionCache(conversationCacheKey);
      }
      if (documentCacheKey) {
        removeSessionCache(documentCacheKey);
      }
      if (historyCacheKey) {
        removeSessionCache(historyCacheKey);
      }
      if (inputCacheKey) {
        removeSessionCache(inputCacheKey);
      }
      removeSessionCache("dashboard.documents");
      removeSessionCache("dashboard.sessions");
      removeSessionCache("dashboard.summary");
      navigate(`/notes/${document.id}/feynman/${currentSession.id}/results`);
    } catch (completeError) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : "Unable to complete the session.",
      );
    }
  };

  const handleViewSession = async (sessionId: string) => {
    setIsLoadingHistory(true);
    setError(null);

    try {
      const sessionData = await feynmanService.getSessionWithMessages(sessionId);
      const nextResult =
        sessionData.session.status === "completed"
          ? await feynmanService.getResult(sessionId).catch(() => null)
          : null;

      setSelectedHistorySession(sessionData.session);
      setSelectedHistoryConversation(sessionData.messages);
      setSelectedHistoryResult(nextResult);
    } catch (historyError) {
      setError(
        historyError instanceof Error
          ? historyError.message
          : "Unable to load the previous session.",
      );
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleReturnToCurrent = () => {
    setSelectedHistorySession(null);
    setSelectedHistoryConversation([]);
    setSelectedHistoryResult(null);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!documentId || !user) {
      return;
    }

    setDeletingSessionId(sessionId);
    setError(null);

    try {
      await feynmanService.deleteSession(sessionId);

      if (selectedHistorySession?.id === sessionId) {
        handleReturnToCurrent();
      }

      await refreshHistory(currentSession?.id);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete the previous session.",
      );
    } finally {
      setDeletingSessionId(null);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRequestedRef.current = true;
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionCtor();

    if (!SpeechRecognitionCtor) {
      setError("Voice explanation is not supported in this browser. Use Chrome or Edge.");
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let finalText = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript ?? "";

          if (result?.isFinal) {
            finalText += transcript;
          }
        }

        if (finalText.trim()) {
          setUserInput((currentValue) => {
            const prefix = currentValue && !currentValue.endsWith(" ") ? " " : "";
            return `${currentValue}${prefix}${finalText.trim()}`.trimStart();
          });
        }
      };

      recognition.onerror = (event: any) => {
        const code = String(event?.error ?? "");

        if (code === "not-allowed" || code === "service-not-allowed") {
          setError("Microphone permission is blocked. Please allow microphone access and try again.");
        } else if (code === "no-speech") {
          setError("No speech detected. Try speaking clearly and a little closer to the microphone.");
        } else {
          setError("Voice explanation failed. Please try again.");
        }

        setIsRecording(false);
        recordingStartedAtRef.current = null;
        setRecordingSeconds(0);
      };

      recognition.onend = () => {
        setIsRecording(false);
        stopRequestedRef.current = false;
        recordingStartedAtRef.current = null;
        setRecordingSeconds(0);
      };

      recognitionRef.current = recognition;
    }

    try {
      setError(null);
      stopRequestedRef.current = false;
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      recognitionRef.current.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
      recordingStartedAtRef.current = null;
      setRecordingSeconds(0);
      setError("Unable to start voice explanation. Please try again.");
    }
  };

  if (isLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading teaching session...</div>;
  }

  if (!document || !currentSession) {
    return <div className="p-8 text-sm text-red-600">{error ?? "Unable to load the session."}</div>;
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to={`/notes/${document.id}`} className="text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Feynman Teaching Session</h1>
              <p className="text-sm text-gray-500">
                {isViewingHistory ? "Viewing a previous read-only session" : "Fresh session ready for a new explanation"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isViewingHistory ? (
              <button
                onClick={handleReturnToCurrent}
                className="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Return To Current Session
              </button>
            ) : (
              <button
                onClick={() => void handleComplete()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Complete Session
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-8">
        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem] gap-6">
          <div className="min-w-0">
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-500 mb-1">
                    {isViewingHistory ? "Session Topic" : "Current Topic"}
                  </div>
                  {topicLooksLikeCode ? (
                    <div className="mt-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
                      <div className="border-b border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                        code focus
                      </div>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-slate-100">
                        <code>{displayTopic}</code>
                      </pre>
                    </div>
                  ) : (
                    <div className="text-2xl font-semibold text-gray-900">{displayTopic}</div>
                  )}
                </div>
                <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center">
                  <span className="text-2xl">🧠</span>
                </div>
              </div>
              <div className="mt-4 text-sm text-gray-500">
                Progress: {progressPercent}% {isViewingHistory ? "recorded" : "complete"}
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {answeredQuestionCount} / {targetQuestionCount || "?"} planned questions answered
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-start gap-3">
              <div className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5">
                <Volume2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-blue-900">
                  <strong>Tip:</strong> Explain the concept as if you're teaching someone who has never heard of it before.
                  Use simple language and examples from everyday life.
                </p>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6 h-[34rem] flex flex-col">
              <div ref={messagesRef} className="p-6 space-y-6 overflow-auto flex-1">
                {visibleConversation.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div className="flex items-start gap-3 max-w-2xl">
                      {message.role === "ai" && (
                        <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-sm">🤖</span>
                        </div>
                      )}
                      <div
                        className={`flex-1 rounded-lg px-4 py-3 ${
                          message.role === "user"
                            ? "bg-indigo-600 text-white"
                            : "bg-gray-50 border border-gray-200 text-gray-900"
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
                      {message.role === "user" && (
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-sm">👤</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-200 p-6 bg-gray-50">
                {isViewingHistory ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                      This previous session is read-only.
                    </div>
                    {selectedHistoryResult ? (
                      <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                        <div className="mb-2 font-medium">Score: {selectedHistoryResult.overall_score}%</div>
                        {selectedHistoryResult.ai_feedback ? (
                          <MarkdownText content={selectedHistoryResult.ai_feedback} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Your Explanation
                      </label>
                      <textarea
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        placeholder="Type your explanation here..."
                        rows={4}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                      ></textarea>
                    </div>

                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={toggleRecording}
                        disabled={!isVoiceSupported}
                        className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
                          isRecording
                            ? "border-red-300 bg-red-50 text-red-700"
                            : "border-gray-300 hover:bg-gray-100 text-gray-700"
                        }`}
                      >
                        <Mic className="w-4 h-4" />
                        <span>
                          {!isVoiceSupported
                            ? "Voice Unavailable"
                            : isRecording
                              ? "Stop Recording"
                              : "Voice Explanation"}
                        </span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSubmitting || !userInput.trim()}
                        className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSubmitting ? "Sending..." : "Send Explanation"}
                      </button>
                    </div>

                    {isRecording ? (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
                        Recording
                        <span className="font-mono">{formatDuration(recordingSeconds)}</span>
                      </div>
                    ) : null}

                    <div className="text-xs text-gray-500">
                      {isVoiceSupported
                        ? isRecording
                          ? "Listening... speak naturally and your words will be added to the explanation box."
                          : "Tip: click Voice Explanation to dictate your response."
                        : "Voice input requires a browser with Speech Recognition support (Chrome/Edge)."}
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>

          <aside className="bg-white border border-gray-200 rounded-xl p-4 h-fit">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Previous Sessions</h2>
              <p className="text-xs text-gray-500 mt-1">Stored for read-only review.</p>
            </div>

            <div className="space-y-3 max-h-[38rem] overflow-auto">
              {isLoadingHistory ? (
                <div className="text-sm text-gray-500">Loading session...</div>
              ) : null}

              {sessionHistory.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                  No previous sessions yet.
                </div>
              ) : null}

              {sessionHistory.map((historySession) => {
                const isSelected = selectedHistorySession?.id === historySession.id;

                return (
                  <div
                    key={historySession.id}
                    className={`w-full rounded-lg border px-3 py-3 transition-colors ${
                      isSelected
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-gray-200 hover:border-indigo-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => void handleViewSession(historySession.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="text-sm font-medium text-gray-900 truncate">{toSessionLabel(historySession.topic)}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {new Date(historySession.created_at).toLocaleString()}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSession(historySession.id)}
                        disabled={deletingSessionId === historySession.id}
                        className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Delete previous session"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600 capitalize">
                        {historySession.status}
                      </span>
                      <span className="text-gray-500">
                        {historySession.overall_score !== null
                          ? `${historySession.overall_score}%`
                          : `${historySession.completion_percent}%`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
