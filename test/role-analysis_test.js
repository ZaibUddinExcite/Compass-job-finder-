import test from "node:test";
import assert from "node:assert/strict";
import { assessEvidenceFit, evaluateEligibility, extractPostingSignals, sourceTrust } from "../src/role-analysis.js";

const profile = {
  degree: "MSc Data Science",
  specialism: "machine learning",
  skills: ["python", "sql", "data analysis"],
  experienceYears: 2,
  workAuthorisation: "United Kingdom until 2028",
  needsSponsorship: "no",
};

test("posting signals are conservative and expose known preparation work", () => {
  const result = extractPostingSignals("Please submit a CV, cover letter, and portfolio. Candidates complete a take-home case study and online assessment.");

  assert.deepEqual(result.requiredArtifacts, ["resume", "cover_letter", "portfolio"]);
  assert.equal(result.processSteps.length, 2);
  // A required cover letter is already priced once via requiredArtifacts (see
  // estimation.test.js "cover letter mention is not double-counted"). It must not
  // also register as a separate written question here.
  assert.equal(result.textQuestions.length, 0);
});

test("a standalone screening question is still detected as a medium written response", () => {
  const result = extractPostingSignals("Please tell us about a time you solved a difficult technical problem.");

  assert.equal(result.textQuestions.length, 1);
  assert.equal(result.textQuestions[0].length, "medium");
});

test("sponsorship conflict is explicit rather than hidden in a score", () => {
  const result = evaluateEligibility(
    { ...profile, needsSponsorship: "yes" },
    "Applicants must have the right to work in the UK. We cannot sponsor visas.",
  );

  assert.equal(result.state, "incompatible");
  assert.match(result.evidence.join(" "), /sponsorship is unavailable/i);
});

test("missing profile facts prompt confirmation rather than exclusion", () => {
  const result = evaluateEligibility({}, "A master's degree and work authorisation are required.");

  assert.equal(result.state, "needs_confirmation");
  // work-authorisation wording, work-authorisation coverage, and degree/graduation details
  assert.equal(result.questions.length, 3);
});

test("apostrophes in 'bachelor's'/'master's degree' are detected without a trailing 'in <subject>' clause", () => {
  // Regression test: clean() used to replace apostrophes with spaces, turning
  // "master's" into "master s" and breaking the /\bmaster'?s degree\b/ word-boundary
  // match — so "Master's degree preferred." was silently treated as no degree
  // mention at all unless the text happened to also say "degree in <subject>".
  assert.equal(extractPostingSignals("Master's degree preferred.").degreeMentioned, true);
  assert.equal(extractPostingSignals("A bachelor's degree is required.").degreeMentioned, true);
});

test("fit output names matched evidence and never claims an offer prediction", () => {
  const result = assessEvidenceFit(profile, "Use Python and SQL for data analysis in a machine learning team. A master's degree is required.");

  assert.equal(result.score, 100);
  assert.deepEqual(result.matchedSkills, ["python", "sql", "data analysis"]);
  assert.match(result.caveat, /does not predict hiring outcomes/i);
});

test("a career summary can boost a partial skills match without changing a profile that has none", () => {
  const partialProfile = { skills: ["python"], specialism: "", degree: "" };
  const withoutSummary = assessEvidenceFit(partialProfile, "Python role in an embedded robotics team building autonomous drones.");
  const withSummary = assessEvidenceFit(
    { ...partialProfile, summary: "Embedded robotics graduate with autonomous drones project experience." },
    "Python role in an embedded robotics team building autonomous drones.",
  );

  assert.ok(withSummary.score > withoutSummary.score);
  assert.match(withSummary.evidence.join(" "), /shares terms with this posting/i);
});

test("user-captured social leads need an official route", () => {
  const result = sourceTrust("social", "https://www.linkedin.com/posts/example");

  assert.equal(result.level, "low");
  assert.match(result.label, /official route still needed/i);
});

test("recognised ATS hosts receive a source label without assuming an official verification", () => {
  const result = sourceTrust("job_board", "https://jobs.lever.co/example/role");

  assert.equal(result.level, "medium");
  assert.match(result.label, /ATS/i);
});
