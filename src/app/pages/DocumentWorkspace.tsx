import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Sparkles, Send, CreditCard, GraduationCap, FileText } from "lucide-react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../hooks/useAuth";
import { documentsService } from "../../services/documentsService";
import { flashcardsService } from "../../services/flashcardsService";
import { isSessionCacheFresh, readSessionCache, writeSessionCache } from "../../lib/cache";
import { localAiService } from "../../services/localAiService";

type ChatMessage = {
  id: string;
  role: "ai" | "user";
  content: string;
};

function buildCopilotReply(question: string, documentTitle: string, extractedText: string | null) {
  const summary = extractedText?.split("\n").slice(0, 2).join(" ") ?? "";
  const normalizedQuestion = question.toLowerCase();

  if (normalizedQuestion.includes("example")) {
    return `A practical example from ${documentTitle}: connect the concept to one everyday situation, then explain how the document's main idea applies. ${summary}`;
  }

  if (normalizedQuestion.includes("simple")) {
    return `${documentTitle} in simple terms: start with the core idea, explain why it matters, and then use one short example. ${summary}`;
  }

  return `Based on ${documentTitle}, focus on the main concepts captured in the document summary and sections. ${summary}`;
}

export function DocumentWorkspace() {
  const { documentId } = useParams();
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
                content:
                  (nextDocument.metadata?.summary as string | undefined) ??
                  `I analyzed ${nextDocument.title}. Ask me anything about the key ideas.`,
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
      isSessionCacheFresh(`workspace.${documentId}.document`, 1000 * 60 * 3) &&
      isSessionCacheFresh(`workspace.${documentId}.flashcards`, 1000 * 60 * 3)
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

  const concepts = useMemo(() => {
    const rawConcepts = document?.metadata?.concepts;

    if (Array.isArray(rawConcepts) && rawConcepts.length > 0) {
      return rawConcepts as { id: string; label: string; x: number; y: number }[];
    }

    return [
      { id: "1", label: document?.title ?? "Concept", x: 50, y: 20 },
      { id: "2", label: "Overview", x: 30, y: 50 },
      { id: "3", label: "Examples", x: 70, y: 50 },
      { id: "4", label: "Review", x: 50, y: 80 },
    ];
  }, [document]);

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
          <div className="mb-4">
            <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wider mb-1">
              Concept Mind Map
            </h2>
            <p className="text-sm text-gray-500">AI-generated concept visualization</p>
          </div>

          <div className="relative bg-gray-50 rounded-xl border border-gray-200 h-96">
            {concepts.map((concept) => (
              <div
                key={concept.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${concept.x}%`, top: `${concept.y}%` }}
              >
                <button className="bg-white border-2 border-indigo-600 rounded-lg px-4 py-2 text-sm font-medium text-gray-900 hover:bg-indigo-50 shadow-sm transition-colors">
                  {concept.label}
                </button>
              </div>
            ))}

            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {concepts.slice(1).map((concept) => (
                <line
                  key={concept.id}
                  x1="50%"
                  y1="20%"
                  x2={`${concept.x}%`}
                  y2={`${concept.y}%`}
                  stroke="#4F46E5"
                  strokeWidth="2"
                />
              ))}
            </svg>
          </div>

          <div className="mt-4 space-y-3">
            {document.sections.map((section: any) => (
              <div key={section.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-sm font-medium text-gray-900">{section.title}</div>
                <div className="mt-2 text-sm text-gray-500">{section.content}</div>
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
                  {message.content}
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
                  {concepts.slice(0, 3).map((concept) => (
                    <div key={concept.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-gray-900 mb-2">{concept.label}</p>
                      <p className="text-xs text-gray-500">Ready to teach</p>
                    </div>
                  ))}
                </div>
                <Link
                  to={`/notes/${document.id}/feynman`}
                  className="block mt-4 w-full px-4 py-2 bg-indigo-600 text-white text-center rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Start Teaching Session
                </Link>
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
