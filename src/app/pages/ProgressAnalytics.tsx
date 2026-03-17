import { useEffect, useState } from "react";
import { TrendingUp, Award, Clock, Target } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { analyticsService } from "../../services/analyticsService";
import { useAuth } from "../../hooks/useAuth";

export function ProgressAnalytics() {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState({
    topicMastery: [] as any[],
    studyTimeData: [] as any[],
    masteryProgressData: [] as any[],
    recentSessions: [] as any[],
    summary: {
      averageMasteryScore: 0,
      growthThisMonth: 0,
      totalStudyHours: 0,
      sessionsCompleted: 0,
    },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAnalytics() {
      if (!user) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextAnalytics = await analyticsService.getAnalytics(user.id);
        setAnalytics(nextAnalytics);
      } catch (analyticsError) {
        setError(
          analyticsError instanceof Error
            ? analyticsError.message
            : "Unable to load analytics.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadAnalytics();
  }, [user]);

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Progress Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Track your learning journey and growth</p>
        </div>
      </div>

      <div className="p-8">
        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <Target className="w-5 h-5 text-indigo-600" />
              </div>
            </div>
            <div className="text-2xl font-semibold text-gray-900 mb-1">{analytics.summary.averageMasteryScore}%</div>
            <div className="text-sm text-gray-500">Avg. Mastery Score</div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
            </div>
            <div className="text-2xl font-semibold text-gray-900 mb-1">+{analytics.summary.growthThisMonth}%</div>
            <div className="text-sm text-gray-500">Growth This Month</div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-purple-600" />
              </div>
            </div>
            <div className="text-2xl font-semibold text-gray-900 mb-1">{analytics.summary.totalStudyHours}h</div>
            <div className="text-sm text-gray-500">Total Study Time</div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <Award className="w-5 h-5 text-orange-600" />
              </div>
            </div>
            <div className="text-2xl font-semibold text-gray-900 mb-1">{analytics.summary.sessionsCompleted}</div>
            <div className="text-sm text-gray-500">Sessions Completed</div>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
            Loading analytics...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-white border border-gray-200 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Topic Mastery</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.topicMastery}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="topic" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="score" fill="#4F46E5" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Weekly Study Time</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.studyTimeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="minutes" fill="#10B981" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Mastery Improvement Over Time</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={analytics.masteryProgressData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="#4F46E5" strokeWidth={3} dot={{ fill: "#4F46E5", r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Recent Learning Sessions</h2>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Topic
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {analytics.recentSessions.length > 0 ? (
                    analytics.recentSessions.map((session) => (
                      <tr key={session.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">{session.topic}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
                            {session.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              session.score >= 80
                                ? "text-green-600"
                                : session.score >= 60
                                  ? "text-yellow-600"
                                  : "text-red-600"
                            }`}
                          >
                            {session.score}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {session.duration}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {session.date}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                        No learning sessions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
