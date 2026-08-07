const clean = (value = "") =>
  value
    .toLowerCase()
    .replace(/['\u2019]/g, "") // strip straight/curly apostrophes so "master's"/"bachelor's" stay contiguous
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsAny = (text, expressions) => expressions.some((expression) => expression.test(text));

const unique = (items) => [...new Set(items)];

const inferWrittenQuestionLength = (text) => {
  // Cover letters / personal statements are already counted once via requiredArtifacts
  // (see extractPostingSignals below) and priced in estimateApplicationEffort's
  // `preparation` component. Counting them again here as a submission-time "written
  // response" would double the same requirement across two line items.
  if (/\b(?:why do you want|describe a time|tell us about|supporting statement)\b/.test(text)) return "medium";
  return undefined;
};

/**
 * Pull conservative, user-reviewable signals from a pasted job posting.
 * The result is a set of clues, not a claim about what a portal will require.
 */
export function extractPostingSignals(description = "") {
  const text = clean(description);
  const requiredArtifacts = [];
  const processSteps = [];
  const textQuestions = [];

  if (containsAny(text, [/\bresume\b/, /\bcv\b/, /\bcurriculum vitae\b/])) requiredArtifacts.push("resume");
  if (containsAny(text, [/\bcover letter\b/, /\bpersonal statement\b/, /\bstatement of interest\b/])) requiredArtifacts.push("cover_letter");
  if (containsAny(text, [/\bportfolio\b/, /\bportfolio link\b/, /\bgithub profile\b/, /\bwebsite link\b/])) requiredArtifacts.push("portfolio");
  if (containsAny(text, [/\breferences?\b/, /\breferees?\b/])) requiredArtifacts.push("references");
  if (containsAny(text, [/\bwork sample\b/, /\bwriting sample\b/, /\bcode sample\b/])) requiredArtifacts.push("work_sample");

  const questionLength = inferWrittenQuestionLength(text);
  if (questionLength) textQuestions.push({ length: questionLength });

  if (containsAny(text, [/\btake[ -]?home\b/, /\bcase study\b/, /\btechnical exercise\b/, /\bcoding challenge\b/])) {
    processSteps.push({ type: "take_home", disclosed: true });
  }
  if (containsAny(text, [/\bonline assessment\b/, /\bskills assessment\b/, /\bpsychometric\b/, /\bpre-employment test\b/])) {
    processSteps.push({ type: "assessment", disclosed: true });
  }
  if (containsAny(text, [/\bpresentation\b/, /\bdeliver a presentation\b/])) {
    processSteps.push({ type: "presentation", disclosed: true });
  }
  if (containsAny(text, [/\binterview process\b/, /\binterview stages?\b/, /\binterviews?\b/])) {
    processSteps.push({ type: "interview", disclosed: true });
  }

  return {
    requiredArtifacts: unique(requiredArtifacts),
    textQuestions,
    processSteps,
    location: containsAny(text, [/\bremote\b/, /\bwork from home\b/]) ? "remote" : containsAny(text, [/\bhybrid\b/]) ? "hybrid" : "unknown",
    sponsorshipMentioned: containsAny(text, [/\bsponsorship\b/, /\bvisa\b/, /\bwork authori[sz]ation\b/, /\bright to work\b/]),
    noSponsorship: containsAny(text, [/\bno visa sponsorship\b/, /\bwithout sponsorship\b/, /\bwill not sponsor\b/, /\bcannot sponsor\b/]),
    workAuthorisationRequired: containsAny(text, [/\bwork authori[sz]ation\b/, /\bright to work\b/, /\bauthori[sz]ed to work\b/, /\beligible to work\b/]),
    degreeMentioned: containsAny(text, [/\bbachelor'?s degree\b/, /\bmaster'?s degree\b/, /\bph\.?d\.?\b/, /\bdegree in\b/]),
    experienceYears: extractExperienceYears(text),
  };
}

function extractExperienceYears(text) {
  const match = text.match(/\b(\d{1,2})\+?\s+years? (?:of )?(?:relevant )?experience\b/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Evaluate only explicit requirements. Missing profile data becomes a question,
 * not a failure. This intentionally avoids legal conclusions about visas.
 */
export function evaluateEligibility(profile = {}, description = "", signals = null) {
  signals = signals ?? extractPostingSignals(description);
  const evidence = [];
  const questions = [];
  let incompatible = false;

  if (signals.noSponsorship) {
    evidence.push("The posting says visa sponsorship is unavailable.");
    if (profile.needsSponsorship === "yes") {
      incompatible = true;
      evidence.push("Your profile says that sponsorship is required.");
    } else if (!profile.needsSponsorship || profile.needsSponsorship === "unsure") {
      questions.push("Confirm whether you would need employer sponsorship for this role.");
    }
  } else if (signals.sponsorshipMentioned) {
    evidence.push("The posting mentions visa, sponsorship, or work-authorisation requirements.");
    questions.push("Review the exact work-authorisation wording before applying.");
  }

  if (signals.workAuthorisationRequired) {
    if (profile.workAuthorisation) {
      evidence.push(`Your profile records work authorisation: ${profile.workAuthorisation}.`);
    } else {
      questions.push("Add your current work-authorisation coverage to check this requirement.");
    }
  }

  if (signals.degreeMentioned) {
    if (profile.degree) evidence.push(`The posting mentions a degree and your profile lists ${profile.degree}.`);
    else questions.push("The posting mentions a degree; add your degree and graduation details to assess it.");
  }

  if (signals.experienceYears !== undefined) {
    if (Number.isFinite(profile.experienceYears)) {
      if (profile.experienceYears < signals.experienceYears) {
        questions.push(`The posting asks for ${signals.experienceYears}+ years of experience; your profile lists ${profile.experienceYears}. Check whether relevant research, placements, or projects count.`);
      } else {
        evidence.push(`Your profile lists ${profile.experienceYears} years of experience against a stated ${signals.experienceYears}+ year requirement.`);
      }
    } else {
      questions.push(`The posting asks for ${signals.experienceYears}+ years of experience; add an estimate to your profile.`);
    }
  }

  const state = incompatible ? "incompatible" : questions.length > 0 ? "needs_confirmation" : "likely_compatible";
  return { state, evidence, questions, signals };
}

const SUMMARY_STOPWORDS = new Set([
  "with", "that", "this", "from", "have", "using", "across", "into", "onto",
  "also", "such", "than", "then", "them", "they", "their", "your", "our",
  "about", "over", "under", "between", "within", "without", "each", "every",
  "some", "most", "more", "less", "least", "very", "just", "only", "both",
  "either", "neither", "were", "been", "being", "these", "those", "which",
  "while", "still", "wide", "broad", "range", "background", "experience",
]);

function significantWords(text = "") {
  return [...new Set(clean(text).split(" ").filter((word) => word.length >= 4 && !SUMMARY_STOPWORDS.has(word)))];
}

/**
 * A transparent skill-and-evidence fit indicator. It is deliberately not an
 * employability or offer-probability score.
 */
export function assessEvidenceFit(profile = {}, description = "", jobMeta = {}) {
  const text = clean(description);
  const skills = (profile.skills ?? [])
    .map((skill) => clean(skill))
    .filter(Boolean);
  const matchedSkills = skills.filter((skill) => text.includes(skill));
  const missingSkills = skills.filter((skill) => !text.includes(skill));
  const specialismMatch = profile.specialism ? text.includes(clean(profile.specialism)) : false;
  const summaryWords = profile.summary ? significantWords(profile.summary) : [];
  const matchedSummaryWords = summaryWords.filter((word) => text.includes(word));

  // Prefer structured workplaceType from the source (Lever/Ashby) when given;
  // fall back to the same text-inference the paste flow already uses.
  const workplaceType = jobMeta.workplaceType && jobMeta.workplaceType !== "unknown"
    ? jobMeta.workplaceType
    : extractPostingSignals(description).location;
  const locationOverlap = profile.location && jobMeta.location
    ? significantWords(profile.location).some((word) => clean(jobMeta.location).includes(word))
    : false;

  const skillScore = skills.length === 0 ? 0 : Math.round((matchedSkills.length / skills.length) * 60);
  const degreeScore = profile.degree && /\bdegree\b|\bbachelor|\bmaster|\bph\.?d/.test(text) ? 20 : 0;
  const specialismScore = specialismMatch ? 20 : 0;
  // Additive bonuses, not reallocations of the weights above: a profile with
  // no summary/location/preference set scores exactly as it did before these
  // fields existed.
  const summaryScore = summaryWords.length === 0 ? 0 : Math.round((matchedSummaryWords.length / summaryWords.length) * 15);
  const locationScore = locationOverlap ? 10 : 0;
  const remoteOnlyMismatch = profile.workplacePreference === "remote_only" && workplaceType !== "unknown" && workplaceType !== "remote";
  const remoteScore = profile.workplacePreference === "remote_only" && workplaceType === "remote" ? 10 : remoteOnlyMismatch ? -20 : 0;
  const score = Math.min(100, Math.max(0, skillScore + degreeScore + specialismScore + summaryScore + locationScore + remoteScore));

  const label = score >= 70 ? "strong evidence overlap" : score >= 40 ? "some evidence overlap" : skills.length === 0 ? "profile needs skills" : "limited direct evidence overlap";
  return {
    score,
    label,
    matchedSkills,
    missingSkills,
    evidence: [
      ...matchedSkills.map((skill) => `Your profile lists “${skill}”, which appears in the posting.`),
      ...(specialismMatch ? [`Your specialism “${profile.specialism}” appears in the posting.`] : []),
      ...(matchedSummaryWords.length > 0 ? [`Your profile summary shares terms with this posting: ${matchedSummaryWords.slice(0, 5).join(", ")}.`] : []),
      ...(locationOverlap ? [`This role's location overlaps with your stated location (${profile.location}).`] : []),
      ...(remoteOnlyMismatch ? ["This role isn't remote, but your profile says you need remote-only."] : []),
    ],
    caveat: "This compares text evidence only. It does not predict hiring outcomes or replace your judgement.",
  };
}

export function sourceTrust(sourceType, url = "", verifiedOfficial = false) {
  if (verifiedOfficial) return { label: "verified official route", level: "high" };
  const host = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  })();
  if (/greenhouse\.io$|lever\.co$|ashbyhq\.com$/.test(host)) return { label: "recognised ATS route", level: "medium" };
  if (sourceType === "social" || sourceType === "community") return { label: "user-captured lead — official route still needed", level: "low" };
  return { label: "source needs verification", level: "low" };
}
