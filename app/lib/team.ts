import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir, listProfiles, readState } from "./state";
import { DEFAULT_PROFILE } from "./profile";

const ROOT = path.resolve(process.cwd(), "..");
const reportDir = (id: string) => (id === DEFAULT_PROFILE ? path.join(ROOT, "report") : path.join(ROOT, "report", "profiles", id));
async function readIf(p: string) { try { return await fs.readFile(p, "utf8"); } catch { return ""; } }

export type TeamCard = { id: string; name: string; card: string | null };

/**
 * Only the "How to work with <name>" section of the human report leaves the team route (SPEC, Visibility).
 * The report prompt makes it a required `## How to work with {{NAME}}` subsection, so that exact heading is
 * tried first; any heading containing "how to work with" (or a bold line of that shape) is accepted as well.
 * The section runs to the next heading of the same or higher level. Never anything else: no section, no card.
 */
export function extractCard(human: string, name = ""): string | null {
  const lines = human.split("\n");
  const heading = (l: string) => l.match(/^(#{1,6})\s+(.*)$/);
  const wanted = `how to work with ${name}`.trim().toLowerCase();
  const exact = name ? lines.findIndex((l) => { const m = heading(l); return !!m && m[2].trim().toLowerCase() === wanted; }) : -1;
  const start = exact >= 0 ? exact : lines.findIndex((l) => !!heading(l) && /how to work with/i.test(l));
  if (start >= 0) {
    const level = (lines[start].match(/^#+/) ?? ["#"])[0].length;
    const out: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const m = heading(lines[i]);
      if (m && m[1].length <= level) break;
      out.push(lines[i]);
    }
    const body = out.join("\n").trim();
    if (body) return body;
  }
  const bold = lines.findIndex((l) => /^\*\*.*how to work with.*\*\*/i.test(l));
  if (bold >= 0) {
    const out: string[] = [];
    for (let i = bold + 1; i < lines.length; i++) { if (heading(lines[i])) break; out.push(lines[i]); }
    const body = out.join("\n").trim();
    if (body) return body;
  }
  return null;
}

/** Everyone who consented and has a report. Returns { id, name, card } and nothing else; `card` is null until the section exists. */
export async function teamCards(): Promise<TeamCard[]> {
  const team: TeamCard[] = [];
  for (const id of await listProfiles()) {
    const s = await readState(id);
    if (!s.profile.consent_at) continue;
    const human = await readIf(path.join(reportDir(id), "SOUL-MAP-human.md"));
    if (!human.trim()) continue;
    team.push({ id, name: s.profile.name, card: extractCard(human, s.profile.name) });
  }
  return team;
}

/* ---------- cards from people on other Macs: pasted in by the person, kept on this install ---------- */

export type SharedCard = { id: string; name: string; card: string; added_at: string; added_by: string };
const sharedFile = () => path.join(dataDir(), "shared-cards.json");

export async function sharedCards(): Promise<SharedCard[]> {
  try { return JSON.parse(await fs.readFile(sharedFile(), "utf8")) as SharedCard[]; } catch { return []; }
}

/** A card copied from someone's Soul Map: "How to work with <name>" on the first line, then their bullets. */
export function parseSharedCard(text: string): { name: string; card: string } | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const first = lines.findIndex((l) => /how to work with/i.test(l));
  if (first < 0) return null;
  const name = lines[first].replace(/^[#*\s]*how to work with\s*/i, "").replace(/[*:#]+$/g, "").trim().slice(0, 60);
  const body = lines.slice(first + 1).filter((l) => !/^—?\s*from the soul map/i.test(l.trim())).join("\n").trim().slice(0, 4000);
  if (!name || !body) return null;
  return { name, card: body };
}

export async function addSharedCard(text: string, addedBy: string): Promise<SharedCard> {
  const parsed = parseSharedCard(text);
  if (!parsed) throw new Error("Paste the whole card, starting with the line \"How to work with ...\".");
  const all = (await sharedCards()).filter((c) => c.name.toLowerCase() !== parsed.name.toLowerCase());
  const c: SharedCard = { id: "shared-" + Math.random().toString(36).slice(2, 10), ...parsed, added_at: new Date().toISOString(), added_by: addedBy };
  all.push(c);
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(sharedFile(), JSON.stringify(all, null, 2), { mode: 0o600 });
  return c;
}

export async function removeSharedCard(id: string) {
  await fs.writeFile(sharedFile(), JSON.stringify((await sharedCards()).filter((c) => c.id !== id), null, 2), { mode: 0o600 });
}
