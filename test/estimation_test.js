import test from "node:test";
import assert from "node:assert/strict";
import { estimateApplicationAttention, estimateApplicationEffort } from "../src/estimation.js";
import { extractPostingSignals } from "../src/role-analysis.js";

test("completed applications are preserved as an observation, not predicted", () => {
  const result = estimateApplicationAttention({
    visibleSignal: { count: 42, kind: "completed_applications" },
    workplaceType: "hybrid",
  });

  assert.equal(result.observedCompletedApplications, 42);
  assert.equal(result.observedApplyClicks, undefined);
  assert.ok(result.confidence >= 0.9);
  assert.ok(["moderate", "high", "very_high"].includes(result.band));
});

test("apply clicks are never presented as completed candidates", () => {
  const result = estimateApplicationAttention({
    visibleSignal: { count: 120, kind: "apply_clicks" },
  });

  assert.equal(result.observedCompletedApplications, undefined);
  assert.equal(result.observedApplyClicks, 120);
  assert.match(result.caveats.join(" "), /not completed applications/i);
});

test("absence of signals yields an unknown attention band", () => {
  const result = estimateApplicationAttention();

  assert.equal(result.band, "unknown");
  assert.equal(result.confidence, 0.2);
});

test("remote, broad, one-click roles can be marked as high attention without a fake count", () => {
  const result = estimateApplicationAttention({
    workplaceType: "remote",
    employerReach: "global",
    roleSupply: "broad",
    postedHoursAgo: 180,
    oneClickApply: true,
  });

  assert.equal(result.band, "very_high");
  assert.equal(result.observedCompletedApplications, undefined);
  assert.match(result.caveats.join(" "), /attention proxy/i);
});

test("a simple ready-resume application has a short known commitment", () => {
  const result = estimateApplicationEffort({
    requiredArtifacts: ["resume"],
    form: { fileUploads: 1, fieldCount: 4 },
    readiness: { resumeReady: true },
  });

  assert.equal(result.band, "quick");
  assert.ok(result.totalKnown.minimum >= 3);
  assert.ok(result.totalKnown.maximum <= 12);
});

test("a weak but real apply-click signal is 'low', not 'unknown'", () => {
  // Regression test: attentionBand used to key its "unknown" fallback off
  // observedCompletedApplications specifically, so a low apply-click count (which
  // scores 0 points but is still a real, displayed observation) fell through to
  // "unknown" — contradicting the evidence list, which described the 3 clicks.
  const result = estimateApplicationAttention({
    visibleSignal: { count: 3, kind: "apply_clicks" },
  });

  assert.equal(result.observedApplyClicks, 3);
  assert.equal(result.band, "low");
});

test("hybrid, regional, and typical signals each surface their own evidence line", () => {
  const result = estimateApplicationAttention({
    workplaceType: "hybrid",
    employerReach: "regional",
    roleSupply: "typical",
  });

  assert.match(result.evidence.join(" "), /hybrid/i);
  assert.match(result.evidence.join(" "), /regional/i);
  assert.match(result.evidence.join(" "), /typical/i);
});

test("cover letter mention is not double-counted as a submission-time written response", () => {
  const signals = extractPostingSignals("Please submit a CV, cover letter, and portfolio.");
  const result = estimateApplicationEffort({
    requiredArtifacts: signals.requiredArtifacts,
    form: { textQuestions: signals.textQuestions },
  });

  // Cover letter time belongs in preparation only (20-50 min unready); submission
  // should still be just the 2-4 minute portal base, since nothing else was disclosed.
  assert.equal(result.submission.minimum, 2);
  assert.equal(result.submission.maximum, 4);
  assert.ok(result.preparation.minimum >= 20);
});

test("cover letters, long answers, and a disclosed take-home increase known effort", () => {
  const result = estimateApplicationEffort({
    requiredArtifacts: ["resume", "cover_letter", "portfolio"],
    form: { accountRequired: true, fieldCount: 20, fileUploads: 3, textQuestions: [{ length: "long" }] },
    readiness: { resumeReady: true, coverLetterTemplateReady: false },
    processSteps: [{ type: "take_home", disclosed: true, minimumMinutes: 120, maximumMinutes: 240 }],
  });

  assert.equal(result.band, "deep");
  assert.ok(result.knownProcess.minimum >= 120);
  assert.ok(result.totalKnown.maximum >= 300);
});
