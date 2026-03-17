import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, ThumbsUp, AlertCircle } from "lucide-react";
import { Link, useParams } from "react-router";
import { flashcardsService } from "../../services/flashcardsService";
import { useAuth } from "../../hooks/useAuth";
import { documentsService } from "../../services/documentsService";

export function FlashcardsPage() {
  const { deckId } = useParams();
  const { user } = useAuth();
  const [currentCard, setCurrentCard] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [flashcards, setFlashcards] = useState<any[]>([]);
  const [document, setDocument] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadFlashcards() {
      if (!user) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        let documentId = deckId ?? null;

        if (!documentId) {
          const documents = await documentsService.listDocuments({ userId: user.id });
          documentId = documents[0]?.id ?? null;
        }

        if (!documentId) {
          setFlashcards([]);
          setDocument(null);
          return;
        }

        const [nextDocument, nextFlashcards] = await Promise.all([
          documentsService.getDocument(documentId),
          flashcardsService.getFlashcards(documentId),
        ]);

        setDocument(nextDocument);
        setFlashcards(nextFlashcards);
        setCurrentCard(0);
      } catch (flashcardError) {
        setError(
          flashcardError instanceof Error
            ? flashcardError.message
            : "Unable to load flashcards.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadFlashcards();
  }, [deckId, user]);

  const totalCards = flashcards.length;
  const activeCard = flashcards[currentCard];

  const stats = useMemo(() => {
    return {
      known: flashcards.filter((card) => card.status === "known").length,
      difficult: flashcards.filter((card) => card.status === "difficult").length,
      remaining: flashcards.filter((card) => card.status === "unseen").length,
    };
  }, [flashcards]);

  const handleFlip = () => {
    setIsFlipped((currentValue) => !currentValue);
  };

  const handleNext = () => {
    setIsFlipped(false);
    setCurrentCard((prev) => Math.min(prev + 1, totalCards - 1));
  };

  const handlePrevious = () => {
    setIsFlipped(false);
    setCurrentCard((prev) => Math.max(prev - 1, 0));
  };

  const handleMark = async (status: "known" | "difficult") => {
    if (!activeCard || !document) {
      return;
    }

    await flashcardsService.updateFlashcardStatus({
      flashcardId: activeCard.id,
      documentId: document.id,
      status,
    });

    const refreshedCards = await flashcardsService.getFlashcards(document.id);
    setFlashcards(refreshedCards);
    handleNext();
  };

  if (isLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading flashcards...</div>;
  }

  if (!document || !activeCard) {
    return <div className="p-8 text-sm text-gray-500">{error ?? "No flashcards available yet."}</div>;
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
              <h1 className="text-lg font-semibold text-gray-900">{document.title} Flashcards</h1>
              <p className="text-sm text-gray-500">Review key concepts</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">
              Card <span className="font-medium text-gray-900">{currentCard + 1}</span> /{" "}
              <span className="font-medium text-gray-900">{totalCards}</span>
            </div>
            <button
              onClick={() => {
                setCurrentCard(0);
                setIsFlipped(false);
              }}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 min-h-[calc(100vh-200px)]">
        <div className="w-full max-w-3xl">
          <div className="mb-8">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${((currentCard + 1) / totalCards) * 100}%` }}
              ></div>
            </div>
          </div>

          <div
            onClick={handleFlip}
            className="bg-white rounded-2xl shadow-lg border-2 border-gray-200 p-12 min-h-96 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-300 transition-all duration-300"
          >
            <div className="text-center">
              <div className="mb-6">
                <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded-full">
                  {isFlipped ? "Answer" : "Question"}
                </span>
              </div>

              <div className="text-xl text-gray-900 leading-relaxed max-w-2xl">
                {isFlipped ? activeCard.answer : activeCard.question}
              </div>

              {!isFlipped && <p className="mt-8 text-sm text-gray-500">Click card to reveal answer</p>}
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={handlePrevious}
              disabled={currentCard === 0}
              className="flex items-center gap-2 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
              <span>Previous</span>
            </button>

            {isFlipped && (
              <div className="flex gap-3">
                <button
                  onClick={() => void handleMark("difficult")}
                  className="flex items-center gap-2 px-6 py-3 border border-orange-300 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 transition-colors"
                >
                  <AlertCircle className="w-5 h-5" />
                  <span>Mark Difficult</span>
                </button>
                <button
                  onClick={() => void handleMark("known")}
                  className="flex items-center gap-2 px-6 py-3 border border-green-300 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                >
                  <ThumbsUp className="w-5 h-5" />
                  <span>Mark Known</span>
                </button>
              </div>
            )}

            <button
              onClick={handleNext}
              disabled={currentCard === totalCards - 1}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Next</span>
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-semibold text-green-600 mb-1">{stats.known}</div>
              <div className="text-sm text-gray-600">Known</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-semibold text-orange-600 mb-1">{stats.difficult}</div>
              <div className="text-sm text-gray-600">Difficult</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-semibold text-gray-600 mb-1">{stats.remaining}</div>
              <div className="text-sm text-gray-600">Remaining</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
