import { complete as anthropicComplete } from "./anthropic.mjs";
import { complete as openaiCompatibleComplete } from "./openai-compatible.mjs";
import { complete as geminiComplete } from "./gemini.mjs";

const registry = {
  anthropic: anthropicComplete,
  openai: openaiCompatibleComplete,
  "openai-compatible": openaiCompatibleComplete,
  groq: openaiCompatibleComplete,
  gemini: geminiComplete,
};

/**
 * Reads LLM_PROVIDER / LLM_API_KEY / LLM_MODEL / LLM_BASE_URL from the
 * environment and returns a ready-to-call `complete()` function, or null if
 * no provider is configured. Any provider that speaks the OpenAI chat
 * completions shape works via LLM_PROVIDER=openai-compatible + LLM_BASE_URL.
 */
export function getConfiguredProvider(env = process.env) {
  const name = (env.LLM_PROVIDER ?? "").toLowerCase().trim();
  const apiKey = env.LLM_API_KEY;
  if (!name || !apiKey) return null;

  const complete = registry[name];
  if (!complete) {
    throw new Error(`Unknown LLM_PROVIDER "${name}". Supported: ${Object.keys(registry).join(", ")}`);
  }

  return (args) => complete({ apiKey, model: env.LLM_MODEL, baseUrl: env.LLM_BASE_URL, ...args });
}
