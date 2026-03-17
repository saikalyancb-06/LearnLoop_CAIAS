import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Mic, Volume2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../hooks/useAuth";
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

function deriveFeynmanTopic(document: any) {
  const summary = typeof document?.metadata?.summary === "string" ? document.metadata.summary.trim() : "";
  const extractedText = typeof document?.extracted_text === "string" ? document.extracted_text.trim() : "";
  const firstSentence =
    summary.split(/(?<=[.!?])\s+/).find(Boolean) ??
    extractedText.split(/(?<=[.!?])\s+/).find(Boolean) ??
    "";
  const normalized = firstSentence.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Core ideas from the uploaded document";
  }

  return normalized.slice(0, 140);
}

export function FeynmanMode() {
  const navigate = useNavigate();
  const { documentId } = useParams();
  const { user } = useAuth();
  const [userInput, setUserInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [document, setDocument] = useState<any | null>(null);
  const [currentSession, setCurrentSession] = useState<any | null>(null);
  const [currentConversation, setCurrentConversation] = useState<any[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionSummary[]>([]);
  const [selectedHistorySession, setSelectedHistorySession] = useState<any | null>(null);
  const [selectedHistoryConversation, setSelectedHistoryConversation] = useState<any[]>([]);
  const [selectedHistoryResult, setSelectedHistoryResult] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

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

      setIsLoading(true);
      setError(null);
      setSelectedHistorySession(null);
      setSelectedHistoryConversation([]);
      setSelectedHistoryResult(null);

      try {
        const nextDocument = await documentsService.getDocument(documentId);
        const topic = deriveFeynmanTopic(nextDocument);
        const nextSession = await feynmanService.createSession({
          documentId,
          userId: user.id,
          topic,
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
  }, [documentId, user]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visibleConversation, isViewingHistory]);

  const currentTopic = useMemo(
    () => visibleSession?.topic ?? document?.title ?? "Study Topic",
    [document, visibleSession],
  );
  const progressPercent = visibleSession?.completion_percent ?? 0;

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

  const toggleRecording = () => {
    setIsRecording((currentValue) => !currentValue);
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
                  <div className="text-2xl font-semibold text-gray-900">{currentTopic}</div>
                </div>
                <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center">
                  <span className="text-2xl">🧠</span>
                </div>
              </div>
              <div className="mt-4 text-sm text-gray-500">
                Progress: {progressPercent}% {isViewingHistory ? "recorded" : "complete"}
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
                        <p className="text-sm leading-relaxed">{message.content}</p>
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
                        Score: {selectedHistoryResult.overall_score}%.
                        {selectedHistoryResult.ai_feedback ? ` ${selectedHistoryResult.ai_feedback}` : ""}
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
                        className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
                          isRecording
                            ? "border-red-300 bg-red-50 text-red-700"
                            : "border-gray-300 hover:bg-gray-100 text-gray-700"
                        }`}
                      >
                        <Mic className="w-4 h-4" />
                        <span>Voice Explanation</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSubmitting || !userInput.trim()}
                        className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSubmitting ? "Sending..." : "Send Explanation"}
                      </button>
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
                  <button
                    key={historySession.id}
                    onClick={() => void handleViewSession(historySession.id)}
                    className={`w-full text-left rounded-lg border px-3 py-3 transition-colors ${
                      isSelected
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-gray-200 hover:border-indigo-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900 truncate">{historySession.topic}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {new Date(historySession.created_at).toLocaleString()}
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
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
