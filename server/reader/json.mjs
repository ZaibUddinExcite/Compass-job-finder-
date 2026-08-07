export function extractJson(text) {
  const stripped = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`No JSON object found in model response: ${stripped.slice(0, 200)}`);
    }
    return JSON.parse(stripped.slice(start, end + 1));
  }
}
