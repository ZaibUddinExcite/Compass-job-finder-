import { getConfiguredProvider } from "./providers/index.mjs";
import { extractJson } from "./json.mjs";
import { CV_SYSTEM_PROMPT, POSTING_SYSTEM_PROMPT, buildUserPrompt } from "./prompts.mjs";

export function isReaderConfigured(env = process.env) {
  return getConfiguredProvider(env) !== null;
}

async function run(systemPrompt, text, env) {
  const complete = getConfiguredProvider(env);
  if (!complete) {
    throw new Error("No LLM provider configured — set LLM_PROVIDER and LLM_API_KEY (see server/README.md). The regex-based analysis still works without this.");
  }
  const raw = await complete({ systemPrompt, userPrompt: buildUserPrompt(text), maxTokens: 4096 });
  return extractJson(raw);
}

const ARTIFACT_VALUES = new Set(["resume", "cover_letter", "portfolio", "references", "work_sample"]);
const LENGTH_VALUES = new Set(["short", "medium", "long"]);
const STEP_TYPES = new Set(["assessment", "take_home", "presentation", "interview"]);
const LOCATION_VALUES = new Set(["remote", "hybrid", "unknown"]);

/** Same return shape as the regex-based extractPostingSignals(), so callers can use either interchangeably. */
export async function readPostingSignals(text, env = process.env) {
  const parsed = await run(POSTING_SYSTEM_PROMPT, text, env);
  return {
    requiredArtifacts: Array.isArray(parsed.requiredArtifacts) ? parsed.requiredArtifacts.filter((v) => ARTIFACT_VALUES.has(v)) : [],
    textQuestions: Array.isArray(parsed.textQuestions) ? parsed.textQuestions.filter((q) => LENGTH_VALUES.has(q?.length)) : [],
    processSteps: Array.isArray(parsed.processSteps) ? parsed.processSteps.filter((s) => STEP_TYPES.has(s?.type)).map((s) => ({ type: s.type, disclosed: true })) : [],
    location: LOCATION_VALUES.has(parsed.location) ? parsed.location : "unknown",
    sponsorshipMentioned: Boolean(parsed.sponsorshipMentioned),
    noSponsorship: Boolean(parsed.noSponsorship),
    workAuthorisationRequired: Boolean(parsed.workAuthorisationRequired),
    degreeMentioned: Boolean(parsed.degreeMentioned),
    experienceYears: Number.isFinite(parsed.experienceYears) ? parsed.experienceYears : undefined,
  };
}

/** Same field names as the profile form. */
export async function readCandidateProfile(text, env = process.env) {
  const parsed = await run(CV_SYSTEM_PROMPT, text, env);
  return {
    name: typeof parsed.name === "string" ? parsed.name : "",
    location: typeof parsed.location === "string" ? parsed.location : "",
    degree: typeof parsed.degree === "string" ? parsed.degree : "",
    specialism: typeof parsed.specialism === "string" ? parsed.specialism : "",
    experienceYears: Number.isFinite(parsed.experienceYears) ? parsed.experienceYears : undefined,
    skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s) => typeof s === "string") : [],
    workAuthorisation: typeof parsed.workAuthorisation === "string" ? parsed.workAuthorisation : "",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}
