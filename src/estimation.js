/**
 * Pure, explainable estimation rules for the first product milestone.
 *
 * These functions intentionally return ranges and evidence rather than a
 * fabricated exact prediction. A learned forecasting model can only be added
 * after the product has a consented, representative, outcome-labelled dataset.
 */

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const roundToHalf = (value) => Math.round(value * 2) / 2;

const roundToHundredth = (value) => Math.round(value * 100) / 100;

const addRange = (total, range) => ({
  minimum: total.minimum + range.minimum,
  maximum: total.maximum + range.maximum,
});

const applicantSignalScore = (count) => {
  if (count < 5) return 0;
  if (count < 20) return 1;
  if (count < 50) return 2;
  if (count < 100) return 3;
  return 4;
};

const attentionBand = (score, populatedSignals) => {
  if (populatedSignals === 0) return "unknown";
  if (score < 3) return "low";
  if (score < 6) return "moderate";
  if (score < 10) return "high";
  return "very_high";
};

const effortBand = (range) => {
  const midpoint = (range.minimum + range.maximum) / 2;
  if (midpoint <= 10) return "quick";
  if (midpoint <= 25) return "standard";
  if (midpoint <= 60) return "substantive";
  return "deep";
};

/**
 * Estimate competition as an application-attention band.
 *
 * @param {object} input
 * @param {{count: number, kind: "completed_applications"|"apply_clicks"|"unknown"}=} input.visibleSignal
 * @param {number=} input.postedHoursAgo
 * @param {"on_site"|"hybrid"|"remote"|"unknown"=} input.workplaceType
 * @param {"local"|"regional"|"national"|"global"|"unknown"=} input.employerReach
 * @param {"niche"|"typical"|"broad"|"unknown"=} input.roleSupply
 * @param {boolean=} input.oneClickApply
 * @returns {{band: string, confidence: number, observedCompletedApplications: number|undefined, observedApplyClicks: number|undefined, evidence: string[], caveats: string[]}}
 */
export function estimateApplicationAttention(input = {}) {
  const evidence = [];
  const caveats = [];
  let score = 0;
  let populatedSignals = 0;
  let observedCompletedApplications;
  let observedApplyClicks;
  let directConfidence = 0.2;

  const visibleSignal = input.visibleSignal;
  if (visibleSignal && Number.isFinite(visibleSignal.count) && visibleSignal.count >= 0) {
    const count = Math.floor(visibleSignal.count);
    score += applicantSignalScore(count);
    populatedSignals += 1;

    if (visibleSignal.kind === "completed_applications") {
      observedCompletedApplications = count;
      directConfidence = 0.9;
      evidence.push(`${count} completed applications were observed on the source at the time of capture.`);
    } else if (visibleSignal.kind === "apply_clicks") {
      observedApplyClicks = count;
      directConfidence = 0.65;
      evidence.push(`${count} apply clicks were observed on the source at the time of capture.`);
      caveats.push("Apply clicks measure interest or application starts, not completed applications.");
    } else {
      directConfidence = 0.45;
      evidence.push(`${count} visible applicants were reported, but the source did not define the metric.`);
      caveats.push("The visible applicant metric is not defined, so it is treated as a weak attention signal.");
    }
  }

  const workplacePoints = { on_site: 0, hybrid: 2, remote: 4, unknown: 0 };
  if (input.workplaceType && input.workplaceType !== "unknown") {
    score += workplacePoints[input.workplaceType] ?? 0;
    populatedSignals += 1;
    if (input.workplaceType === "remote") evidence.push("The role is remote, increasing the potential candidate pool.");
    else if (input.workplaceType === "hybrid") evidence.push("The role is hybrid, giving it a broader reach than an on-site-only posting.");
  }

  const reachPoints = { local: 0, regional: 1, national: 2, global: 3, unknown: 0 };
  if (input.employerReach && input.employerReach !== "unknown") {
    score += reachPoints[input.employerReach] ?? 0;
    populatedSignals += 1;
    if (input.employerReach === "global" || input.employerReach === "national") {
      evidence.push("The employer's recruiting reach may expose the role to a larger audience.");
    } else if (input.employerReach === "regional") {
      evidence.push("The employer recruits regionally, a modest reach signal.");
    }
  }

  const roleSupplyPoints = { niche: 0, typical: 1, broad: 3, unknown: 0 };
  if (input.roleSupply && input.roleSupply !== "unknown") {
    score += roleSupplyPoints[input.roleSupply] ?? 0;
    populatedSignals += 1;
    if (input.roleSupply === "broad") evidence.push("The title describes a broad, commonly searched role family.");
    else if (input.roleSupply === "typical") evidence.push("The title describes a typical, moderately searched role family.");
  }

  if (Number.isFinite(input.postedHoursAgo) && input.postedHoursAgo >= 0) {
    populatedSignals += 1;
    if (input.postedHoursAgo > 168) {
      score += 3;
      evidence.push("The role has been posted for more than seven days, allowing attention to accumulate.");
    } else if (input.postedHoursAgo > 72) {
      score += 2;
      evidence.push("The role has been posted for more than three days.");
    } else if (input.postedHoursAgo > 24) {
      score += 1;
      evidence.push("The role has been posted for more than one day.");
    }
  }

  if (input.oneClickApply === true) {
    score += 2;
    populatedSignals += 1;
    evidence.push("The source advertises a one-click or simplified application route.");
  }

  if (populatedSignals === 0) {
    caveats.push("No observed or proxy signals are available; an attention estimate would be misleading.");
  } else if (observedCompletedApplications === undefined) {
    caveats.push("This is an attention proxy, not an estimate of the number of qualified applicants or your chance of an offer.");
  }

  const confidence = roundToHundredth(
    clamp(directConfidence + Math.max(populatedSignals - 1, 0) * 0.07, 0.2, 0.92),
  );

  return {
    band: attentionBand(score, populatedSignals),
    confidence,
    observedCompletedApplications,
    observedApplyClicks,
    evidence,
    caveats,
  };
}

/**
 * Estimate the known time commitment for an application. Values are minutes
 * and exclude undisclosed interviews, assessments, and employer response time.
 *
 * @param {object} input
 * @param {string[]=} input.requiredArtifacts - resume, cover_letter, portfolio, references, work_sample
 * @param {{accountRequired?: boolean, fieldCount?: number, fileUploads?: number, textQuestions?: Array<{length?: "short"|"medium"|"long"}>}=} input.form
 * @param {Array<{type: "assessment"|"take_home"|"interview"|"presentation", minimumMinutes?: number, maximumMinutes?: number, disclosed?: boolean}>=} input.processSteps
 * @param {{resumeReady?: boolean, coverLetterTemplateReady?: boolean}=} input.readiness
 * @returns {{submission: {minimum: number, maximum: number}, preparation: {minimum: number, maximum: number}, knownProcess: {minimum: number, maximum: number}, totalKnown: {minimum: number, maximum: number}, band: string, evidence: string[], caveats: string[]}}
 */
export function estimateApplicationEffort(input = {}) {
  let submission = { minimum: 2, maximum: 4 };
  let preparation = { minimum: 0, maximum: 0 };
  let knownProcess = { minimum: 0, maximum: 0 };
  const evidence = ["Includes a two-to-four minute base for opening, reviewing, and submitting the portal."];
  const caveats = [];

  const form = input.form ?? {};
  if (form.accountRequired) {
    submission = addRange(submission, { minimum: 2, maximum: 6 });
    evidence.push("An account is required before submission.");
  }

  if (Number.isFinite(form.fieldCount) && form.fieldCount > 0) {
    const count = Math.floor(form.fieldCount);
    submission = addRange(submission, { minimum: count * 0.1, maximum: count * 0.35 });
    evidence.push(`${count} visible form fields were counted.`);
  }

  if (Number.isFinite(form.fileUploads) && form.fileUploads > 0) {
    const count = Math.floor(form.fileUploads);
    submission = addRange(submission, { minimum: count * 0.5, maximum: count * 2 });
    evidence.push(`${count} file upload${count === 1 ? " is" : "s are"} required.`);
  }

  for (const question of form.textQuestions ?? []) {
    const length = question.length ?? "short";
    const time = length === "long"
      ? { minimum: 8, maximum: 20 }
      : length === "medium"
        ? { minimum: 3, maximum: 10 }
        : { minimum: 1, maximum: 4 };
    submission = addRange(submission, time);
    evidence.push(`A ${length} written response is required.`);
  }

  const artifacts = new Set(input.requiredArtifacts ?? []);
  if (artifacts.has("resume")) {
    const time = input.readiness?.resumeReady ? { minimum: 1, maximum: 4 } : { minimum: 5, maximum: 20 };
    preparation = addRange(preparation, time);
    evidence.push("A resume is required.");
  }
  if (artifacts.has("cover_letter")) {
    const time = input.readiness?.coverLetterTemplateReady ? { minimum: 10, maximum: 25 } : { minimum: 20, maximum: 50 };
    preparation = addRange(preparation, time);
    evidence.push("A cover letter is required.");
  }
  if (artifacts.has("portfolio")) {
    preparation = addRange(preparation, { minimum: 5, maximum: 20 });
    evidence.push("A portfolio or work link is required.");
  }
  if (artifacts.has("references")) {
    preparation = addRange(preparation, { minimum: 3, maximum: 12 });
    evidence.push("Reference details are required.");
  }
  if (artifacts.has("work_sample")) {
    preparation = addRange(preparation, { minimum: 30, maximum: 180 });
    evidence.push("A work sample is required; the wide range should be reviewed by the applicant.");
  }

  for (const step of input.processSteps ?? []) {
    if (!step.disclosed) continue;
    if (step.type === "interview" && step.minimumMinutes === undefined && step.maximumMinutes === undefined) {
      evidence.push("An interview is disclosed, but no duration is stated.");
      caveats.push("Interview time is not included because the posting did not disclose a duration.");
      continue;
    }
    const range = {
      minimum: step.minimumMinutes ?? (step.type === "take_home" ? 60 : 20),
      maximum: step.maximumMinutes ?? (step.type === "take_home" ? 240 : 60),
    };
    knownProcess = addRange(knownProcess, range);
    evidence.push(`A disclosed ${step.type.replace("_", " ")} is included in the known process.`);
  }

  if ((input.processSteps ?? []).length === 0) {
    caveats.push("Interview stages, assessments, and hiring timelines are not inferred when the employer has not disclosed them.");
  }

  submission = { minimum: roundToHalf(submission.minimum), maximum: roundToHalf(submission.maximum) };
  preparation = { minimum: roundToHalf(preparation.minimum), maximum: roundToHalf(preparation.maximum) };
  knownProcess = { minimum: roundToHalf(knownProcess.minimum), maximum: roundToHalf(knownProcess.maximum) };
  const totalKnown = {
    minimum: roundToHalf(submission.minimum + preparation.minimum + knownProcess.minimum),
    maximum: roundToHalf(submission.maximum + preparation.maximum + knownProcess.maximum),
  };

  return { submission, preparation, knownProcess, totalKnown, band: effortBand(totalKnown), evidence, caveats };
}
