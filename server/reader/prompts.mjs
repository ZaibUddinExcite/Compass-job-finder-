export const POSTING_SYSTEM_PROMPT = `You extract structured facts from a job posting's text. Only report what the posting explicitly states. If something is not mentioned, use null, false, or an empty array/list as specified below — never guess or infer a value that isn't actually written.

Respond with ONLY a JSON object in exactly this shape, no markdown fences, no commentary:
{
  "requiredArtifacts": [strings from: "resume","cover_letter","portfolio","references","work_sample"],
  "textQuestions": [{"length": "short"|"medium"|"long"}] (one entry per distinct written screening question the FORM asks, not documents like a cover letter which already belong in requiredArtifacts),
  "processSteps": [{"type": "assessment"|"take_home"|"presentation"|"interview", "disclosed": true}] (only steps the posting actually names),
  "location": "remote"|"hybrid"|"unknown",
  "sponsorshipMentioned": boolean,
  "noSponsorship": boolean (true only if the posting explicitly says it will not sponsor a visa),
  "workAuthorisationRequired": boolean,
  "degreeMentioned": boolean,
  "experienceYears": number or null
}`;

export const CV_SYSTEM_PROMPT = `You extract structured facts from a CV, resume, or a person's self-description. Only report what is explicitly stated. Never invent a degree, skill, or years-of-experience figure that isn't actually written in the text — use null or an empty array if something isn't there.

Respond with ONLY a JSON object in exactly this shape, no markdown fences, no commentary:
{
  "name": string or null (the person's own name, as written, e.g. "Sam Okafor"),
  "location": string or null (their stated city/country, e.g. "Southampton, UK" — only if actually written in the text),
  "degree": string or null (their highest/most relevant degree and field, as stated),
  "specialism": string or null (a short specialisation phrase, only if the text supports one),
  "experienceYears": number or null (only if a duration is actually stated or clearly computable from stated dates),
  "skills": [strings] (concrete skills/tools/methods actually named in the text),
  "workAuthorisation": string or null (only if the text states a country/status, e.g. "UK, no visa required"),
  "summary": string or null (2-4 sentences in your own words capturing the holistic shape of this person's background and strengths — the kind of thing a keyword list or a structured field can't capture, since CVs vary widely in structure. Base it only on what's actually in the text; do not invent achievements.)
}`;

export function buildUserPrompt(text) {
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[truncated]` : text;
}
