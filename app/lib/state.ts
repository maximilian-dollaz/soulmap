import { promises as fs } from "node:fs";
import path from "node:path";
import { ALWAYS_ON_LENSES, LATER_LENSES, DEFAULT_PROFILE, defaultProfile, type Profile } from "./profile";

/**
 * Local-first state, one JSON file per person. Everything the interview
 * produces lands in ../data/profiles/<id>/state.json so the visual, the
 * scorers, the engine and the report generator all read one file. No database.
 * `data/state.json` (the single-user layout) is read as the default profile
 * until it is first written in the new place.
 */

export type Birth = {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h local)
  tz: string; // IANA
  place: string;
  lat?: number;
  lon?: number;
  time_confidence?: "exact" | "approx" | "unknown";
};

export type Answer = {
  item_id: string;
  section: "enneagram" | "attachment" | "kolbe" | "bigfive" | "working_genius" | "chronotype" | "values" | "drucker" | "wealth_dynamics" | "open";
  value: number | string;
  raw: string;
  at: string;
};

export type Turn = {
  role: "agent" | "user";
  content: string;
  mode: "voice" | "chat";
  session_id: string; // Retell call_id or chat_id
  at: string;
};

/** Everything the local interview engine needs to resume exactly where the person stopped. */
export type InterviewState = {
  session_id: string; // session id stamped on chat turns the local engine records
  skips: Record<string, number>; // item_id -> times skipped (1 = queued for the end of its section, 2 = final)
  intros_shown: string[]; // section keys whose intro was already said
  reopened: { item_id: string; previous: Answer | null } | null; // set by "back": asked next, answer pre-selected
  last_prompt: { item_id: string; kind: "item" | "clarify" } | null; // so polling /next never records the same agent turn twice
  clarifications: Record<string, number>; // item_id -> failed parses so far
  compact?: boolean; // "faster"/"shorter": no scale cues, no section chatter
};

export type SoulState = {
  profile: Profile;
  interview: InterviewState;
  status: "idle" | "in_call" | "in_chat" | "ended" | "complete" | "reported";
  call_id: string | null;
  chat_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  birth: Birth | null;
  chart: Record<string, unknown> | null; // output of hdcalc
  answers: Answer[];
  notes: string[]; // free-form things the person says that don't map to an item
  scores: Record<string, unknown> | null;
  turns: Turn[]; // the one continuous conversation, voice and chat interleaved
  transcript: string; // kept for older readers; rebuilt from turns
  override: Record<string, string>; // human overrides of any inferred preference
  peer_links?: PeerLink[]; // shareable peer-input tokens this person created
  peer_responses?: PeerResponse[]; // anonymous answers from teammates (never who answered)
};

/** A shareable peer-input link: anyone on the network who opens /peer/<token> rates this person. */
export type PeerLink = { token: string; created_at: string };
/** One teammate's answers. Stored on the OWNER's state; the rater is never recorded. */
export type PeerResponse = { at: string; answers: Record<string, number>; a: string; b: string };

/** `SOUL_DATA_DIR` overrides the location (tests, a second install); default is ../data next to the app. */
export function dataDir(): string {
  return process.env.SOUL_DATA_DIR ? path.resolve(process.env.SOUL_DATA_DIR) : path.resolve(process.cwd(), "..", "data");
}
export function profileDir(id: string): string { return path.join(dataDir(), "profiles", id); }
function stateFile(id: string): string { return path.join(profileDir(id), "state.json"); }
function legacyFile(): string { return path.join(dataDir(), "state.json"); }

export const EMPTY_INTERVIEW: InterviewState = { session_id: "local-chat", skips: {}, intros_shown: [], reopened: null, last_prompt: null, clarifications: {} };

export const EMPTY: SoulState = {
  profile: defaultProfile(DEFAULT_PROFILE),
  interview: { ...EMPTY_INTERVIEW },
  status: "idle",
  call_id: null,
  chat_id: null,
  started_at: null,
  ended_at: null,
  birth: null,
  chart: null,
  answers: [],
  notes: [],
  scores: null,
  turns: [],
  transcript: "",
  override: {},
};

export function transcriptText(turns: Turn[], name = "Me"): string {
  return turns.map((t) => `${t.role === "agent" ? "Agent" : name}: ${t.content}`).join("\n");
}

/** Replace every turn that belongs to one session with a fresh list (voice updates send the whole call each time). */
export function replaceSessionTurns(s: SoulState, sessionId: string, mode: Turn["mode"], fresh: { role: string; content: string }[]) {
  const keep = s.turns.filter((t) => t.session_id !== sessionId);
  const now = new Date().toISOString();
  const mine = fresh.filter((t) => t.content && t.content.trim()).map((t) => ({ role: (t.role === "agent" ? "agent" : "user") as Turn["role"], content: t.content.trim(), mode, session_id: sessionId, at: now }));
  s.turns = [...keep, ...mine];
  s.transcript = transcriptText(s.turns);
}

export function recentTranscript(s: SoulState, maxChars = 2500): string {
  const lines: string[] = [];
  let used = 0;
  for (const t of [...s.turns].reverse()) {
    const line = `${t.role === "agent" ? "Agent" : "Me"}: ${t.content}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines.join("\n");
}

/** A fresh, fully-populated state for one person (no file touched). */
export function emptyState(id: string = DEFAULT_PROFILE): SoulState {
  return { ...EMPTY, profile: defaultProfile(id), interview: { ...EMPTY_INTERVIEW, skips: {}, intros_shown: [], clarifications: {} }, answers: [], notes: [], turns: [], override: {} };
}

/** Fill in anything an older file lacks so every reader sees the full shape. */
function hydrate(id: string, raw: Partial<SoulState>): SoulState {
  const base = emptyState(id);
  const profile: Profile = { ...base.profile, ...(raw.profile ?? {}), id };
  if (!Array.isArray(profile.enabled_lenses) || !profile.enabled_lenses.length) profile.enabled_lenses = base.profile.enabled_lenses;
  // Lenses added later (LATER_LENSES) reach everyone who had every original always-on lens, so people who
  // finished before a new assessment existed get its questions; a profile deliberately limited to fewer lenses stays as it is.
  else if (ALWAYS_ON_LENSES.filter((l) => !LATER_LENSES.includes(l)).every((l) => profile.enabled_lenses.includes(l)))
    profile.enabled_lenses = [...profile.enabled_lenses, ...LATER_LENSES.filter((l) => !profile.enabled_lenses.includes(l))];
  const interview = { ...base.interview, ...(raw.interview ?? {}) };
  return { ...base, ...raw, profile, interview };
}

const locks = new Map<string, Promise<void>>();

/** Hosted demo: profiles live in a private Vercel Blob store instead of the Mac's filesystem. */
const BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
async function blobRead(id: string): Promise<Partial<SoulState> | null> {
  const { get } = await import("@vercel/blob");
  const r = await get(`profiles/${id}/state.json`, { access: "private", useCache: false });
  if (!r) return null;
  return JSON.parse(await new Response(r.stream).text()) as Partial<SoulState>;
}
async function blobWrite(id: string, s: SoulState): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(`profiles/${id}/state.json`, JSON.stringify({ ...s, profile: { ...s.profile, id } }), { access: "private", allowOverwrite: true, contentType: "application/json", addRandomSuffix: false });
}

export async function readState(id: string = DEFAULT_PROFILE): Promise<SoulState> {
  if (BLOB) {
    try { const raw = await blobRead(id); return raw ? hydrate(id, raw) : emptyState(id); } catch { return emptyState(id); }
  }
  try {
    return hydrate(id, JSON.parse(await fs.readFile(stateFile(id), "utf8")) as Partial<SoulState>);
  } catch { /* fall through */ }
  if (id === DEFAULT_PROFILE) {
    try { return hydrate(id, JSON.parse(await fs.readFile(legacyFile(), "utf8")) as Partial<SoulState>); } catch { /* no legacy file */ }
  }
  return emptyState(id);
}

export async function writeState(s: SoulState, id: string = s.profile?.id ?? DEFAULT_PROFILE): Promise<void> {
  if (BLOB) { await blobWrite(id, s); return; }
  await fs.mkdir(profileDir(id), { recursive: true });
  const file = stateFile(id);
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify({ ...s, profile: { ...s.profile, id } }, null, 2));
  await fs.rename(tmp, file);
}

/** Serialised read-modify-write per profile so concurrent tool calls don't clobber. */
export async function updateState(
  fn: (s: SoulState) => SoulState | void,
  id: string = DEFAULT_PROFILE,
): Promise<SoulState> {
  let out: SoulState = emptyState(id);
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(async () => {
    const s = await readState(id);
    const r = fn(s);
    out = r ?? s;
    await writeState(out, id);
  });
  locks.set(id, next.catch(() => undefined));
  await next;
  return out;
}

/** Every profile that has a state file on disk. */
export async function listProfiles(): Promise<string[]> {
  try {
    const names = await fs.readdir(path.join(dataDir(), "profiles"));
    return names.filter((n) => !n.startsWith(".")).sort();
  } catch { return []; }
}
