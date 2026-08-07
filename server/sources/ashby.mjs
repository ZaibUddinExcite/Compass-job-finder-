import { buildJobRecord } from "../normalize.mjs";

/**
 * GET https://api.ashbyhq.com/posting-api/job-board/{jobBoardName}
 * Public, unauthenticated. Returns descriptionPlain directly and a structured
 * workplaceType field (values are capitalised, e.g. "Remote", "Hybrid", "On-site").
 * https://developers.ashbyhq.com/docs/public-job-posting-api
 */
export async function fetchAshbyJobs({ name, jobBoardName }, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(jobBoardName)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Ashby job board "${jobBoardName}" returned HTTP ${response.status}`);
    }
    const data = await response.json();
    return (data.jobs ?? [])
      .filter((job) => job.isListed !== false)
      .map((job) => normaliseAshbyJob(job, { name, jobBoardName }));
  } finally {
    clearTimeout(timer);
  }
}

export function normaliseAshbyJob(job, { name, jobBoardName }) {
  return buildJobRecord({
    source: "ashby",
    sourceId: `${jobBoardName}:${job.jobUrl ?? job.title}`,
    company: name || jobBoardName,
    title: job.title,
    description: job.descriptionPlain ?? "",
    canonicalUrl: job.jobUrl,
    location: job.location ?? null,
    workplaceType: job.workplaceType,
    postedAt: job.publishedAt ?? null,
  });
}
