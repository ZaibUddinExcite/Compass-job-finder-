import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { exec } from "node:child_process";

import { fetchGreenhouseJobs } from "./sources/greenhouse.mjs";
import { fetchLeverJobs } from "./sources/lever.mjs";
import { fetchAshbyJobs } from "./sources/ashby.mjs";
import { fetchAdzunaJobs } from "./sources/adzuna.mjs";
import { createStore } from "./store.mjs";
import { isReaderConfigured, readCandidateProfile, readPostingSignals } from "./reader/index.mjs";
import { extractTextFromUpload } from "./extract-text.mjs";

try {
  process.loadEnvFile(); // reads ./.env if present; no-op via catch if it isn't
} catch {
  // No .env file yet — fine, Adzuna is simply skipped until ADZUNA_APP_ID/KEY are set.
}

const root = process.cwd();
const port = Number(process.env.PORT ?? 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const store = createStore();

function openInBrowser(url) {
  const command = process.platform === "win32"
    ? `start "" "${url}"`
    : process.platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, (error) => {
    if (error) console.log(`(couldn't auto-open a browser — open ${url} manually)`);
  });
}

async function loadConfig() {
  const localPath = new URL("./config.local.json", import.meta.url);
  const defaultPath = new URL("./config.json", import.meta.url);
  const path = existsSync(localPath) ? localPath : defaultPath;
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Pull fresh jobs from every configured source. Each individual board/site is
 * isolated with try/catch — one bad token or a transient network error never
 * aborts the whole refresh. A top-level source (greenhouse/lever/ashby/adzuna)
 * only replaces its previously-cached jobs if at least one of its boards
 * succeeded this round; otherwise the old cached jobs for that source are left
 * alone rather than wiped by a temporary failure.
 */
async function refreshAll(profileHint = null) {
  const config = await loadConfig();
  const freshJobsBySource = {};
  const health = {};
  const now = new Date().toISOString();

  async function runSource(sourceName, targets, fetchOne) {
    if (!targets || targets.length === 0) return;
    const settled = await Promise.allSettled(targets.map((target) => fetchOne(target)));
    const jobs = [];
    settled.forEach((result, index) => {
      const label = `${sourceName}:${targets[index].boardToken ?? targets[index].site ?? targets[index].jobBoardName}`;
      if (result.status === "fulfilled") {
        jobs.push(...result.value);
        health[label] = { ok: true, jobCount: result.value.length, checkedAt: now };
      } else {
        health[label] = { ok: false, error: String(result.reason?.message ?? result.reason), checkedAt: now };
      }
    });
    if (jobs.length > 0 || settled.some((r) => r.status === "fulfilled")) {
      freshJobsBySource[sourceName] = [...(freshJobsBySource[sourceName] ?? []), ...jobs];
    }
  }

  await runSource("greenhouse", config.greenhouse, (target) => fetchGreenhouseJobs(target));
  await runSource("lever", config.lever, (target) => fetchLeverJobs(target));
  await runSource("ashby", config.ashby, (target) => fetchAshbyJobs(target));

  if (config.adzuna?.enabled) {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    const what = profileHint?.specialism || (profileHint?.skills ?? []).slice(0, 3).join(" ") || config.adzuna.what;
    try {
      if (!appId || !appKey) throw new Error("ADZUNA_APP_ID/ADZUNA_APP_KEY not set — see server/README.md");
      const jobs = await fetchAdzunaJobs({ ...config.adzuna, what }, { appId, appKey });
      freshJobsBySource.adzuna = jobs;
      health.adzuna = { ok: true, jobCount: jobs.length, query: what, checkedAt: now };
    } catch (error) {
      health.adzuna = { ok: false, error: String(error.message ?? error), checkedAt: now };
    }
  }

  const maxAgeDays = config.maxPostingAgeDays ?? 365;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  for (const source of Object.keys(freshJobsBySource)) {
    freshJobsBySource[source] = freshJobsBySource[source].filter((job) => {
      if (!job.postedAt) return true; // unknown age isn't the same as known-stale
      return Date.now() - new Date(job.postedAt).getTime() <= maxAgeMs;
    });
  }

  return store.replaceFresh(freshJobsBySource, health);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

const MAX_BODY_BYTES = 15 * 1024 * 1024; // 15MB — comfortably covers a base64-encoded CV

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/roles" && request.method === "GET") {
    return sendJson(response, 200, store.getAll());
  }

  if (pathname.startsWith("/api/roles/") && request.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/roles/".length));
    const job = store.getById(id);
    return job ? sendJson(response, 200, job) : sendJson(response, 404, { error: "not found" });
  }

  if (pathname === "/api/refresh" && request.method === "POST") {
    try {
      const profileHint = await readJsonBody(request).catch(() => null);
      const result = await refreshAll(profileHint);
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, 500, { error: String(error.message ?? error) });
    }
  }

  if (pathname === "/api/reader-status" && request.method === "GET") {
    return sendJson(response, 200, { configured: isReaderConfigured(), provider: process.env.LLM_PROVIDER ?? null });
  }

  if (pathname === "/api/read-posting" && request.method === "POST") {
    try {
      const { text } = await readJsonBody(request);
      if (!text || typeof text !== "string") return sendJson(response, 400, { error: "Missing 'text' in request body" });
      const signals = await readPostingSignals(text);
      return sendJson(response, 200, { signals });
    } catch (error) {
      return sendJson(response, 502, { error: String(error.message ?? error) });
    }
  }

  if (pathname === "/api/cv" && request.method === "POST") {
    try {
      const { filename, mimeType, dataBase64 } = await readJsonBody(request);
      if (!dataBase64) return sendJson(response, 400, { error: "Missing 'dataBase64' in request body" });
      const buffer = Buffer.from(dataBase64, "base64");
      const text = await extractTextFromUpload({ buffer, mimeType, filename });
      if (!text.trim()) return sendJson(response, 422, { error: "No extractable text found in that file" });
      const profile = await readCandidateProfile(text);
      return sendJson(response, 200, { profile, extractedChars: text.length });
    } catch (error) {
      return sendJson(response, 502, { error: String(error.message ?? error) });
    }
  }

  return sendJson(response, 404, { error: "not found" });
}

function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = normalize(join(root, relativePath));

  if (!target.startsWith(root) || !existsSync(target) || statSync(target).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(response);
}

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  if (pathname.startsWith("/api/")) {
    handleApi(request, response, pathname).catch((error) => sendJson(response, 500, { error: String(error.message ?? error) }));
  } else {
    serveStatic(request, response, pathname);
  }
}).listen(port, async () => {
  const url = `http://localhost:${port}`;
  console.log(`Compass is running at ${url}`);
  openInBrowser(url);
  await store.load();
  console.log(`Loaded ${store.getAll().jobs.length} cached role(s) from disk`);

  const config = await loadConfig().catch(() => ({}));
  const intervalMinutes = config.refreshIntervalMinutes ?? 360;

  refreshAll()
    .then((result) => console.log(`Initial discovery refresh: ${result.jobs.length} role(s) pooled`))
    .catch((error) => console.error("Initial discovery refresh failed:", error.message ?? error));

  setInterval(() => {
    refreshAll()
      .then((result) => console.log(`Scheduled discovery refresh: ${result.jobs.length} role(s) pooled`))
      .catch((error) => console.error("Scheduled discovery refresh failed:", error.message ?? error));
  }, intervalMinutes * 60_000);
});
