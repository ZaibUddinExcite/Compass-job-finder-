import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeJobs } from "./normalize.mjs";

const DEFAULT_PATH = fileURLToPath(new URL("./data/roles-cache.json", import.meta.url));

/**
 * In-memory pool, mirrored to a JSON file so a restart doesn't start from
 * empty. Deliberately not a database: this is a personal, single-user tool,
 * and the whole pool is small enough (dozens to low hundreds of roles) to
 * hold in memory and serialise directly.
 */
export function createStore(path = DEFAULT_PATH) {
  let jobs = [];
  let lastRefreshedAt = null;
  let sourceHealth = {};

  async function load() {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      lastRefreshedAt = parsed.lastRefreshedAt ?? null;
      sourceHealth = parsed.sourceHealth ?? {};
    } catch {
      jobs = [];
      lastRefreshedAt = null;
      sourceHealth = {};
    }
    return { jobs, lastRefreshedAt, sourceHealth };
  }

  async function save() {
    await mkdir(dirname(path), { recursive: true });
    const payload = JSON.stringify({ lastRefreshedAt, sourceHealth, jobs }, null, 2);
    await writeFile(path, payload, "utf8");
  }

  /**
   * Replace the pool with a fresh set of jobs (already de-duplicated within
   * this refresh) merged against jobs already on file, so a source that's
   * temporarily down doesn't wipe out roles it previously found.
   */
  async function replaceFresh(freshJobsBySource, health) {
    const stillFreshSources = new Set(Object.keys(freshJobsBySource));
    const keptFromDisk = jobs.filter((job) => !stillFreshSources.has(job.source));
    const incoming = Object.values(freshJobsBySource).flat();
    jobs = dedupeJobs([...incoming, ...keptFromDisk]).sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
    lastRefreshedAt = new Date().toISOString();
    sourceHealth = { ...sourceHealth, ...health };
    await save();
    return { jobs, lastRefreshedAt, sourceHealth };
  }

  function getAll() {
    return { jobs, lastRefreshedAt, sourceHealth };
  }

  function getById(id) {
    return jobs.find((job) => job.id === id) ?? null;
  }

  return { load, replaceFresh, getAll, getById };
}
