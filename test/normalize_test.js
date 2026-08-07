import test from "node:test";
import assert from "node:assert/strict";
import { buildJobRecord, contentHash, dedupeJobs, normaliseWorkplaceType, stripHtml } from "../server/normalize.mjs";

test("stripHtml removes tags, decodes common entities, and preserves paragraph breaks", () => {
  const html = "<div>Join our <b>team</b> &amp; help us grow.</div><p>We offer:</p><ul><li>Remote work</li><li>Great pay</li></ul>";
  const text = stripHtml(html);

  assert.doesNotMatch(text, /<[^>]+>/);
  assert.match(text, /Join our team & help us grow\./);
  assert.match(text, /- Remote work/);
  assert.match(text, /- Great pay/);
});

test("stripHtml handles script/style blocks and nbsp without leaking markup", () => {
  const html = "<style>.x{color:red}</style><p>Salary:&nbsp;£50,000</p><script>track()</script>";
  const text = stripHtml(html);

  assert.doesNotMatch(text, /color:red/);
  assert.doesNotMatch(text, /track\(\)/);
  assert.match(text, /Salary: £50,000/);
});

test("normaliseWorkplaceType collapses vocabulary differences across sources", () => {
  assert.equal(normaliseWorkplaceType("Remote"), "remote");
  assert.equal(normaliseWorkplaceType("remote"), "remote");
  assert.equal(normaliseWorkplaceType("On-site"), "on_site");
  assert.equal(normaliseWorkplaceType("Hybrid"), "hybrid");
  assert.equal(normaliseWorkplaceType("unspecified"), "unknown");
  assert.equal(normaliseWorkplaceType(undefined), "unknown");
});

test("buildJobRecord produces a stable id and a contentHash derived from title/company/description", () => {
  const job = buildJobRecord({
    source: "greenhouse",
    sourceId: "acme:123",
    company: "Acme",
    title: "Graduate Engineer",
    description: "Build things.",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
    workplaceType: "remote",
  });

  assert.equal(job.id, "greenhouse:acme:123");
  assert.equal(job.workplaceType, "remote");
  assert.equal(job.contentHash, contentHash(job));
});

test("dedupeJobs removes exact canonicalUrl repeats and falls back to contentHash", () => {
  const a = buildJobRecord({ source: "greenhouse", sourceId: "1", company: "Acme", title: "Engineer", description: "x", canonicalUrl: "https://x/1" });
  const aAgain = buildJobRecord({ source: "adzuna", sourceId: "2", company: "Acme", title: "Engineer", description: "x", canonicalUrl: "https://x/1" });
  const b = buildJobRecord({ source: "lever", sourceId: "3", company: "Acme", title: "Engineer", description: "x", canonicalUrl: "" });
  const bAgain = buildJobRecord({ source: "lever", sourceId: "4", company: "Acme", title: "Engineer", description: "x", canonicalUrl: "" });
  const c = buildJobRecord({ source: "lever", sourceId: "5", company: "Acme", title: "Different role", description: "y", canonicalUrl: "" });

  const result = dedupeJobs([a, aAgain, b, bAgain, c]);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((job) => job.id).sort(), ["greenhouse:1", "lever:5"].sort());
});
