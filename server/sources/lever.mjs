import { buildJobRecord } from "../normalize.mjs";

/**
 * GET https://api.lever.co/v0/postings/{site}?mode=json
 * Public, unauthenticated. Returns descriptionPlain/additionalPlain directly —
 * no HTML stripping needed — and a structured workplaceType field
 * (unspecified | on-site | remote | hybrid).
 * https://github.com/lever/postings-api
 */
export async function fetchLeverJobs({ name, site }, { fetchImpl = fetch, timeoutMs = 10_000, limit = 100 } = {}) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json&limit=${limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Lever site "${site}" returned HTTP ${response.status}`);
    }
    const postings = await response.json();
    return (Array.isArray(postings) ? postings : []).map((posting) => normaliseLeverJob(posting, { name, site }));
  } finally {
    clearTimeout(timer);
  }
}

export function normaliseLeverJob(posting, { name, site }) {
  const description = [posting.descriptionPlain, posting.additionalPlain].filter(Boolean).join("\n\n");
  return buildJobRecord({
    source: "lever",
    sourceId: `${site}:${posting.id}`,
    company: name || site,
    title: posting.text,
    description,
    canonicalUrl: posting.hostedUrl,
    location: posting.categories?.location ?? null,
    workplaceType: posting.workplaceType,
    // createdAt is epoch milliseconds, not an ISO string.
    postedAt: posting.createdAt ? new Date(posting.createdAt).toISOString() : null,
  });
}
