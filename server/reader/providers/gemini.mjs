/**
 * https://ai.google.dev/api/generate-content
 */
export async function complete({ apiKey, model = "gemini-3.1-flash-lite", systemPrompt, userPrompt, maxTokens = 1024, fetchImpl = fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) {
    throw new Error(`Gemini API returned HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("\n");
}
