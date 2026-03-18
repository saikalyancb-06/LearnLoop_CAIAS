import { useEffect, useState } from "react";
import { ChevronLeft, TrendingUp, CheckCircle, AlertTriangle, RotateCcw, BookOpen } from "lucide-react";
import { Link, useParams } from "react-router";
import { feynmanService } from "../../services/feynmanService";
import { MarkdownText } from "../components/MarkdownText";

export function FeynmanResults() {
  const { documentId, sessionId } = useParams();
  const [result, setResult] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadResult() {
      if (!sessionId) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const [nextResult, sessionData] = await Promise.all([
          feynmanService.getResult(sessionId),
          feynmanService.getSessionWithMessages(sessionId),
        ]);

        setResult(nextResult);
        setSession(sessionData.session);
      } catch (resultError) {
        setError(
          resultError instanceof Error
            ? resultError.message
            : "Unable to load the evaluation results.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadResult();
  }, [sessionId]);

  if (isLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading evaluation results...</div>;
  }

  if (!result || !session) {
    return <div className="p-8 text-sm text-red-600">{error ?? "Result not found."}</div>;
  }

  const metrics = [
    { label: "Concept Accuracy", score: result.concept_accuracy, color: "text-green-600", bgColor: "bg-green-600" },
    { label: "Clarity", score: result.clarity, color: "text-yellow-600", bgColor: "bg-yellow-600" },
    { label: "Completeness", score: result.completeness, color: "text-yellow-600", bgColor: "bg-yellow-600" },
    { label: "Teaching Ability", score: result.teaching_ability, color: "text-green-600", bgColor: "bg-green-600" },
  ];

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={`/notes/${documentId}`} className="text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Teaching Evaluation Results</h1>
              <p className="text-sm text-gray-500">Topic: {session.topic}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-8">
        <div className="bg-white border border-gray-200 rounded-xl p-8 mb-8 text-center">
          <div className="mb-4">
            <TrendingUp className="w-12 h-12 text-indigo-600 mx-auto" />
          </div>
          <div className="mb-2">
            <div className="text-sm text-gray-500 uppercase tracking-wider mb-2">Understanding Score</div>
            <div className="text-6xl font-bold text-indigo-600">{result.overall_score}%</div>
          </div>
          <p className="text-gray-600 mt-4">
            {result.overall_score >= 80
              ? "Excellent understanding! You explained the concept very well."
              : result.overall_score >= 60
                ? "Good effort! There are a few areas to improve."
                : "Keep practicing. Review the weak concepts and try again."}
          </p>
          {result.knowledge_rating ? (
            <div className="mt-4 inline-flex rounded-full bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700">
              Knowledge Rating: {result.knowledge_rating}
            </div>
          ) : null}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Performance Breakdown</h2>
          <div className="space-y-6">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{metric.label}</span>
                  <span className={`text-sm font-semibold ${metric.color}`}>{metric.score}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className={`${metric.bgColor} h-3 rounded-full transition-all duration-500`}
                    style={{ width: `${metric.score}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <h2 className="text-lg font-semibold text-gray-900">Strengths</h2>
            </div>
            <ul className="space-y-3">
              {result.strengths.map((strength: string) => (
                <li key={strength} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-green-600 rounded-full mt-2 flex-shrink-0"></div>
                  <span className="text-sm text-gray-700">{strength}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              <h2 className="text-lg font-semibold text-gray-900">Areas for Improvement</h2>
            </div>
            <ul className="space-y-3">
              {result.improvement_points.map((improvement: string) => (
                <li key={improvement} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-orange-600 rounded-full mt-2 flex-shrink-0"></div>
                  <span className="text-sm text-gray-700">{improvement}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {Array.isArray(result.misconceptions) && result.misconceptions.length > 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Detected Misconceptions</h2>
            <ul className="space-y-3">
              {result.misconceptions.map((misconception: string) => (
                <li key={misconception} className="flex items-start gap-2">
                  <div className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-600"></div>
                  <span className="text-sm text-gray-700">{misconception}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">AI Tutor Feedback</h2>
          <div className="prose prose-sm max-w-none text-gray-700">
            <MarkdownText content={result.ai_feedback ?? ""} />
          </div>
        </div>

        <div className="flex gap-4">
          <Link
            to={`/notes/${documentId}/feynman`}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RotateCcw className="w-5 h-5" />
            <span>Retry Explanation</span>
          </Link>
          <Link
            to={`/notes/${documentId}`}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <BookOpen className="w-5 h-5" />
            <span>Review Weak Concepts</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
