import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { hasActiveJob, startPreparedSyncJob, startSyncJob, type ImportStep, type Job } from "./evidence";
import { isRemoteId, pullMeetings, remoteInbox, remoteStatus, type RemoteId } from "./remote-connectors";
import type { ConnectorPref } from "./profile";
import { readState, updateState } from "./state";

/**
 * Connectors: evidence sources that connect on their own on the Mac install, instead of by upload.
 * Each one knows where its data already lives on this Mac and hands the local evidence CLI a path;
 * nothing is copied and nothing leaves the machine (lib/evidence.ts does the import -> score -> summary).
 *
 *   claude_code  ~/.claude/projects/** /*.jsonl, read in place (the claude-code importer takes a folder)
 *   granola      one click: sign in to Granola's MCP server (lib/remote-connectors.ts); falls back to
 *                Granola's local cache, ~/Library/Application Support/Granola/cache-v*.json, if present
 *   claude_ai    the export zip Anthropic emails, once it lands in ~/Downloads; taken in once, by hash
 *   otter        one click: sign in to Otter's MCP server; each sync fetches new meetings into
 *                evidence/cache/<id>/otter-meetings/ (the /soul-otter-sync skill can still drop files there)
 *   imessage     ~/Library/Messages/chat.db, read in place; needs Full Disk Access          } personal: off until
 *   whatsapp     WhatsApp for Mac's ChatStorage.sqlite, read in place                        } the person turns them
 *   email        an .mbox in ~/Downloads (Google Takeout Mail, or Apple Mail's Export Mailbox) } on; only what they sent
 * Personal sources are scored on the local model unless the person allows Claude for them (lib/ai.ts).
 */
const run = promisify(execFile);
/** The hosted demo has no Mac to connect to; connectors are off there. */
export const HOSTED = process.env.NEXT_PUBLIC_HOSTED === "1";
const HOME = os.homedir();
const ROOT = path.resolve(process.cwd(), "..");
const EVIDENCE_DIR = path.join(ROOT, "evidence");

export const CONNECTOR_IDS = ["claude_code", "granola", "claude_ai", "otter", "imessage", "whatsapp", "email"] as const;
/** Messages and email: off until the person turns them on. */
export const PERSONAL_CONNECTORS: readonly ConnectorId[] = ["imessage", "whatsapp", "email"];
export const isEnabled = (cid: ConnectorId, pref?: ConnectorPref) => pref?.enabled ?? !PERSONAL_CONNECTORS.includes(cid);
export type ConnectorId = (typeof CONNECTOR_IDS)[number];
export const isConnectorId = (s: unknown): s is ConnectorId => typeof s === "string" && (CONNECTOR_IDS as readonly string[]).includes(s);

/** How the UI should talk about the connector's state. */
export type ConnectorMode = "auto" | "one_click" | "claude_code" | "missing" | "connect" | "permission";

export type ConnectorStatus = {
  id: ConnectorId;
  name: string;
  /** A sync would import something right now. */
  available: boolean;
  mode: ConnectorMode;
  detail: string;
  enabled: boolean;
  last_sync?: string;
  items?: number;
  /** One-click OAuth connectors: signed in, and as whom. */
  connected?: boolean;
  account?: string;
  /** Messages and email: off by default, scored on this Mac unless allowed otherwise. */
  personal?: boolean;
};

/** What a sync of this connector would import; null when there is nothing. */
type Probe = { status: Omit<ConnectorStatus, "enabled" | "last_sync">; step?: ImportStep; mark?: string; remote?: RemoteId };

/** The Otter meeting archive (lib/remote-connectors.ts); the /soul-otter-sync skill drops files there too. */
export const otterInbox = (id: string) => remoteInbox(id, "otter");

async function exists(p: string): Promise<boolean> { try { await fs.access(p); return true; } catch { return false; } }

async function probeClaudeCode(): Promise<Probe> {
  const dir = path.join(HOME, ".claude", "projects");
  const name = "Claude Code";
  if (!(await exists(dir))) return { status: { id: "claude_code", name, available: false, mode: "missing", detail: "No ~/.claude/projects on this Mac." } };
  let projects = 0, files = 0;
  const walk = async (d: string, depth: number) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) { if (e.name !== "subagents" && depth < 4) await walk(path.join(d, e.name), depth + 1); }
      else if (e.name.endsWith(".jsonl")) files++;
    }
  };
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) { projects++; await walk(path.join(dir, e.name), 1); }
  if (!files) return { status: { id: "claude_code", name, available: false, mode: "missing", detail: "No sessions in ~/.claude/projects yet." } };
  return {
    status: { id: "claude_code", name, available: true, mode: "auto", detail: `${projects} project folder${projects === 1 ? "" : "s"}, ${files} session file${files === 1 ? "" : "s"}, read in place.`, items: files },
    step: { source: "claude-code", file: dir },
  };
}

async function probeGranola(id: string): Promise<Probe> {
  const name = "Granola";
  const r = await remoteStatus(id, "granola");
  if (r.connected) return {
    status: { id: "granola", name, available: true, mode: "auto", connected: true, account: r.account, detail: `Signed in${r.account ? ` as ${r.account}` : ""}. Each sync fetches your new meetings; only what you said is kept.` },
    step: { source: "granola", file: remoteInbox(id, "granola") }, remote: "granola",
  };
  const dir = path.join(HOME, "Library", "Application Support", "Granola");
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => /^cache-v\d+\.json$/.test(n));
  if (!names.length) return { status: { id: "granola", name, available: false, mode: "connect", connected: false, detail: "Tap Connect and sign in to Granola. Nothing else to set up." } };
  // Newest cache version wins; Granola has bumped the file name as its format changed.
  names.sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  const file = path.join(dir, names[0]);
  const st = await fs.stat(file);
  return {
    status: { id: "granola", name, available: true, mode: "auto", connected: false, detail: `${names[0]}, updated ${st.mtime.toLocaleDateString()}; only what you said (your microphone) is kept. Connect to sign in instead.` },
    step: { source: "granola", file },
  };
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

/** A Claude.ai export: a zip with conversations.json whose records carry chat_messages (ChatGPT's carry mapping). */
async function isClaudeExport(file: string): Promise<boolean> {
  try {
    const { stdout: listing } = await run("unzip", ["-Z1", file], { maxBuffer: 1 << 20 });
    const entry = listing.split("\n").find((n) => n.endsWith("conversations.json"));
    if (!entry) return false;
    const { stdout } = await run("sh", ["-c", `unzip -p ${JSON.stringify(file)} ${JSON.stringify(entry)} | head -c 4000`], { maxBuffer: 1 << 16 });
    return stdout.trimStart().startsWith("[") && stdout.includes('"chat_messages"');
  } catch { return false; }
}

async function probeClaudeAi(pref: ConnectorPref | undefined): Promise<Probe> {
  const dir = path.join(HOME, "Downloads");
  const name = "Claude.ai";
  const ingested = new Set(pref?.ingested ?? []);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const zips: { file: string; mtime: number }[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".zip")) continue;
    const file = path.join(dir, e.name);
    const st = await fs.stat(file).catch(() => null);
    if (st && st.size > 0) zips.push({ file, mtime: st.mtimeMs });
  }
  zips.sort((a, b) => b.mtime - a.mtime);
  let seen = 0;
  for (const z of zips) {
    if (!(await isClaudeExport(z.file))) continue;
    seen++;
    const hash = await sha256(z.file);
    if (ingested.has(hash)) continue;
    return {
      status: { id: "claude_ai", name, available: true, mode: "auto", detail: `${path.basename(z.file)} is waiting in Downloads; the next sync takes it in once.`, items: 1 },
      step: { source: "claude-ai", file: z.file },
      mark: hash,
    };
  }
  const how = "Request it at claude.ai, Settings, Privacy, Export data; the zip Anthropic emails is picked up from Downloads.";
  return { status: { id: "claude_ai", name, available: false, mode: "one_click", detail: seen ? `Your export in Downloads is already in. ${how}` : how } };
}

async function probeOtter(id: string): Promise<Probe> {
  const name = "Otter";
  const r = await remoteStatus(id, "otter");
  if (r.connected) return {
    status: { id: "otter", name, available: true, mode: "auto", connected: true, account: r.account, detail: `Signed in${r.account ? ` as ${r.account}` : ""}. Each sync fetches your new meetings, works out which speaker is you on this Mac, and keeps only your lines.` },
    step: { source: "otter", file: otterInbox(id) }, remote: "otter",
  };
  const files = (await fs.readdir(otterInbox(id)).catch(() => [])).filter((n) => /\.(txt|md|srt)$/i.test(n));
  if (files.length) return {
    status: { id: "otter", name, available: true, mode: "connect", connected: false, detail: `${files.length} transcript${files.length === 1 ? "" : "s"} waiting. Tap Connect to sign in to Otter so new meetings come in on their own.`, items: files.length },
    step: { source: "otter", file: otterInbox(id) },
  };
  return { status: { id: "otter", name, available: false, mode: "connect", connected: false, detail: "Tap Connect and sign in to Otter. Nothing else to set up." } };
}

/** Can this process read the file? macOS answers EPERM until the app has Full Disk Access. */
async function readable(file: string): Promise<"ok" | "missing" | "blocked"> {
  try { const fh = await fs.open(file, "r"); await fh.read(Buffer.alloc(16), 0, 16, 0); await fh.close(); return "ok"; }
  catch (e) { const code = (e as NodeJS.ErrnoException).code; return code === "ENOENT" ? "missing" : "blocked"; }
}
const FDA = `macOS needs your permission first: open System Settings, Privacy & Security, Full Disk Access, tap +, press Command-Shift-G, paste ${process.execPath} and turn it on. Then tap Sync now.`;

async function probeImessage(): Promise<Probe> {
  const name = "iMessage";
  const file = path.join(HOME, "Library", "Messages", "chat.db");
  const r = await readable(file);
  if (r === "missing") return { status: { id: "imessage", name, available: false, mode: "missing", detail: "Messages has no history on this Mac.", personal: true } };
  if (r === "blocked") return { status: { id: "imessage", name, available: false, mode: "permission", detail: FDA, personal: true } };
  return { status: { id: "imessage", name, available: true, mode: "auto", detail: "Reads only the messages you sent, on this Mac. Nobody else's words are kept.", personal: true }, step: { source: "imessage", file } };
}

async function probeWhatsapp(): Promise<Probe> {
  const name = "WhatsApp";
  const file = path.join(HOME, "Library", "Group Containers", "group.net.whatsapp.WhatsApp.shared", "ChatStorage.sqlite");
  const r = await readable(file);
  if (r === "missing") return { status: { id: "whatsapp", name, available: false, mode: "missing", detail: "Install WhatsApp for Mac and sign in; its history on this Mac is what gets read.", personal: true } };
  if (r === "blocked") return { status: { id: "whatsapp", name, available: false, mode: "permission", detail: FDA, personal: true } };
  return { status: { id: "whatsapp", name, available: true, mode: "auto", detail: "Reads only the messages you sent, from WhatsApp for Mac, on this Mac. Nobody else's words are kept.", personal: true }, step: { source: "whatsapp", file } };
}

/** The newest .mbox in Downloads (or inside a folder there, as Google Takeout unpacks), taken in once. */
async function probeEmail(pref: ConnectorPref | undefined): Promise<Probe> {
  const name = "Email";
  const dl = path.join(HOME, "Downloads");
  const found: { file: string; mtime: number; size: number }[] = [];
  const walk = async (d: string, depth: number) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && depth < 4) await walk(f, depth + 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".mbox")) { const st = await fs.stat(f).catch(() => null); if (st?.size) found.push({ file: f, mtime: st.mtimeMs, size: st.size }); }
      // Apple Mail exports a folder named <mailbox>.mbox holding a file called mbox.
      else if (e.isFile() && e.name === "mbox" && d.toLowerCase().endsWith(".mbox")) { const st = await fs.stat(f).catch(() => null); if (st?.size) found.push({ file: f, mtime: st.mtimeMs, size: st.size }); }
    }
  };
  await walk(dl, 1);
  found.sort((a, b) => b.mtime - a.mtime);
  const how = "Export your mail: Google Takeout (takeout.google.com, choose only Mail) or in Apple Mail, Mailbox, Export Mailbox on your Sent folder. Put the .mbox in Downloads.";
  const ingested = new Set(pref?.ingested ?? []);
  for (const f of found) {
    const mark = `${path.basename(f.file)}:${f.size}:${Math.round(f.mtime)}`;
    if (ingested.has(mark)) continue;
    return { status: { id: "email", name, available: true, mode: "auto", detail: `${path.basename(path.dirname(f.file)) === "Downloads" ? path.basename(f.file) : path.basename(path.dirname(f.file))} is in Downloads. Only mail you sent is read, on this Mac; replies you quoted are cut.`, items: 1, personal: true }, step: { source: "email", file: f.file }, mark };
  }
  return { status: { id: "email", name, available: false, mode: "one_click", detail: found.length ? `Your mail export is already in. ${how}` : how, personal: true } };
}

async function probe(cid: ConnectorId, id: string, pref: ConnectorPref | undefined): Promise<Probe> {
  switch (cid) {
    case "imessage": return probeImessage();
    case "whatsapp": return probeWhatsapp();
    case "email": return probeEmail(pref);
    case "claude_code": return probeClaudeCode();
    case "granola": return probeGranola(id);
    case "claude_ai": return probeClaudeAi(pref);
    case "otter": return probeOtter(id);
  }
}

/** Status of every connector for one person. */
export async function connectorStatuses(id: string): Promise<ConnectorStatus[]> {
  const prefs = (await readState(id)).profile.connectors ?? {};
  return Promise.all(CONNECTOR_IDS.map(async (cid) => {
    const pref = prefs[cid];
    const p = await probe(cid, id, pref);
    return { ...p.status, enabled: isEnabled(cid, pref), last_sync: pref?.last_sync };
  }));
}

export async function setConnector(id: string, cid: ConnectorId, enabled: boolean): Promise<ConnectorPref> {
  const s = await updateState((st) => {
    const all = st.profile.connectors ?? {};
    all[cid] = { ...(all[cid] ?? { enabled: true }), enabled };
    st.profile.connectors = all;
  }, id);
  return s.profile.connectors![cid];
}

export type SyncResult = { job?: Job; synced: ConnectorId[]; skipped: { id: ConnectorId; why: string }[] };

/**
 * Import every requested (default: every enabled) connector that has something, then score and
 * summarize once. One detached job; when it ends, each connector's last_sync is stamped and a
 * Claude.ai export is remembered by hash so it is never taken in twice.
 */
export async function syncConnectors(id: string, ids: ConnectorId[] | undefined, maxWindows: number): Promise<SyncResult> {
  if (await hasActiveJob(id)) throw new Error("a sync or upload is already running for this person");
  const state = await readState(id);
  const prefs = state.profile.connectors ?? {};
  const speaker = state.profile.name;
  const mailSpeaker = `${state.profile.name ?? ""}|${state.profile.email ?? ""}`;
  const wanted = ids?.length ? ids : [...CONNECTOR_IDS];
  const steps: ImportStep[] = [];
  const synced: ConnectorId[] = [];
  const marks: Partial<Record<ConnectorId, string>> = {};
  const remotes = new Set<RemoteId>();
  const skipped: SyncResult["skipped"] = [];
  for (const cid of wanted) {
    const pref = prefs[cid];
    if (!ids?.length && !isEnabled(cid, pref)) { skipped.push({ id: cid, why: "off" }); continue; }
    const p = await probe(cid, id, pref);
    if (!p.step) { skipped.push({ id: cid, why: p.status.detail }); continue; }
    steps.push({ ...p.step, speaker: cid === "email" ? mailSpeaker : speaker });
    synced.push(cid);
    if (p.mark) marks[cid] = p.mark;
    if (p.remote) remotes.add(p.remote);
  }
  if (!steps.length) return { synced, skipped };
  const onDone = async (ok: boolean) => {
    if (!ok) return;
    const now = new Date().toISOString();
    await updateState((st) => {
      const all = st.profile.connectors ?? {};
      for (const cid of synced) {
        const cur = all[cid] ?? { enabled: true };
        const ingested = marks[cid] ? [...new Set([...(cur.ingested ?? []), marks[cid]!])].slice(-20) : cur.ingested;
        all[cid] = { ...cur, last_sync: now, ...(ingested ? { ingested } : {}) };
      }
      st.profile.connectors = all;
    }, id);
  };
  const remote = synced.filter(isRemoteId).filter((cid) => remotes.has(cid));
  if (!remote.length) {
    const job = await startSyncJob(id, steps, synced.join(", "), maxWindows, onDone);
    return { job, synced, skipped };
  }
  // Otter/Granola: fetch new meetings first (slow), then import whatever landed in each inbox.
  const job = await startPreparedSyncJob(id, synced.join(", "), maxWindows, async () => {
    const notes: string[] = [];
    const fresh = new Set<RemoteId>();
    for (const cid of remote) {
      const r = await pullMeetings(id, cid, prefs[cid]?.last_sync, speaker, [state.profile.name, state.profile.email?.split("@")[0] ?? ""].filter(Boolean));
      // New meetings, or an archive the evidence cache has not taken in yet (an earlier import failed).
      const newest = Math.max(0, ...(await Promise.all((await fs.readdir(remoteInbox(id, cid)).catch(() => [] as string[])).map((f) => fs.stat(path.join(remoteInbox(id, cid), f)).then((x) => x.mtimeMs, () => 0)))));
      const cached = await fs.stat(path.join(EVIDENCE_DIR, "cache", id.toLowerCase(), `${cid}.jsonl`)).then((x) => x.mtimeMs, () => 0);
      if (r.files || newest > cached) fresh.add(cid);
      notes.push(`${cid}: ${r.files} new meetings with your voice (${r.total ?? r.files} in all), ${r.kept} new lines of yours${r.notes.length ? `; skipped: ${r.notes.join("; ")}` : ""}${r.picks?.length ? `\n  you were: ${r.picks.join("\n  you were: ")}` : ""}`);
    }
    const ready: ImportStep[] = [];
    for (const st of steps) {
      // A meeting source with nothing new is not re-imported or re-scored.
      if ((st.source === "otter" || st.source === "granola") && !fresh.has(st.source)) continue;
      ready.push(st);
    }
    return { steps: ready, note: notes.join("\n") };
  }, onDone);
  return { job, synced, skipped };
}
