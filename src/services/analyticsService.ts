import { supabase } from "../lib/supabaseClient";

export const analyticsService = {
  async getAnalytics(userId: string) {
    const [
      { data: documents, error: documentsError },
      { data: stats, error: statsError },
      { data: sessions, error: sessionsError },
      { data: results, error: resultsError },
    ] = await Promise.all([
      supabase.from("documents").select("*").eq("user_id", userId),
      supabase
        .from("progress_stats")
        .select("*")
        .eq("user_id", userId)
        .order("stat_date", { ascending: true }),
      supabase
        .from("feynman_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
      supabase.from("feynman_results").select("*").order("created_at", { ascending: true }),
    ]);

    if (documentsError) {
      throw documentsError;
    }

    if (statsError) {
      throw statsError;
    }

    if (sessionsError) {
      throw sessionsError;
    }

    if (resultsError) {
      throw resultsError;
    }

    const topicMastery = documents.map((document) => ({
      topic: document.title,
      score: document.completion_percent,
      color: "#4F46E5",
    }));

    const studyTimeData = stats.map((stat) => ({
      day: new Date(stat.stat_date).toLocaleDateString(undefined, { weekday: "short" }),
      minutes: stat.study_minutes,
    }));

    const masteryProgressData = stats.map((stat) => ({
      month: new Date(stat.stat_date).toLocaleDateString(undefined, { month: "short" }),
      score: stat.mastery_score,
    }));

    const recentSessions = sessions.slice(0, 8).map((session) => {
      const result = results.find((item) => item.session_id === session.id);

      return {
        id: session.id,
        topic: session.topic,
        type: "Feynman",
        score: result?.overall_score ?? session.completion_percent,
        date: new Date(session.updated_at).toLocaleDateString(),
        duration: `${Math.max(10, session.completion_percent)} min`,
      };
    });

    const totalStudyMinutes = stats.reduce((total, stat) => total + stat.study_minutes, 0);
    const averageMasteryScore =
      stats.length > 0
        ? Math.round(stats.reduce((total, stat) => total + stat.mastery_score, 0) / stats.length)
        : 0;

    return {
      topicMastery,
      studyTimeData,
      masteryProgressData,
      recentSessions,
      summary: {
        averageMasteryScore,
        growthThisMonth:
          masteryProgressData.length > 1
            ? masteryProgressData[masteryProgressData.length - 1].score - masteryProgressData[0].score
            : averageMasteryScore,
        totalStudyHours: Number((totalStudyMinutes / 60).toFixed(1)),
        sessionsCompleted: sessions.filter((session) => session.status === "completed").length,
      },
    };
  },
};

