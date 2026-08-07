import { createHash } from "node:crypto";

/**
 * Canonical shape every source normalizer converts into. Mirrors the JobRecord
 * sketched in docs/ARCHITECTURE.md, extended with the plain-text description
 * the existing estimation/role-analysis engines already expect.
 *
 * @typedef {object} JobRecord
 * @property {string} id - stable id, scoped to source (e.g. "greenhouse:algolia:12345")
 * @property {string} source - "greenhouse" | "lever" | "ashby" | "adzuna"
 * @property {string} company
 * @property {string} title
 * @property {string} description - plain text, HTML stripped
 * @property {string} canonicalUrl
 * @property {string|null} location
 * @property {"on_site"|"hybrid"|"remote"|"unknown"} workplaceType - "unknown" unless the source tells us directly
 * @property {string|null} postedAt - ISO 8601, or null if the source didn't say
 * @property {string} capturedAt - ISO 8601, when this record was fetched
 * @property {string} contentHash - sha256 of title+company+description, for de-duplication/change detection
 */

export function stripHtml(html = "") {
  return String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#821[67];|&#x201[89];/gi, "\u2019")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function contentHash(job) {
  return createHash("sha256").update(`${job.title}\u0000${job.company}\u0000${job.description}`).digest("hex").slice(0, 16);
}

/**
 * Best-effort workplace-type normaliser. Sources that tell us directly
 * (Lever, Ashby) should be mapped through this so casing/vocabulary
 * differences ("Remote" vs "remote" vs "on-site") collapse to the same
 * values the existing estimation engine already expects.
 */
export function normaliseWorkplaceType(raw) {
  const value = String(raw ?? "").toLowerCase().trim();
  if (value === "remote") return "remote";
  if (value === "hybrid") return "hybrid";
  if (value === "on-site" || value === "on_site" || value === "onsite") return "on_site";
  return "unknown";
}

export function buildJobRecord({ source, company, title, description, canonicalUrl, location, workplaceType, postedAt, sourceId }) {
  const job = {
    id: `${source}:${sourceId}`,
    source,
    company: company || "Unknown",
    title: title || "Untitled role",
    description: description || "",
    canonicalUrl: canonicalUrl || "",
    location: location || null,
    workplaceType: normaliseWorkplaceType(workplaceType),
    postedAt: postedAt || null,
    capturedAt: new Date().toISOString(),
  };
  job.contentHash = contentHash(job);
  return job;
}

/** De-duplicate by canonicalUrl first (exact match), falling back to contentHash. */
export function dedupeJobs(jobs) {
  const seenUrls = new Set();
  const seenHashes = new Set();
  const result = [];
  for (const job of jobs) {
    const urlKey = job.canonicalUrl || null;
    if (urlKey && seenUrls.has(urlKey)) continue;
    if (seenHashes.has(job.contentHash)) continue;
    if (urlKey) seenUrls.add(urlKey);
    seenHashes.add(job.contentHash);
    result.push(job);
  }
  return result;
}
