import test from "node:test";
import assert from "node:assert/strict";
import { fetchGreenhouseJobs, normaliseGreenhouseJob } from "../server/sources/greenhouse.mjs";
import { fetchLeverJobs, normaliseLeverJob } from "../server/sources/lever.mjs";
import { fetchAshbyJobs, normaliseAshbyJob } from "../server/sources/ashby.mjs";
import { fetchAdzunaJobs, normaliseAdzunaJob } from "../server/sources/adzuna.mjs";

function mockFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => body });
}

// --- Greenhouse: fixture matches the "List jobs" ?content=true example from
// developers.greenhouse.io/job-board.html verbatim in shape. ---
const greenhouseFixture = {
  jobs: [
    {
      id: 127817,
      internal_job_id: 144381,
      title: "Vault Designer",
      updated_at: "2016-01-14T10:55:28-05:00",
      location: { name: "NYC" },
      absolute_url: "https://boards.greenhouse.io/vaulttec/jobs/127817",
      content: "<p>Design vaults.</p><p>Requirements:</p><ul><li>5+ years experience</li></ul>",
    },
  ],
  meta: { total: 1 },
};

test("Greenhouse: normalises a job with content=true into plain-text description", () => {
  const job = normaliseGreenhouseJob(greenhouseFixture.jobs[0], { name: "Vault Tec", boardToken: "vaulttec" });

  assert.equal(job.source, "greenhouse");
  assert.equal(job.company, "Vault Tec");
  assert.equal(job.title, "Vault Designer");
  assert.equal(job.canonicalUrl, "https://boards.greenhouse.io/vaulttec/jobs/127817");
  assert.equal(job.location, "NYC");
  assert.equal(job.workplaceType, "unknown");
  assert.doesNotMatch(job.description, /<[^>]+>/);
  assert.match(job.description, /5\+ years experience/);
});

test("Greenhouse: fetchGreenhouseJobs hits the documented endpoint shape and maps every job", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, status: 200, json: async () => greenhouseFixture };
  };

  const jobs = await fetchGreenhouseJobs({ name: "Vault Tec", boardToken: "vaulttec" }, { fetchImpl });

  assert.equal(jobs.length, 1);
  assert.match(requestedUrl, /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/vaulttec\/jobs\?content=true$/);
});

test("Greenhouse: a non-OK response throws rather than silently returning nothing", async () => {
  await assert.rejects(
    () => fetchGreenhouseJobs({ name: "X", boardToken: "x" }, { fetchImpl: mockFetch({}, { ok: false, status: 404 }) }),
    /HTTP 404/,
  );
});

// --- Lever: fixture is the actual JSON returned by
// https://api.lever.co/v0/postings/leverdemo?mode=json&limit=1 at the time this was written. ---
const leverFixture = [
  {
    id: "dbedd284-e008-4961-b75c-e70d284eab5a",
    text: "Account Director (Inside/Outside Hybrid Sales)",
    categories: { commitment: "Regular Full Time (Salary)", department: "Sales", location: "Atlanta, Georgia", team: "Account Executive", allLocations: ["Atlanta, Georgia"] },
    createdAt: 1502907102690,
    descriptionPlain: "Welcome to the Demo Job Listing for Lever!\n\nA fantastic opportunity to make an impact with a forward thinking company\n\n",
    additionalPlain: "Lever builds modern recruiting software.\n",
    country: "US",
    workplaceType: "hybrid",
    hostedUrl: "https://jobs.lever.co/leverdemo/dbedd284-e008-4961-b75c-e70d284eab5a",
    applyUrl: "https://jobs.lever.co/leverdemo/dbedd284-e008-4961-b75c-e70d284eab5a/apply",
  },
];

test("Lever: normalises a real captured posting, using descriptionPlain directly and mapping workplaceType", () => {
  const job = normaliseLeverJob(leverFixture[0], { name: "Lever", site: "leverdemo" });

  assert.equal(job.source, "lever");
  assert.equal(job.title, "Account Director (Inside/Outside Hybrid Sales)");
  assert.equal(job.location, "Atlanta, Georgia");
  assert.equal(job.workplaceType, "hybrid");
  assert.equal(job.canonicalUrl, leverFixture[0].hostedUrl);
  // createdAt is epoch milliseconds, not an ISO string — must be converted.
  assert.equal(job.postedAt, new Date(1502907102690).toISOString());
  assert.match(job.description, /Demo Job Listing/);
  assert.match(job.description, /Lever builds modern recruiting software/);
});

test("Lever: fetchLeverJobs builds the documented mode=json URL", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, status: 200, json: async () => leverFixture };
  };

  const jobs = await fetchLeverJobs({ name: "Lever", site: "leverdemo" }, { fetchImpl });

  assert.equal(jobs.length, 1);
  assert.match(requestedUrl, /^https:\/\/api\.lever\.co\/v0\/postings\/leverdemo\?mode=json&limit=100$/);
});

// --- Ashby: fixture matches the shape shown in
// developers.ashbyhq.com/docs/public-job-posting-api. ---
const ashbyFixture = {
  apiVersion: "1",
  jobs: [
    {
      title: "Product Manager",
      location: "Houston, TX",
      department: "Product",
      team: "Growth",
      isListed: true,
      isRemote: true,
      workplaceType: "Remote",
      descriptionHtml: "<p>Join our team</p>",
      descriptionPlain: "Join our team",
      publishedAt: "2021-04-30T16:21:55.393+00:00",
      employmentType: "FullTime",
      jobUrl: "https://jobs.ashbyhq.com/example_job",
      applyUrl: "https://jobs.ashbyhq.com/example_job/apply",
    },
  ],
};

test("Ashby: normalises a job and maps the capitalised workplaceType vocabulary", () => {
  const job = normaliseAshbyJob(ashbyFixture.jobs[0], { name: "Example Co", jobBoardName: "example" });

  assert.equal(job.source, "ashby");
  assert.equal(job.title, "Product Manager");
  assert.equal(job.workplaceType, "remote");
  assert.equal(job.description, "Join our team");
  assert.equal(job.canonicalUrl, "https://jobs.ashbyhq.com/example_job");
});

test("Ashby: fetchAshbyJobs filters out unlisted jobs", async () => {
  const withUnlisted = { jobs: [...ashbyFixture.jobs, { ...ashbyFixture.jobs[0], title: "Hidden role", isListed: false }] };
  const jobs = await fetchAshbyJobs({ name: "Example Co", jobBoardName: "example" }, { fetchImpl: mockFetch(withUnlisted) });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Product Manager");
});

// --- Adzuna: fixture matches the shape shown in developer.adzuna.com/docs/search. ---
const adzunaFixture = {
  results: [
    {
      id: "12345",
      title: "Javascript Developer",
      company: { display_name: "Acme Corporate" },
      location: { display_name: "Marlow, Buckinghamshire" },
      description: "JavaScript Developer Corporate role...",
      redirect_url: "http://adzuna.co.uk/jobs/land/ad/1",
      created: "2013-11-08T18:07:39Z",
    },
  ],
};

test("Adzuna: throws a clear error when credentials are missing rather than calling the network", async () => {
  await assert.rejects(() => fetchAdzunaJobs({ country: "gb", what: "javascript developer" }, {}), /ADZUNA_APP_ID|not configured/i);
});

test("Adzuna: normalises a result and builds the documented request shape", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, status: 200, json: async () => adzunaFixture };
  };

  const jobs = await fetchAdzunaJobs(
    { country: "gb", what: "javascript developer", resultsPerPage: 20, maxPages: 1 },
    { fetchImpl, appId: "test-id", appKey: "test-key" },
  );

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, "Acme Corporate");
  assert.equal(jobs[0].location, "Marlow, Buckinghamshire");
  assert.match(requestedUrl, /^https:\/\/api\.adzuna\.com\/v1\/api\/jobs\/gb\/search\/1\?/);
  assert.match(requestedUrl, /app_id=test-id/);
  assert.match(requestedUrl, /what=javascript\+developer/);
});

test("Adzuna: normaliseAdzunaJob maps fields directly for unit-level testing", () => {
  const job = normaliseAdzunaJob(adzunaFixture.results[0]);
  assert.equal(job.title, "Javascript Developer");
  assert.equal(job.canonicalUrl, "http://adzuna.co.uk/jobs/land/ad/1");
});
