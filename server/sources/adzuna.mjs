import { buildJobRecord } from "../normalize.mjs";

/**
 * GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}
 *   ?app_id=&app_key=&what=&where=&results_per_page=&content-type=application/json
 * Requires a free app_id/app_key pair from https://developer.adzuna.com.
 * Adzuna aggregates from licensed sources rather than scraping — it doesn't
 * expose a structured remote/hybrid field, so workplaceType is left "unknown"
 * and the existing text-based inference in extractPostingSignals still applies.
 * https://developer.adzuna.com/docs/search
 */
export async function fetchAdzunaJobs(
  { country = "gb", what = "", where = "", resultsPerPage = 20, maxPages = 1 },
  { fetchImpl = fetch, timeoutMs = 10_000, appId, appKey } = {},
) {
  if (!appId || !appKey) {
    throw new Error("Adzuna is not configured: set ADZUNA_APP_ID and ADZUNA_APP_KEY (see server/README.md)");
  }

  const jobs = [];
  for (let page = 1; page <= Math.max(1, maxPages); page += 1) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: String(resultsPerPage),
      "content-type": "application/json",
    });
    if (what) params.set("what", what);
    if (where) params.set("where", where);

    const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/${page}?${params}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Adzuna search returned HTTP ${response.status}`);
      }
      const data = await response.json();
      const results = data.results ?? [];
      jobs.push(...results.map(normaliseAdzunaJob));
      if (results.length < resultsPerPage) break; // last page
    } finally {
      clearTimeout(timer);
    }
  }
  return jobs;
}

export function normaliseAdzunaJob(result) {
  return buildJobRecord({
    source: "adzuna",
    sourceId: result.id ?? result.redirect_url,
    company: result.company?.display_name,
    title: result.title,
    description: result.description ?? "",
    canonicalUrl: result.redirect_url,
    location: result.location?.display_name ?? null,
    workplaceType: undefined,
    postedAt: result.created ?? null,
  });
}
