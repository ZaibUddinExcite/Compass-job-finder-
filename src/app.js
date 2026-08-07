import { estimateApplicationAttention, estimateApplicationEffort } from "./estimation.js";
import { assessEvidenceFit, evaluateEligibility, extractPostingSignals, sourceTrust } from "./role-analysis.js";

const STORAGE_KEY = "automated-applyer.workspace.v1";

const initialState = {
  profile: { needsSponsorship: "unsure" },
  role: { sourceType: "job_board" },
  estimate: { visibleKind: "unknown", workplaceType: "unknown", employerReach: "unknown", roleSupply: "unknown" },
  tracker: [],
};

const byId = (id) => document.getElementById(id);
const profileForm = byId("profile-form");
const roleForm = byId("role-form");
const estimateForm = byId("estimate-form");
const discoverList = byId("discover-list");
const discoverEmpty = byId("discover-empty");
const discoverStatus = byId("discover-status");
const fitThreshold = byId("fit-threshold");
const fitThresholdValue = byId("fit-threshold-value");
const showCount = byId("show-count");
const postedWithin = byId("posted-within");
const discoverSearch = byId("discover-search");
let allDiscoveredJobs = [];
let discoveredLastRefreshedAt = null;
const cvFileInput = byId("cv-file");
const cvStatus = byId("cv-status");
const readWithAiButton = byId("read-with-ai");
let aiPostingSignals = null;
let aiPostingSignalsFor = null;

let memoryFallback = null;
let state = loadState();

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      ...initialState,
      ...parsed,
      profile: { ...initialState.profile, ...(parsed?.profile ?? {}) },
      role: { ...initialState.role, ...(parsed?.role ?? {}) },
      estimate: { ...initialState.estimate, ...(parsed?.estimate ?? {}) },
      tracker: Array.isArray(parsed?.tracker) ? parsed.tracker : [],
    };
  } catch {
    return memoryFallback ?? structuredClone(initialState);
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    memoryFallback = structuredClone(state);
  }
}

function setControlValue(form, name, value) {
  const control = form.elements.namedItem(name);
  if (!control) return;
  if (control instanceof RadioNodeList) {
    for (const item of control) item.checked = item.value === String(value);
  } else if (control.type === "checkbox") {
    control.checked = Boolean(value);
  } else if (Array.isArray(value)) {
    control.value = value.join(", ");
  } else {
    control.value = value ?? "";
  }
}

function hydrateForm(form, values) {
  for (const [name, value] of Object.entries(values)) setControlValue(form, name, value);
}

function textValue(form, name) {
  return String(form.elements.namedItem(name)?.value ?? "").trim();
}

function numberValue(form, name) {
  const value = textValue(form, name);
  return value === "" ? undefined : Number(value);
}

function checked(form, name) {
  return Boolean(form.elements.namedItem(name)?.checked);
}

function readProfile() {
  const skills = textValue(profileForm, "skills")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    name: textValue(profileForm, "name"),
    degree: textValue(profileForm, "degree"),
    specialism: textValue(profileForm, "specialism"),
    experienceYears: numberValue(profileForm, "experienceYears"),
    skills,
    summary: textValue(profileForm, "summary"),
    location: textValue(profileForm, "location"),
    workplacePreference: String(profileForm.elements.namedItem("workplacePreference")?.value ?? "any"),
    workAuthorisation: textValue(profileForm, "workAuthorisation"),
    needsSponsorship: String(profileForm.elements.namedItem("needsSponsorship")?.value ?? "unsure"),
  };
}

function readRole() {
  return {
    title: textValue(roleForm, "title"),
    company: textValue(roleForm, "company"),
    url: textValue(roleForm, "url"),
    sourceType: textValue(roleForm, "sourceType"),
    verifiedOfficial: checked(roleForm, "verifiedOfficial"),
    description: textValue(roleForm, "description"),
  };
}

function readEstimate(role) {
  const signals = extractPostingSignals(role.description);
  const artifacts = new Set(signals.requiredArtifacts);
  const artifactMap = {
    resume: "resume",
    coverLetter: "cover_letter",
    portfolio: "portfolio",
    references: "references",
    workSample: "work_sample",
  };
  for (const [control, artifact] of Object.entries(artifactMap)) {
    if (checked(estimateForm, control)) artifacts.add(artifact);
  }

  const textQuestions = [...signals.textQuestions];
  const extraQuestionLength = textValue(estimateForm, "extraQuestionLength");
  if (extraQuestionLength !== "none" && !textQuestions.some((question) => question.length === extraQuestionLength)) {
    textQuestions.push({ length: extraQuestionLength });
  }

  const processSteps = [...signals.processSteps];
  const processMap = {
    assessment: "assessment",
    takeHome: "take_home",
    presentation: "presentation",
    interview: "interview",
  };
  for (const [control, type] of Object.entries(processMap)) {
    if (checked(estimateForm, control) && !processSteps.some((step) => step.type === type)) {
      processSteps.push({ type, disclosed: true });
    }
  }

  const visibleCount = numberValue(estimateForm, "visibleCount");
  const visibleKind = textValue(estimateForm, "visibleKind");
  const workplaceType = textValue(estimateForm, "workplaceType");

  return {
    attentionInput: {
      visibleSignal: visibleCount === undefined ? undefined : { count: visibleCount, kind: visibleKind },
      postedHoursAgo: numberValue(estimateForm, "postedHoursAgo"),
      workplaceType: workplaceType === "unknown" ? signals.location : workplaceType,
      employerReach: textValue(estimateForm, "employerReach"),
      roleSupply: textValue(estimateForm, "roleSupply"),
      oneClickApply: checked(estimateForm, "oneClickApply"),
    },
    effortInput: {
      requiredArtifacts: [...artifacts],
      form: {
        accountRequired: checked(estimateForm, "accountRequired"),
        fieldCount: numberValue(estimateForm, "fieldCount") ?? 0,
        fileUploads: numberValue(estimateForm, "fileUploads") ?? 0,
        textQuestions,
      },
      processSteps,
      readiness: {
        resumeReady: Boolean(readProfile().degree || readProfile().skills.length),
        coverLetterTemplateReady: false,
      },
    },
    signals,
  };
}

function displayStatus(value) {
  return value.replaceAll("_", " ");
}

function clearChildren(element) {
  element.replaceChildren();
}

function renderList(element, entries, emptyMessage) {
  clearChildren(element);
  const values = entries.length ? entries : [emptyMessage];
  for (const entry of values.slice(0, 4)) {
    const item = document.createElement("li");
    item.textContent = entry;
    element.append(item);
  }
}

function setStateClass(element, stateName) {
  element.dataset.state = stateName.replaceAll("_", "-");
}

function renderBrief() {
  const profile = readProfile();
  const role = readRole();
  state.profile = profile;
  state.role = role;
  state.estimate = readFormState(estimateForm);
  persist();
  renderDiscoverList();

  const content = byId("result-content");
  const empty = byId("empty-result");
  if (!role.description) {
    byId("result-title").textContent = "Add a role to begin";
    content.hidden = true;
    empty.hidden = false;
    return;
  }

  const eligibility = evaluateEligibility(profile, role.description, aiPostingSignalsFor === role.description ? aiPostingSignals : null);
  const fit = assessEvidenceFit(profile, role.description);
  const estimate = readEstimate(role);
  const attention = estimateApplicationAttention(estimate.attentionInput);
  const effort = estimateApplicationEffort(estimate.effortInput);
  const source = sourceTrust(role.sourceType, role.url, role.verifiedOfficial);

  byId("result-title").textContent = role.title || "Decision brief";
  empty.hidden = true;
  content.hidden = false;

  const eligibilityState = byId("eligibility-state");
  eligibilityState.textContent = displayStatus(eligibility.state);
  setStateClass(byId("eligibility-card"), eligibility.state);
  renderList(
    byId("eligibility-list"),
    [...eligibility.evidence, ...eligibility.questions],
    "No hard requirement was detected in the pasted text. Check the official form before applying.",
  );

  byId("fit-state").textContent = `${fit.score}% — ${fit.label}`;
  renderList(byId("fit-list"), [...fit.evidence, fit.caveat], "Add skills to your profile to compare evidence.");

  const attentionState = byId("attention-state");
  attentionState.textContent = `${displayStatus(attention.band)} attention`;
  const attentionEntries = [
    ...(attention.observedCompletedApplications !== undefined ? [`Observed completed applications: ${attention.observedCompletedApplications}.`] : []),
    ...(attention.observedApplyClicks !== undefined ? [`Observed apply clicks: ${attention.observedApplyClicks}.`] : []),
    ...attention.evidence,
    ...attention.caveats,
  ];
  renderList(byId("attention-list"), attentionEntries, "Add posting details if you want an attention preview.");

  byId("effort-state").textContent = `${effort.totalKnown.minimum}–${effort.totalKnown.maximum} min · ${effort.band}`;
  const effortEntries = [
    `Portal: ${effort.submission.minimum}–${effort.submission.maximum} min.`,
    `Preparation: ${effort.preparation.minimum}–${effort.preparation.maximum} min.`,
    ...(effort.knownProcess.maximum > 0 ? [`Known later steps: ${effort.knownProcess.minimum}–${effort.knownProcess.maximum} min.`] : []),
    ...effort.caveats,
  ];
  renderList(byId("effort-list"), effortEntries, "No portal details are available yet.");

  byId("source-state").textContent = source.label;
  byId("source-help").textContent = source.level === "high"
    ? "Keep the source URL and capture date with the saved role."
    : "A lead can still be valuable. Find and save the employer’s official application route before investing more time.";

  byId("save-role").dataset.snapshot = JSON.stringify({
    eligibility: eligibility.state,
    fit: fit.label,
    attention: attention.band,
    effort: effort.totalKnown,
    source: source.label,
  });
}

function readFormState(form) {
  const values = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    if (element.type === "radio" && !element.checked) continue;
    values[element.name] = element.type === "checkbox" ? element.checked : element.value;
  }
  return values;
}

function renderTracker() {
  const list = byId("tracker-list");
  const empty = byId("tracker-empty");
  clearChildren(list);
  empty.hidden = state.tracker.length > 0;

  for (const role of state.tracker) {
    const card = document.createElement("article");
    card.className = "tracker-card";
    const heading = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = role.title || "Untitled role";
    const company = document.createElement("p");
    company.className = "muted";
    company.textContent = role.company || "Organisation not added";
    heading.append(title, company);

    const meta = document.createElement("p");
    meta.className = "tracker-meta";
    meta.textContent = `${displayStatus(role.snapshot.eligibility)} · ${displayStatus(role.snapshot.attention)} attention · ${role.snapshot.effort.minimum}–${role.snapshot.effort.maximum} min`;

    const controls = document.createElement("div");
    controls.className = "tracker-controls";
    const select = document.createElement("select");
    select.ariaLabel = `Status for ${role.title || "saved role"}`;
    for (const status of ["saved", "researching", "applying", "submitted", "interview", "closed"]) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = displayStatus(status);
      option.selected = role.status === status;
      select.append(option);
    }
    select.addEventListener("change", () => {
      role.status = select.value;
      persist();
    });
    const open = document.createElement("a");
    open.className = "text-button";
    open.textContent = "Open source";
    open.href = role.url || "#workspace";
    if (role.url) {
      open.target = "_blank";
      open.rel = "noreferrer";
    }
    controls.append(select, open);
    card.append(heading, meta, controls);
    list.append(card);
  }
}

function saveCurrentRole() {
  const role = readRole();
  if (!role.description) return;
  const snapshot = JSON.parse(byId("save-role").dataset.snapshot ?? "{}");
  const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const savedRole = { id, ...role, snapshot, status: "saved", savedAt: new Date().toISOString() };
  state.tracker = [savedRole, ...state.tracker.filter((item) => item.url !== role.url || !role.url)];
  persist();
  renderTracker();
  byId("save-role").textContent = "Saved";
  window.setTimeout(() => { byId("save-role").textContent = "Save to tracker"; }, 1200);
}

function exportData() {
  const exportPayload = { exportedAt: new Date().toISOString(), ...state };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "compass-data.json";
  link.click();
  URL.revokeObjectURL(url);
}

function clearData() {
  if (!window.confirm("Clear your local profile, role draft, and tracker from this browser?")) return;
  state = structuredClone(initialState);
  persist();
  hydrateAll();
  renderBrief();
  renderTracker();
}

function applySample() {
  const realCandidates = getFilteredDiscoveredJobs();
  if (realCandidates.length > 0) {
    loadDiscoveredRoleIntoForm(realCandidates[0]);
    return;
  }

  // Fallback only: nothing discovered yet (fresh install, no sources
  // configured, or still mid-refresh). This is clearly fictional data —
  // "Northstar Research" is not a real company.
  state.role = {
    title: "Graduate Data Analyst",
    company: "Northstar Research (fictional example)",
    url: "https://jobs.example.org/graduate-data-analyst",
    sourceType: "community",
    verifiedOfficial: false,
    description: "Northstar Research is looking for a Graduate Data Analyst to use Python and SQL for data analysis. Candidates should hold a master's degree in a quantitative subject or have equivalent experience. Applicants must have the right to work in the UK; we cannot sponsor visas. Please submit a CV, cover letter and a portfolio or GitHub link. Our process includes an online assessment, a take-home case study and interviews. This hybrid role has been posted for a few days.",
  };
  state.estimate = {
    ...initialState.estimate,
    postedHoursAgo: "72",
    workplaceType: "hybrid",
    employerReach: "national",
    roleSupply: "typical",
    fieldCount: "12",
    fileUploads: "2",
    resume: true,
    coverLetter: true,
    portfolio: true,
    assessment: true,
    takeHome: true,
    interview: true,
  };
  hydrateAll();
  renderBrief();
}

function timeAgo(iso) {
  if (!iso) return "posted date unknown";
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 1) return "posted under an hour ago";
  if (hours < 48) return `posted ${hours}h ago`;
  return `posted ${Math.round(hours / 24)}d ago`;
}

function getFilteredDiscoveredJobs() {
  const profile = readProfile();
  const hasSkills = (profile.skills ?? []).length > 0;
  const threshold = Number(fitThreshold.value);
  const maxAgeDays = Number(postedWithin.value);
  const searchTerm = discoverSearch.value.trim().toLowerCase();

  const withinRecency = allDiscoveredJobs.filter((job) => {
    if (!job.postedAt) return true; // unknown age isn't the same as known-stale
    const ageDays = (Date.now() - new Date(job.postedAt).getTime()) / 86_400_000;
    return ageDays <= maxAgeDays;
  });
  const matchingSearch = searchTerm
    ? withinRecency.filter((job) => `${job.title} ${job.company} ${job.description}`.toLowerCase().includes(searchTerm))
    : withinRecency;

  const scored = matchingSearch.map((job) => ({
    job,
    fit: hasSkills ? assessEvidenceFit(profile, job.description, { location: job.location, workplaceType: job.workplaceType }) : null,
  }));
  const filtered = hasSkills ? scored.filter(({ fit }) => fit.score >= threshold) : scored;
  if (hasSkills) filtered.sort((a, b) => b.fit.score - a.fit.score);
  return filtered.map(({ job }) => job);
}

function renderDiscoverList() {
  const profile = readProfile();
  const hasSkills = (profile.skills ?? []).length > 0;
  const threshold = Number(fitThreshold.value);
  const cap = Number(showCount.value);
  fitThreshold.disabled = !hasSkills;
  fitThresholdValue.textContent = !hasSkills ? "show all (add skills to filter)" : threshold === 0 ? "show all" : `${threshold}%+`;

  const filteredJobs = getFilteredDiscoveredJobs();
  const filtered = filteredJobs.map((job) => ({ job, fit: hasSkills ? assessEvidenceFit(profile, job.description, { location: job.location, workplaceType: job.workplaceType }) : null }));

  clearChildren(discoverList);
  discoverEmpty.hidden = allDiscoveredJobs.length > 0;
  discoverList.hidden = allDiscoveredJobs.length === 0;
  discoverStatus.hidden = !discoveredLastRefreshedAt;
  if (discoveredLastRefreshedAt) {
    const shown = Math.min(filtered.length, cap);
    const countText = shown < filtered.length
      ? `Showing top ${shown} of ${filtered.length} matching (${allDiscoveredJobs.length} found total).`
      : filtered.length < allDiscoveredJobs.length
        ? `Showing all ${filtered.length} matching (${allDiscoveredJobs.length} found total — lower the match threshold to see more).`
        : `Showing all ${filtered.length} role(s) found.`;
    discoverStatus.textContent = `Last refreshed ${new Date(discoveredLastRefreshedAt).toLocaleString()} — ${countText}`;
  }

  for (const { job, fit } of filtered.slice(0, cap)) {
    const card = document.createElement("article");
    card.className = "discover-card";
    const heading = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = job.title;
    const meta = document.createElement("p");
    meta.className = "muted";
    const fitText = fit ? ` · ${fit.score}% match` : "";
    meta.textContent = `${job.company} · ${job.source} · ${job.location ?? "location unknown"} · ${timeAgo(job.postedAt)}${fitText}`;
    heading.append(title, meta);
    const analyseButton = document.createElement("button");
    analyseButton.className = "secondary-button";
    analyseButton.type = "button";
    analyseButton.textContent = "Analyse";
    analyseButton.addEventListener("click", () => loadDiscoveredRoleIntoForm(job));
    card.append(heading, analyseButton);
    discoverList.append(card);
  }
}

async function loadDiscoveredRoles() {
  try {
    const response = await fetch("/api/roles");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    allDiscoveredJobs = data.jobs ?? [];
    discoveredLastRefreshedAt = data.lastRefreshedAt ?? null;
    renderDiscoverList();
  } catch {
    // Likely running the static-only server (no /api routes), or first run before any refresh.
    discoverEmpty.hidden = false;
    discoverList.hidden = true;
  }
}

function loadDiscoveredRoleIntoForm(job) {
  state.role = {
    title: job.title,
    company: job.company,
    url: job.canonicalUrl,
    sourceType: "job_board",
    // Greenhouse/Lever/Ashby are the employer's own ATS, so treat as verified;
    // Adzuna is an aggregator and still needs the usual source-trust check.
    verifiedOfficial: job.source !== "adzuna",
    description: job.description,
  };
  state.estimate = { ...state.estimate };
  if (job.workplaceType && job.workplaceType !== "unknown") state.estimate.workplaceType = job.workplaceType;
  if (job.postedAt) {
    state.estimate.postedHoursAgo = String(Math.max(0, Math.round((Date.now() - new Date(job.postedAt).getTime()) / 3_600_000)));
  }
  hydrateAll();
  renderBrief();
  byId("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

cvFileInput.addEventListener("change", async () => {
  const file = cvFileInput.files?.[0];
  if (!file) return;
  cvStatus.hidden = false;
  cvStatus.textContent = "Reading…";
  try {
    const dataBase64 = await fileToBase64(file);
    const response = await fetch("/api/cv", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64 }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    state.profile = { ...state.profile, ...data.profile };
    hydrateAll();
    renderBrief();
    cvStatus.textContent = "Profile filled in from your CV — review it below before relying on it.";
  } catch (error) {
    cvStatus.textContent = `Couldn't read that file: ${error.message}`;
  } finally {
    cvFileInput.value = "";
  }
});

readWithAiButton.addEventListener("click", async () => {
  const role = readRole();
  if (!role.description) return;
  readWithAiButton.disabled = true;
  readWithAiButton.textContent = "Reading…";
  try {
    const response = await fetch("/api/read-posting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: role.description }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    aiPostingSignals = data.signals;
    aiPostingSignalsFor = role.description;
    renderBrief();
    readWithAiButton.textContent = "Re-read with AI";
  } catch (error) {
    readWithAiButton.textContent = "Read with AI (failed — retry?)";
    console.error(error);
  } finally {
    readWithAiButton.disabled = false;
  }
});

async function checkReaderStatus() {
  try {
    const response = await fetch("/api/reader-status");
    const data = await response.json();
    readWithAiButton.hidden = !data.configured;
  } catch {
    readWithAiButton.hidden = true;
  }
}

function hydrateAll() {
  hydrateForm(profileForm, state.profile);
  hydrateForm(roleForm, state.role);
  hydrateForm(estimateForm, state.estimate);
}

for (const form of [profileForm, roleForm, estimateForm]) {
  form.addEventListener("input", renderBrief);
  form.addEventListener("change", renderBrief);
}

byId("save-role").addEventListener("click", saveCurrentRole);
byId("load-sample").addEventListener("click", applySample);
byId("export-data").addEventListener("click", exportData);
byId("clear-data").addEventListener("click", clearData);
fitThreshold.addEventListener("input", renderDiscoverList);
showCount.addEventListener("change", renderDiscoverList);
postedWithin.addEventListener("change", renderDiscoverList);
discoverSearch.addEventListener("input", renderDiscoverList);

byId("refresh-discover").addEventListener("click", async () => {
  const button = byId("refresh-discover");
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    const profile = readProfile();
    await fetch("/api/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ specialism: profile.specialism, skills: profile.skills }),
    });
  } catch {
    // Static-only server, or refresh failed server-side — loadDiscoveredRoles below
    // will just show whatever is already available.
  }
  await loadDiscoveredRoles();
  button.disabled = false;
  button.textContent = "Refresh";
});
byId("show-estimate-controls").addEventListener("click", () => {
  byId("estimate-controls").hidden = false;
  byId("show-estimate-controls").setAttribute("aria-expanded", "true");
  byId("estimate-controls").scrollIntoView({ behavior: "smooth", block: "start" });
});
byId("close-estimate-controls").addEventListener("click", () => {
  byId("estimate-controls").hidden = true;
  byId("show-estimate-controls").setAttribute("aria-expanded", "false");
});

hydrateAll();
renderBrief();
renderTracker();
loadDiscoveredRoles();
checkReaderStatus();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => undefined));
}
