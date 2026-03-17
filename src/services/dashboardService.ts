import { supabase } from "../lib/supabaseClient";

export const dashboardService = {
  async getDashboardData(userId: string) {
    const [
      { data: documents, error: documentsError },
      { data: sessions, error: sessionsError },
      { data: results, error: resultsError },
    ] = await Promise.all([
      supabase
        .from("documents")
        .select("*")
        .eq("user_id", userId)
        .order("last_opened_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("feynman_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase.from("feynman_results").select("*"),
    ]);

    if (documentsError) {
      throw documentsError;
    }

    if (sessionsError) {
      throw sessionsError;
    }

    if (resultsError) {
      throw resultsError;
    }

    const resultBySessionId = new Map(results.map((result) => [result.session_id, result]));
    const averageUnderstandingScore =
      results.length > 0
        ? Math.round(
            results.reduce((total, result) => total + result.overall_score, 0) / results.length,
          )
        : 0;

    return {
      documents,
      recentSessions: sessions
        .filter((session) => session.status === "completed")
        .map((session) => ({
          ...session,
          result: resultBySessionId.get(session.id) ?? null,
        })),
      summary: {
        documentsStudied: documents.length,
        averageUnderstandingScore,
        completedSessions: sessions.filter((session) => session.status === "completed").length,
      },
    };
  },
};
