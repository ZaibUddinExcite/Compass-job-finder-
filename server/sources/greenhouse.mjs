import { buildJobRecord, stripHtml } from "../normalize.mjs";

/**
 * GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
 * Public, unauthenticated. `content=true` includes each job's full HTML description
 * in a single list call, so no per-job detail requests are needed.
 * https://developers.greenhouse.io/job-board.html
 */
export async function fetchGreenhouseJobs({ name, boardToken }, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Greenhouse board "${boardToken}" returned HTTP ${response.status}`);
    }
    const data = await response.json();
    return (data.jobs ?? []).map((job) => normaliseGreenhouseJob(job, { name, boardToken }));
  } finally {
    clearTimeout(timer);
  }
}

export function normaliseGreenhouseJob(job, { name, boardToken }) {
  return buildJobRecord({
    source: "greenhouse",
    sourceId: `${boardToken}:${job.id}`,
    company: name || boardToken,
    title: job.title,
    description: stripHtml(job.content ?? ""),
    canonicalUrl: job.absolute_url,
    location: job.location?.name ?? null,
    // Greenhouse doesn't expose a structured remote/hybrid/on-site field on this
    // endpoint, so workplaceType stays "unknown" here — the existing text-based
    // inference in extractPostingSignals still runs on the description itself.
    workplaceType: undefined,
    postedAt: job.updated_at ?? null,
  });
}
