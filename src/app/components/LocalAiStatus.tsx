import { useEffect, useState } from "react";
import { localAiService } from "../../services/localAiService";

type LocalAiState = {
  connected: boolean;
  model: string;
  provider?: string;
  mode: "disabled" | "fallback" | "live";
};

export function LocalAiStatus() {
  const [status, setStatus] = useState<LocalAiState>({
      connected: false,
      model: "local-ai",
      provider: "ollama",
      mode: "fallback",
    });

  useEffect(() => {
    let isMounted = true;

    async function loadStatus() {
      const nextStatus = await localAiService.getStatus();

      if (isMounted) {
        setStatus(nextStatus);
      }
    }

    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 15000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const label =
    status.mode === "live"
      ? `${status.provider ?? "ai"} Live · ${status.model}`
      : status.mode === "disabled"
      ? "AI Disabled"
      : `${status.provider ?? "ai"} Fallback · ${status.model}`;
  const dotClass =
    status.mode === "live" ? "bg-emerald-500" : status.mode === "disabled" ? "bg-gray-400" : "bg-amber-500";

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600">
      <span className={`h-2 w-2 rounded-full ${dotClass}`}></span>
      <span>{label}</span>
    </div>
  );
}
