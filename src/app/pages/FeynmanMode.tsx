import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Send, Mic, Volume2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../hooks/useAuth";
import { documentsService } from "../../services/documentsService";
import { feynmanService } from "../../services/feynmanService";
import { isSessionCacheFresh, readSessionCache, writeSessionCache } from "../../lib/cache";

export function FeynmanMode() {
  const navigate = useNavigate();
  const { documentId } = useParams();
  const { user } = useAuth();
  const [userInput, setUserInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [document, setDocument] = useState<any | null>(() =>
    readSessionCache(`feynman.${documentId}.document`),
  );
  const [session, setSession] = useState<any | null>(() =>
    readSessionCache(`feynman.${documentId}.session`),
  );
  const [conversation, setConversation] = useState<any[]>(() =>
    readSessionCache(`feynman.${documentId}.conversation`) ?? [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!documentId) {
      return;
    }

    writeSessionCache(`feynman.${documentId}.document`, document);
    writeSessionCache(`feynman.${documentId}.session`, session);
    writeSessionCache(`feynman.${documentId}.conversation`, conversation);
  }, [conversation, document, documentId, session]);

  useEffect(() => {
    async function loadSession() {
      if (!documentId || !user) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextDocument = await documentsService.getDocument(documentId);
        const rawConcepts = Array.isArray(nextDocument.metadata?.concepts)
          ? nextDocument.metadata.concepts
          : [];
        const topic = rawConcepts[0]?.label ?? nextDocument.title;
        const nextSession = await feynmanService.getOrCreateSession({
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
        setSession(sessionData.session);
        setConversation(sessionData.messages);
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

    if (
      documentId &&
      readSessionCache(`feynman.${documentId}.document`) &&
      readSessionCache(`feynman.${documentId}.session`) &&
      isSessionCacheFresh(`feynman.${documentId}.document`, 1000 * 60 * 3) &&
      isSessionCacheFresh(`feynman.${documentId}.session`, 1000 * 60 * 3) &&
      isSessionCacheFresh(`feynman.${documentId}.conversation`, 1000 * 60 * 3)
    ) {
      setIsLoading(false);
      return;
    }

    void loadSession();
  }, [documentId, user]);

  const currentTopic = useMemo(() => session?.topic ?? document?.title ?? "Study Topic", [document, session]);
  const userResponses = conversation.filter((message) => message.role === "user").length;
  const progressPercent = session?.completion_percent ?? 0;

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conversation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session || !document || !userInput.trim()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await feynmanService.submitExplanation({
        sessionId: session.id,
        topic: session.topic,
        extractedText: document.extracted_text,
        explanation: userInput.trim(),
      });

      const nextData = await feynmanService.getSessionWithMessages(session.id);
      setSession(nextData.session);
      setConversation(nextData.messages);
      setUserInput("");
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
    if (!session || !document || !user) {
      return;
    }

    try {
      await feynmanService.completeSession({
        sessionId: session.id,
        userId: user.id,
        documentId: document.id,
      });
      navigate(`/notes/${document.id}/feynman/${session.id}/results`);
    } catch (completeError) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : "Unable to complete the session.",
      );
    }
  };

  const toggleRecording = () => {
    setIsRecording((currentValue) => !currentValue);
  };

  if (isLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading teaching session...</div>;
  }

  if (!document || !session) {
    return <div className="p-8 text-sm text-red-600">{error ?? "Unable to load the session."}</div>;
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={`/notes/${document.id}`} className="text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Feynman Teaching Session</h1>
              <p className="text-sm text-gray-500">Explain concepts in your own words</p>
            </div>
          </div>
          <button
            onClick={() => void handleComplete()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Complete Session
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-8">
        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500 mb-1">Current Topic</div>
              <div className="text-2xl font-semibold text-gray-900">{currentTopic}</div>
            </div>
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">🧠</span>
            </div>
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
            {conversation.map((message) => (
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
                  <Mic className="w-5 h-5" />
                  <span>{isRecording ? "Recording..." : "Voice Explanation"}</span>
                </button>

                <button
                  type="submit"
                  disabled={!userInput.trim() || isSubmitting}
                  className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{isSubmitting ? "Sending..." : "Send Explanation"}</span>
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-gray-700">Session Progress</div>
            <div className="text-sm text-gray-500">{userResponses} answers submitted</div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `${progressPercent}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}
