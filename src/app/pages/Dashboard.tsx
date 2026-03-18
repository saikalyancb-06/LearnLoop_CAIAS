import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Upload, FolderPlus, Zap, FileText, TrendingUp, Award } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../../hooks/useAuth";
import { dashboardService } from "../../services/dashboardService";
import { documentsService } from "../../services/documentsService";
import { getDocumentTypeLabel } from "../../lib/documentDisplay";
import { isSessionCacheFresh, readSessionCache, UI_CACHE_MAX_AGE, writeSessionCache } from "../../lib/cache";

export function Dashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { user } = useAuth();
  const [search, setSearch] = useState(() => readSessionCache("dashboard.search") ?? "");
  const [recentDocuments, setRecentDocuments] = useState<any[]>(() => readSessionCache("dashboard.documents") ?? []);
  const [recentSessions, setRecentSessions] = useState<any[]>(() => readSessionCache("dashboard.sessions") ?? []);
  const [summary, setSummary] = useState(() => readSessionCache("dashboard.summary") ?? {
    documentsStudied: 0,
    averageUnderstandingScore: 0,
    completedSessions: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard(options?: { silent?: boolean }) {
    if (!user) {
      return;
    }

    if (!options?.silent) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const data = await dashboardService.getDashboardData(user.id);
      setRecentDocuments(data.documents);
      setRecentSessions(data.recentSessions);
      setSummary(data.summary);
      writeSessionCache("dashboard.documents", data.documents);
      writeSessionCache("dashboard.sessions", data.recentSessions);
      writeSessionCache("dashboard.summary", data.summary);
    } catch (dashboardError) {
      if (!options?.silent) {
        setError(
          dashboardError instanceof Error
            ? dashboardError.message
            : "Unable to load your dashboard.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (readSessionCache("dashboard.documents") && isSessionCacheFresh("dashboard.documents", UI_CACHE_MAX_AGE)) {
      setIsLoading(false);
      return;
    }

    void loadDashboard();
  }, [user]);

  const filteredDocuments = useMemo(() => {
    if (!search.trim()) {
      return recentDocuments;
    }

    return recentDocuments.filter((document) =>
      document.title.toLowerCase().includes(search.toLowerCase()),
    );
  }, [recentDocuments, search]);

  const filteredSessions = useMemo(() => {
    if (!search.trim()) {
      return recentSessions;
    }

    return recentSessions.filter((session) =>
      session.topic.toLowerCase().includes(search.toLowerCase()),
    );
  }, [recentSessions, search]);

  useEffect(() => {
    writeSessionCache("dashboard.search", search);
  }, [search]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file || !user) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const document = await documentsService.uploadDocument({
        userId: user.id,
        file,
      });

      await loadDashboard();
      navigate(`/notes/${document.id}`);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload document.",
      );
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">Welcome back! Continue your learning journey.</p>
          </div>
          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg"
              onChange={handleUploadChange}
            />
            <button
              onClick={handleUploadClick}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>{isUploading ? "Uploading..." : "Upload Document"}</span>
            </button>
            <Link
              to="/notes"
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Create Folder</span>
            </Link>
            <Link
              to={recentDocuments[0] ? `/notes/${recentDocuments[0].id}` : "/notes"}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Zap className="w-4 h-4" />
              <span>Start Learning Session</span>
            </Link>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search documents, topics, or sessions..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      <div className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-indigo-600" />
              </div>
              <span className="text-xs text-gray-500">Your Library</span>
            </div>
            <div className="text-2xl font-semibold text-gray-900 mb-1">{summary.documentsStudied}</div>
            <div className="text-sm text-gray-500">Documents Studied</div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <span className="text-xs text-gray-500">Completed</span>
            </div>
            <div className="text-2xl font-semibold text-gray-900 mb-1">{summary.completedSessions}</div>
            <div className="text-sm text-gray-500">Feynman Sessions</div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Award className="w-5 h-5 text-purple-600" />
              </div>
              <span className="text-xs text-gray-500">Average</span>
            </div>
            <div className="text-2xl font-semibold text-gray-900 mb-1">{summary.averageUnderstandingScore}%</div>
            <div className="text-sm text-gray-500">Understanding Score</div>
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Notes</h2>
            <Link to="/notes" className="text-sm text-indigo-600 hover:text-indigo-700">
              View all →
            </Link>
          </div>
          {isLoading ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
              Loading recent documents...
            </div>
          ) : filteredDocuments.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {filteredDocuments.map((note) => (
                <Link
                  key={note.id}
                  to={`/notes/${note.id}`}
                  className="bg-white border border-gray-200 rounded-xl p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-gray-600" />
                    </div>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-indigo-700">
                      {getDocumentTypeLabel(note.mime_type, note.original_filename)}
                    </span>
                  </div>
                  <h3 className="font-medium text-gray-900 mb-2 line-clamp-2">{note.title}</h3>
                  <div className="flex items-center justify-between text-sm mb-3">
                    <span className="text-gray-500">Progress</span>
                    <span className="font-medium text-indigo-600">{note.completion_percent}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                    <div
                      className="bg-indigo-600 h-2 rounded-full"
                      style={{ width: `${note.completion_percent}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500">
                    Last opened {note.last_opened_at ? new Date(note.last_opened_at).toLocaleString() : "Not yet"}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
              No matching documents yet. Upload your first study file to get started.
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recently Completed Feynman Sessions</h2>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Topic
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Score
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredSessions.length > 0 ? (
                  filteredSessions.map((session) => (
                    <tr key={session.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{session.topic}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-medium ${
                              (session.result?.overall_score ?? 0) >= 80
                                ? "text-green-600"
                                : (session.result?.overall_score ?? 0) >= 60
                                  ? "text-yellow-600"
                                  : "text-red-600"
                            }`}
                          >
                            {session.result?.overall_score ?? session.completion_percent}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(session.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link
                          to={`/notes/${session.document_id}/feynman/${session.id}/results`}
                          className="text-sm text-indigo-600 hover:text-indigo-700"
                        >
                          View Results
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                      No Feynman sessions match your search yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
