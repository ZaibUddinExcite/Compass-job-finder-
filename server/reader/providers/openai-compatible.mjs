/**
 * Covers any provider implementing the OpenAI chat completions shape —
 * https://platform.openai.com/docs/api-reference/chat and its many
 * compatible implementations (Groq, Mistral, DeepSeek, OpenRouter, Together,
 * Ollama's OpenAI-compat endpoint, etc). Point LLM_BASE_URL at whichever one
 * you're using; it defaults to OpenAI itself.
 *
 * response_format is deliberately NOT set here — some compatible servers
 * reject unknown parameters, and prompting plus robust parsing (see
 * ../json.mjs) is more broadly compatible than relying on strict JSON mode.
 */
export async function complete({ apiKey, model = "gpt-5-mini", baseUrl = "https://api.openai.com/v1", systemPrompt, userPrompt, maxTokens = 1024, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI-compatible API returned HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}
