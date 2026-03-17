const requiredEnvKeys = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

type RequiredEnvKey = (typeof requiredEnvKeys)[number];

function readEnv(key: RequiredEnvKey): string {
  const value = import.meta.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readOptionalEnv(key: string): string | null {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export const env = {
  supabaseUrl: readEnv("VITE_SUPABASE_URL"),
  supabasePublishableKey: readEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
  localAiEnabled: readOptionalEnv("VITE_LOCAL_AI_ENABLED") !== "false",
  localAiBaseUrl: readOptionalEnv("VITE_LOCAL_AI_BASE_URL") ?? (import.meta.env.DEV ? "/api/local-ai" : "http://127.0.0.1:8080/v1"),
  localAiModel: readOptionalEnv("VITE_LOCAL_AI_MODEL") ?? "qwen2.5-local",
  localAiTimeoutMs: Number(readOptionalEnv("VITE_LOCAL_AI_TIMEOUT_MS") ?? "45000"),
};
