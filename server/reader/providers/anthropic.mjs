/**
 * https://docs.claude.com/en/api/messages
 */
export async function complete({ apiKey, model = "claude-sonnet-4-6", systemPrompt, userPrompt, maxTokens = 1024, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic API returned HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return (data.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
