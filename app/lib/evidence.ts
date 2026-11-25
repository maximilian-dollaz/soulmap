import { spawn, execFile } from "node:child_process";
import { aiEnv } from "./ai";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { profileDir } from "./state";

/**
 * Evidence uploads (SPEC, "AI-session evidence" and ux-flows screen 11). A person uploads an
 * export; it is saved under data/profiles/<id>/uploads/, the local evidence CLI imports and
 * scores it with the chosen model (lib/ai.ts), and the raw upload is deleted once the job ends. Only
 * numbers and short scrubbed paraphrases remain, in evidence/out/<id>/summary.json, which the
 * report writer reads (lib/report.ts).
 */
const ROOT = path.resolve(process.cwd(), "..");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const UV = process.env.UV_BIN ?? `${process.env.HOME}/.local/bin/uv`;
const run = promisify(execFile);

export const SOURCES = ["claude-ai", "chatgpt", "claude-code", "granola", "otter", "imessage", "whatsapp", "email"] as const;
export type Source = (typeof SOURCES)[number];
export type JobState = "queued" | "running" | "done" | "failed";
export type Job = { id: string; source: Source | "sync"; file: string; started_at: string; finished_at?: string; state: JobState; error?: string; pid?: number };
type JobsFile = { jobs: Job[] };

export type Summary = {
  person: string;
  generated_at: string;
  sources: Record<string, { windows: number; turns_scored?: number }>;
  dimensions: Record<string, { mean: number | null; spread: number; per_source: Record<string, number>; flag: string }>;
  observations: Record<string, string[]>;
  caveats: string[];
};

export const outDir = (id: string) => path.join(EVIDENCE_DIR, "out", id);
const uploadsDir = (id: string) => path.join(profileDir(id), "uploads");
const jobsFile = (id: string) => path.join(profileDir(id), "evidence.json");
const logFile = (id: string) => path.join(profileDir(id), "evidence.log");

export function isSource(s: unknown): s is Source { return typeof s === "string" && (SOURCES as readonly string[]).includes(s); }

async function readJobs(id: string): Promise<Job[]> {
  try { return ((JSON.parse(await fs.readFile(jobsFile(id), "utf8")) as JobsFile).jobs ?? []); } catch { return []; }
}
async function writeJobs(id: string, jobs: Job[]) {
  await fs.mkdir(profileDir(id), { recursive: true });
  await fs.writeFile(jobsFile(id), JSON.stringify({ jobs } satisfies JobsFile, null, 2));
}
/** Serialised read-modify-write: the upload route and the job's exit handler both touch the file. */
let chain: Promise<unknown> = Promise.resolve();
function updateJob(id: string, jobId: string, patch: Partial<Job>) {
  const next = chain.then(async () => {
    const jobs = await readJobs(id);
    const j = jobs.find((x) => x.id === jobId);
    if (j) Object.assign(j, patch);
    await writeJobs(id, jobs);
  });
  chain = next.catch(() => {});
  return next;
}

function alive(pid?: number): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Jobs, newest first. A job left "running" by a server restart is reported as failed. */
export async function listJobs(id: string): Promise<Job[]> {
  const jobs = await readJobs(id);
  let changed = false;
  for (const j of jobs) {
    if ((j.state === "running" || j.state === "queued") && !alive(j.pid)) {
      j.state = "failed"; j.error = "interrupted (the app restarted while it ran); upload it again"; j.finished_at = new Date().toISOString(); changed = true;
    }
  }
  if (changed) await writeJobs(id, jobs);
  return jobs.map(({ pid: _pid, ...rest }) => rest).sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export async function readSummary(id: string): Promise<Summary | null> {
  try { return JSON.parse(await fs.readFile(path.join(outDir(id), "summary.json"), "utf8")) as Summary; } catch { return null; }
}

function shellQuote(s: string): string { return "'" + s.replace(/'/g, "'\\''") + "'"; }

export type ImportStep = { source: Source; file: string; speaker?: string };

/** `uv run evidence import ...` for one step. */
function importCmd(id: string, step: ImportStep): string {
  const speakerArg = step.speaker ? ` --speaker ${shellQuote(step.speaker)}` : "";
  return `${shellQuote(UV)} run evidence import --source ${shellQuote(step.source)} --file ${shellQuote(step.file)} --person ${shellQuote(id)}${speakerArg}`;
}
/** `score` (which also writes the summary) then an explicit `summary`, for every cached source. */
function scoreCmd(id: string, maxWindows: number): string {
  const uv = shellQuote(UV), out = shellQuote(outDir(id)), who = shellQuote(id);
  return `${uv} run evidence score --person ${who} --max-windows ${Math.max(1, Math.floor(maxWindows))} --out-dir ${out} && ${uv} run evidence summary --person ${who} --out-dir ${out}`;
}

type SpawnOpts = { cleanup?: () => Promise<void>; onDone?: (ok: boolean) => Promise<void>; recorded?: boolean };

function recordJob(id: string, job: Job) {
  const next = chain.then(async () => { const jobs = await readJobs(id); jobs.push(job); await writeJobs(id, jobs); });
  chain = next.catch(() => {});
  return next;
}

/** Record the job, run `cmd` detached with its output in evidence.log, and mark the job when it exits. */
async function spawnJob(id: string, job: Job, cmd: string, opts: SpawnOpts = {}): Promise<Job> {
  if (!opts.recorded) await recordJob(id, job);
  await fs.appendFile(logFile(id), `\n=== ${job.started_at} job ${job.id} ${job.source} ${job.file}\n`);
  const log = await fs.open(logFile(id), "a");
  const child = spawn("/bin/sh", ["-c", cmd], {
    cwd: EVIDENCE_DIR,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    env: { ...process.env, ...(await aiEnv()), PATH: `${path.dirname(UV)}:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}` },
  });
  child.unref();
  await log.close();
  job.pid = child.pid;
  job.state = "running";
  await updateJob(id, job.id, { pid: child.pid, state: "running" });

  const finish = async (ok: boolean, error?: string) => {
    await opts.cleanup?.().catch(() => {});
    await updateJob(id, job.id, { state: ok ? "done" : "failed", finished_at: new Date().toISOString(), ...(error ? { error } : {}) });
    await opts.onDone?.(ok).catch(() => {});
  };
  child.on("error", (e) => { void finish(false, e.message); });
  child.on("exit", (code, signal) => {
    if (code === 0) { void finish(true); return; }
    void lastStderr(id).then((tail) => finish(false, tail || `exited with ${code ?? signal}`));
  });
  const { pid: _pid, ...visible } = job;
  return visible;
}

/** Save the upload and start the import -> score -> summary job in the background. Returns the queued job. */
export async function startJob(id: string, source: Source, name: string, bytes: Uint8Array, speaker?: string): Promise<Job> {
  const jobId = crypto.randomUUID();
  const safeName = (path.basename(name) || "upload").replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const dir = uploadsDir(id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${jobId}-${safeName}`);
  await fs.writeFile(file, bytes);
  const job: Job = { id: jobId, source, file: safeName, started_at: new Date().toISOString(), state: "queued" };
  const cmd = `${importCmd(id, { source, file, speaker })} && ${scoreCmd(id, 12)}`;
  // The raw upload is deleted whatever the outcome (SPEC: raw uploads deleted after processing).
  return spawnJob(id, job, cmd, { cleanup: () => fs.rm(file, { force: true }) });
}

/**
 * A connector sync (lib/connectors.ts): import every step from where the data already lives on this
 * Mac (nothing is copied), then score and summarize once. `label` names the connectors, for the job list.
 */
export async function startSyncJob(id: string, steps: ImportStep[], label: string, maxWindows: number, onDone?: (ok: boolean) => Promise<void>): Promise<Job> {
  if (!steps.length) throw new Error("nothing to sync");
  const job: Job = { id: crypto.randomUUID(), source: "sync", file: label, started_at: new Date().toISOString(), state: "queued" };
  const cmd = [...steps.map((s) => importCmd(id, s)), scoreCmd(id, maxWindows)].join(" && ");
  return spawnJob(id, job, cmd, { onDone });
}

/**
 * A sync whose import steps are only known after a slow fetch (Otter/Granola over MCP, lib/remote-connectors.ts).
 * The job is recorded at once against this server's pid, so the page shows it running; `prepare` fetches and
 * returns the steps, then the usual import -> score -> summary runs under the same job id.
 */
export async function startPreparedSyncJob(id: string, label: string, maxWindows: number, prepare: () => Promise<{ steps: ImportStep[]; note?: string }>, onDone?: (ok: boolean) => Promise<void>): Promise<Job> {
  const job: Job = { id: crypto.randomUUID(), source: "sync", file: label, started_at: new Date().toISOString(), state: "running", pid: process.pid };
  await recordJob(id, job);
  await fs.appendFile(logFile(id), `\n=== ${job.started_at} job ${job.id} sync ${label} (fetching)\n`).catch(() => {});
  void (async () => {
    let r: { steps: ImportStep[]; note?: string };
    try { r = await prepare(); }
    catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await fs.appendFile(logFile(id), `fetch failed: ${error}\n`).catch(() => {});
      await updateJob(id, job.id, { state: "failed", finished_at: new Date().toISOString(), error: error.slice(0, 240) });
      await onDone?.(false).catch(() => {});
      return;
    }
    if (r.note) await fs.appendFile(logFile(id), r.note + "\n").catch(() => {});
    if (!r.steps.length) {
      await updateJob(id, job.id, { state: "done", finished_at: new Date().toISOString(), file: `${label}: nothing new` });
      await onDone?.(true).catch(() => {});
      return;
    }
    const cmd = [...r.steps.map((s) => importCmd(id, s)), scoreCmd(id, maxWindows)].join(" && ");
    await spawnJob(id, job, cmd, { onDone, recorded: true });
  })();
  const { pid: _pid, ...visible } = job;
  return visible;
}

/** True while an import/score job for this person is still running. */
export async function hasActiveJob(id: string): Promise<boolean> {
  return (await listJobs(id)).some((j) => j.state === "running" || j.state === "queued");
}

/** The most useful line from the end of the job log, for the job's error field. */
async function lastStderr(id: string): Promise<string> {
  try {
    const text = await fs.readFile(logFile(id), "utf8");
    const lines = text.trimEnd().split("\n").slice(-8).filter((l) => l.trim() && !l.startsWith("==="));
    const hit = lines.find((l) => /failed|error|nothing to score|no scored|not found|Traceback/i.test(l)) ?? lines[lines.length - 1] ?? "";
    return hit.trim().slice(0, 240);
  } catch { return ""; }
}

/** Delete everything the pipeline holds for this person: cache, scored output, uploads, job list, log. */
export async function purge(id: string): Promise<void> {
  try { await run(UV, ["run", "evidence", "purge", "--person", id, "--out", "--out-dir", outDir(id)], { cwd: EVIDENCE_DIR }); } catch { /* cache may not exist; the rm below covers out/ */ }
  await fs.rm(path.join(EVIDENCE_DIR, "cache", id.toLowerCase()), { recursive: true, force: true });
  await fs.rm(outDir(id), { recursive: true, force: true });
  await fs.rm(uploadsDir(id), { recursive: true, force: true });
  await fs.rm(jobsFile(id), { force: true });
  await fs.rm(logFile(id), { force: true });
}
