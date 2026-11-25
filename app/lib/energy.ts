/**
 * The Energy Audit. Three parts:
 *   1. Check-ins: after each major task the agent asks two questions, energy first:
 *      "How did this task affect your energy?" (0 = completely drained, 10 = fully alive, plus notes), then
 *      "What worked, what didn't, and how can I do better?"
 *   2. Background signals, gathered without asking anything: when and how long the person worked with their AI,
 *      late nights, meetings per day, corrections they made, and a sample of their own lines from the week.
 *   3. A weekly audit: what gave energy, what drained it, what the agent noticed, and small adjustments.
 *      Nothing changes on its own: each adjustment waits for the person's yes, no or added nuance. A yes files it
 *      as a correction (lib/corrections.ts), which every agent then follows.
 * Private to each person: stored in data/profiles/<id>/energy.json, never shown to the team.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { aiConfig, complete, SMALL_MODEL } from "./ai";
import { fileCorrection, parseCorrection } from "./corrections";
import { profileDir, readState } from "./state";

const ROOT = path.resolve(process.cwd(), "..");
const DAY = 24 * 3600_000;
/** Work with AI only: messages and email are personal and stay out of the audit. */
const AI_SOURCES = ["claude-code.jsonl", "claude-code-mac.jsonl", "claude-ai.jsonl", "chatgpt.jsonl"];
const TZ = process.env.SOUL_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

export type Checkin = { id: string; at: string; task: string; energy: number; notes?: string; feedback?: string; agent?: string };
export type Adjustment = { id: string; text: string; why?: string; status: "pending" | "yes" | "no"; nuance?: string; decided_at?: string };
export type Audit = {
  id: string; week_start: string; week_end: string; written_at: string; engine: string;
  gave_energy: { work: string; why: string }[];
  drained: { work: string; why: string }[];
  noticed: string[];
  adjustments: Adjustment[];
  based_on: { checkins: number; ai_hours: number; meetings: number };
};
type Store = { checkins: Checkin[]; audits: Audit[] };

const file = (id: string) => path.join(profileDir(id), "energy.json");
export async function readEnergy(id: string): Promise<Store> {
  try { const j = JSON.parse(await fs.readFile(file(id), "utf8")) as Partial<Store>; return { checkins: j.checkins ?? [], audits: j.audits ?? [] }; }
  catch { return { checkins: [], audits: [] }; }
}
async function writeEnergy(id: string, s: Store) {
  await fs.mkdir(profileDir(id), { recursive: true });
  await fs.writeFile(file(id), JSON.stringify(s, null, 2), { mode: 0o600 });
}

const rid = () => Math.random().toString(36).slice(2, 10);
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function addCheckin(id: string, input: Partial<Checkin>): Promise<Checkin> {
  const energy = Math.round(Number(input.energy));
  if (!Number.isFinite(energy) || energy < 0 || energy > 10) throw new Error("energy must be a number from 0 to 10");
  const c: Checkin = {
    id: rid(), at: new Date().toISOString(), task: clip(input.task, 200) || "Untitled task", energy,
    ...(clip(input.notes, 2000) ? { notes: clip(input.notes, 2000) } : {}),
    ...(clip(input.feedback, 2000) ? { feedback: clip(input.feedback, 2000) } : {}),
    ...(clip(input.agent, 60) ? { agent: clip(input.agent, 60) } : {}),
  };
  const s = await readEnergy(id);
  s.checkins.push(c);
  await writeEnergy(id, s);
  return c;
}

/* ---------- background signals: nothing asked of the person ---------- */

export type Signals = {
  ai: { days: number; sessions: number; hours: number; by_time: Record<"morning" | "afternoon" | "evening" | "late night", number>; late_nights: number; longest_session_h: number; weekend_hours: number };
  meetings: { total: number; busiest_day: string | null; busiest_count: number };
  corrections: string[];
  own_lines: string[];
};

const hourIn = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(d));
const dayIn = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const weekdayIn = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: TZ }).format(d);
const bucket = (h: number) => (h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 22 ? "evening" : "late night") as keyof Signals["ai"]["by_time"];

async function lines(p: string): Promise<{ ts: string; text: string }[]> {
  try {
    return (await fs.readFile(p, "utf8")).split("\n").flatMap((l) => {
      try { const j = JSON.parse(l) as { ts?: string; text?: string }; return j.ts && /^\d{4}-\d\d-\d\dT/.test(j.ts) ? [{ ts: j.ts, text: j.text ?? "" }] : []; } catch { return []; }
    });
  } catch { return []; }
}

export async function signals(id: string, since: Date, until = new Date()): Promise<Signals> {
  const cache = path.join(ROOT, "evidence", "cache", id);
  const names = await fs.readdir(cache).catch(() => [] as string[]);
  // The person's own lines with real timestamps (Claude Code and claude.ai), from the evidence cache the daily sync keeps.
  const own = (await Promise.all(names.filter((n) => AI_SOURCES.includes(n)).map((n) => lines(path.join(cache, n)))))
    .flat()
    .map((l) => ({ ...l, d: new Date(l.ts) }))
    .filter((l) => l.d >= since && l.d <= until)
    // The same session can arrive twice (a server's own copy and the one pushed from the Mac).
    .filter((l, i, all) => all.findIndex((x) => x.ts === l.ts && x.text === l.text) === i)
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  // Sessions: messages less than 45 minutes apart belong together; a lone message counts as 10 minutes.
  const sessions: { start: Date; end: Date }[] = [];
  for (const l of own) {
    const last = sessions[sessions.length - 1];
    if (last && l.d.getTime() - last.end.getTime() < 45 * 60_000) last.end = l.d;
    else sessions.push({ start: l.d, end: l.d });
  }
  const by_time = { morning: 0, afternoon: 0, evening: 0, "late night": 0 };
  let hours = 0, weekend = 0, longest = 0;
  const lateDays = new Set<string>();
  for (const s of sessions) {
    const h = Math.max(10 * 60_000, s.end.getTime() - s.start.getTime()) / 3600_000;
    hours += h; longest = Math.max(longest, h);
    by_time[bucket(hourIn(s.start))] += h;
    if (bucket(hourIn(s.start)) === "late night" || bucket(hourIn(s.end)) === "late night") lateDays.add(dayIn(s.start));
    if (["Sat", "Sun"].includes(weekdayIn(s.start))) weekend += h;
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;

  // Meetings: the archive files are named by date (YYYY-MM-DD-...).
  const perDay: Record<string, number> = {};
  for (const dir of names.filter((n) => n.endsWith("-meetings"))) {
    for (const f of await fs.readdir(path.join(cache, dir)).catch(() => [] as string[])) {
      const day = f.slice(0, 10);
      const d = new Date(day + "T12:00:00Z");
      if (!Number.isNaN(d.getTime()) && d >= new Date(since.getTime() - DAY / 2) && d <= until) perDay[day] = (perDay[day] ?? 0) + 1;
    }
  }
  const busiest = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0];

  const s = await readState(id).catch(() => null);
  const corrections = (s?.notes ?? []).map(parseCorrection).filter((c) => c && new Date(c.at) >= since).map((c) => c!.text.slice(0, 200));

  // A spread-out sample of the person's own words, for tone and what the work was. Never other people's words.
  const step = Math.max(1, Math.floor(own.length / 40));
  const sample = own.filter((_, i) => i % step === 0).slice(0, 40).map((l) => `[${weekdayIn(l.d)} ${String(hourIn(l.d)).padStart(2, "0")}h] ${l.text.replace(/\s+/g, " ").slice(0, 240)}`);

  return {
    ai: { days: new Set(sessions.map((x) => dayIn(x.start))).size, sessions: sessions.length, hours: r1(hours), by_time: Object.fromEntries(Object.entries(by_time).map(([k, v]) => [k, r1(v)])) as Signals["ai"]["by_time"], late_nights: lateDays.size, longest_session_h: r1(longest), weekend_hours: r1(weekend) },
    meetings: { total: Object.values(perDay).reduce((a, b) => a + b, 0), busiest_day: busiest?.[0] ?? null, busiest_count: busiest?.[1] ?? 0 },
    corrections,
    own_lines: sample,
  };
}

/* ---------- the weekly audit ---------- */

const SYSTEM = `You write a person's weekly Energy Audit. Goal: help them see which work gives them energy and which drains it, so over time they spend more of their week on work that fits how they are built.
Rules:
- Use only the data given. Check-ins (their own 0-10 energy ratings, 0 = completely drained, 10 = fully alive) are the strongest signal. Background signals (hours, time of day, late nights, meetings, corrections, the tone of their own lines) fill in where there are no check-ins; say "from the background signals" when that is the basis.
- Plain, direct words. Second person ("you"). No praise, no filler, no emoji.
- "noticed" holds habits and patterns: timing, pace, what tends to come before a low or high rating, what they keep correcting.
- "adjustments" are micro adjustments for next week: small, specific, testable in a week, each one sentence starting with a verb. At most 5. Do not repeat an adjustment the person said no to. Build on any nuance they added.
- Never mention other people by name.
Answer with JSON only, in this shape:
{"gave_energy":[{"work":"...","why":"..."}],"drained":[{"work":"...","why":"..."}],"noticed":["..."],"adjustments":[{"text":"...","why":"..."}]}`;

export async function writeAudit(id: string, now = new Date()): Promise<Audit> {
  const since = new Date(now.getTime() - 7 * DAY);
  const store = await readEnergy(id);
  const checkins = store.checkins.filter((c) => new Date(c.at) >= since);
  const sig = await signals(id, since, now);
  const past = store.audits.slice(-4).flatMap((a) => a.adjustments.filter((x) => x.status !== "pending").map((x) => ({ adjustment: x.text, answer: x.status, nuance: x.nuance ?? "" })));
  const user = JSON.stringify({
    week: { from: dayIn(since), to: dayIn(now), timezone: TZ },
    checkins: checkins.map((c) => ({ when: `${weekdayIn(new Date(c.at))} ${hourIn(new Date(c.at))}h`, task: c.task, energy: c.energy, notes: c.notes ?? "", feedback_for_the_ai: c.feedback ?? "" })),
    background: { ai_work: sig.ai, meetings: sig.meetings, corrections_they_made: sig.corrections, their_own_lines_sample: sig.own_lines },
    earlier_adjustments_and_answers: past,
  });
  const raw = await complete({ system: SYSTEM, user, maxTokens: 2500, json: true, timeoutMs: 240_000 });
  let j: Partial<{ gave_energy: Audit["gave_energy"]; drained: Audit["drained"]; noticed: string[]; adjustments: { text: string; why?: string }[] }> = {};
  try { j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new Error("The audit could not be written this time. Try again in a minute."); }
  const pairs = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => ({ work: clip((x as { work?: string }).work, 200), why: clip((x as { why?: string }).why, 400) })).filter((x) => x.work).slice(0, 6);
  const audit: Audit = {
    id: rid(), week_start: dayIn(since), week_end: dayIn(now), written_at: now.toISOString(), engine: await aiConfig().then((c) => (c.engine === "local" ? c.localModel : SMALL_MODEL)),
    gave_energy: pairs(j.gave_energy), drained: pairs(j.drained),
    noticed: (Array.isArray(j.noticed) ? j.noticed : []).map((x) => clip(x, 400)).filter(Boolean).slice(0, 6),
    adjustments: (Array.isArray(j.adjustments) ? j.adjustments : []).map((x) => ({ id: rid(), text: clip(x?.text, 300), why: clip(x?.why, 400), status: "pending" as const })).filter((x) => x.text).slice(0, 5),
    based_on: { checkins: checkins.length, ai_hours: sig.ai.hours, meetings: sig.meetings.total },
  };
  const fresh = await readEnergy(id);
  fresh.audits.push(audit);
  await writeEnergy(id, fresh);
  return audit;
}

/** Yes files the adjustment as a correction every agent follows; no is remembered so it is not suggested again. */
export async function decide(id: string, auditId: string, adjId: string, decision: "yes" | "no" | "nuance", nuance?: string) {
  const s = await readEnergy(id);
  const audit = s.audits.find((a) => a.id === auditId);
  const adj = audit?.adjustments.find((x) => x.id === adjId);
  if (!audit || !adj) throw new Error("That adjustment is gone. Reload the page.");
  const note = clip(nuance, 1000);
  if (note) adj.nuance = note;
  if (decision !== "nuance") { adj.status = decision; adj.decided_at = new Date().toISOString(); }
  await writeEnergy(id, s);
  if (decision === "yes") {
    await fileCorrection(id, { text: adj.text + (adj.nuance ? ` (${adj.nuance})` : ""), source: "energy-audit", rule: adj.text });
  }
  return adj;
}

/** For the report writer: the latest audit and the adjustments the person said yes to. */
export async function energyForReport(id: string) {
  const s = await readEnergy(id);
  const last = s.audits[s.audits.length - 1];
  if (!last && !s.checkins.length) return null;
  const recent = s.checkins.slice(-30);
  return {
    checkins: recent.length,
    average_energy: recent.length ? Math.round((recent.reduce((a, c) => a + c.energy, 0) / recent.length) * 10) / 10 : null,
    latest_audit: last ? { gave_energy: last.gave_energy, drained: last.drained, noticed: last.noticed } : null,
    adopted_adjustments: s.audits.flatMap((a) => a.adjustments.filter((x) => x.status === "yes").map((x) => x.text + (x.nuance ? ` (${x.nuance})` : ""))),
  };
}

/** True when a new weekly audit is due: a week since the last one, and something to write about. */
export async function auditDue(id: string, now = new Date()) {
  const s = await readEnergy(id);
  const last = s.audits[s.audits.length - 1];
  if (last && now.getTime() - new Date(last.written_at).getTime() < 7 * DAY - 3600_000) return false;
  const since = new Date(now.getTime() - 7 * DAY);
  if (s.checkins.some((c) => new Date(c.at) >= since)) return true;
  const sig = await signals(id, since, now);
  return sig.ai.sessions > 0 || sig.meetings.total > 0;
}
