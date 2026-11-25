import { promises as fs } from "node:fs";
import path from "node:path";
import { complete } from "./ai";
import { readState } from "./state";
import { DEFAULT_PROFILE } from "./profile";

/**
 * The short soul file: the full agent file condensed to fit Claude's personal preferences box
 * (Settings > Profile) or ChatGPT's custom instructions. Those apply to every chat, so this is the
 * version that changes how someone's everyday AI treats them. Written once from SOUL-MAP-agent.md
 * and cached as SOUL-MAP-short.md next to it; rewritten whenever the report is.
 */
export const SHORT_LIMIT = 3000; // characters; fits Claude's personal preferences box
export const CHATGPT_BOX = 1500; // each of ChatGPT's two custom-instructions boxes

const SYSTEM = `You condense a person's soul file (operating instructions for their AI) into a short version that fits a settings box. Output markdown only, no preamble.

Hard limits: under ${SHORT_LIMIT} characters in total, about 420 words. Plain words, short sentences, no framework labels or brackets, no links, no dashes as punctuation, no emoji.

Every line is a trigger and an action the AI can follow ("When NAME plans a week, put building in the morning"), never a trait. Keep the most specific, personal lines; drop anything generic that any assistant would do anyway.

Use exactly these sections:
# NAME's soul file
(one line) For you, NAME's AI. Every line is a default; when NAME corrects you, the correction wins.
## Your role
Use this text, with the name filled in, word for word: "Act like an honest friend who is very capable. Help NAME work in line with who they are, and get better at serving them over time. You may say when there's a better way, when NAME is doing your work or asking you to do theirs, and when you see a pattern, kindly and once. At most one unasked observation per chat, never mid-flow. Truth over comfort, no flattery."
## Who does what
Checkable work (logic, structure, research, drafts, schedules, setup, anything undoable) is yours: do it, then report in one line. Judgment, taste, relationships and anything that can't be undone are NAME's. Then 3 bullets from the file: what to keep with them, what to take off their plate, how to come back to them for a decision.
## Protect NAME's thinking
Use this text, with the name filled in, word for word: "For judgment calls, ask NAME's first take before giving yours, then build on it. When they're learning, give a hint before the answer. Show your reasoning and what you're unsure of. Give the strongest case against the plan. Hand back decisions that are theirs. For checkable work, or when they're rushed, just do it."
## How to talk to NAME
4 to 5 bullets.
## NAME's day
2 to 3 bullets: their hours, and the rule to place tasks by them and ask "Energy today, 0 to 10?" when planning a day.
## Flags
3 of the most important "When NAME ..., say so in one line" lines.
## Getting better
Use this text, with the name filled in, word for word: "When NAME corrects you, apply it, then offer the exact line to add to this file. When you notice a preference this file doesn't have, ask once. When NAME plans a new week, offer a short list of what you learned about them."`;

export const shortPath = (dir: string) => path.join(dir, "SOUL-MAP-short.md");

export async function writeShort(dir: string, agentDoc: string, name: string): Promise<string> {
  const agent = agentDoc.trim();
  if (!agent) return "";
  const who = name || "this person";
  const ask = () => complete({ system: SYSTEM.replace(/NAME/g, who), user: `The soul file for ${who}:\n\n${agent}`, maxTokens: 1500, timeoutMs: 180_000 }).catch((e) => { console.error("short soul file:", e instanceof Error ? e.message : e); return ""; });
  // One retry: a brief API hiccup otherwise leaves the person with no short file on first open.
  let out = (await ask()) || (await ask());
  out = out.replace(/^```(?:markdown)?\s*|\s*```$/g, "").trim();
  if (!out) return "";
  await fs.writeFile(shortPath(dir), out + "\n");
  return out;
}

/** Cached short version, written on first request for reports made before it existed. */
export async function readShort(dir: string, agentDoc: string, profileId: string = DEFAULT_PROFILE): Promise<string> {
  try { return (await fs.readFile(shortPath(dir), "utf8")).trim(); } catch { /* not written yet */ }
  if (!agentDoc.trim()) return "";
  const s = await readState(profileId).catch(() => null);
  return writeShort(dir, agentDoc, s?.profile.name ?? "");
}

/**
 * ChatGPT's custom instructions are two boxes of 1,500 characters each: how ChatGPT should respond, and
 * what it should know about the person. The short file is split across them; cached as SOUL-MAP-chatgpt.json.
 */
export type ChatGPTFile = { respond: string; about: string };
export const chatgptPath = (dir: string) => path.join(dir, "SOUL-MAP-chatgpt.json");

const CHATGPT_SYSTEM = `You split a person's soul file (instructions for their AI) into ChatGPT's two custom-instructions boxes. Output JSON only: {"respond": "...", "about": "..."}.

"respond" answers "How would you like ChatGPT to respond?": the AI's role, protecting their thinking, how to talk to them, flags, and how to get better. Keep the "protect their thinking" lines.
"about" answers "What should ChatGPT know about you?": their day and energy, who does what, what they're best at and what drains them.

Hard limit: each value under ${CHATGPT_BOX - 100} characters, counted exactly. Plain text with short "- " bullets, no headings, no markdown bold, no links, no emoji. Write to the AI as "you" and name the person. Keep the most specific, personal lines; drop generic ones.`;

function fit(t: string, max: number): string {
  t = t.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  return (nl > max * 0.6 ? cut.slice(0, nl) : cut).trim();
}

export async function writeChatGPT(dir: string, short: string, name: string): Promise<ChatGPTFile | null> {
  if (!short.trim()) return null;
  const who = name || "this person";
  const ask = () => complete({ system: CHATGPT_SYSTEM, user: `The soul file for ${who}:\n\n${short}`, maxTokens: 1500, json: true, timeoutMs: 180_000 }).catch(() => "");
  for (let i = 0; i < 2; i++) {
    const raw = (await ask()).replace(/^```(?:json)?\s*|\s*```$/g, "");
    try {
      const j = JSON.parse(raw) as Partial<ChatGPTFile>;
      if (j.respond && j.about) {
        const out = { respond: fit(j.respond, CHATGPT_BOX), about: fit(j.about, CHATGPT_BOX) };
        await fs.writeFile(chatgptPath(dir), JSON.stringify(out, null, 2) + "\n");
        return out;
      }
    } catch { /* retry once */ }
  }
  return null;
}

export async function readChatGPT(dir: string, short: string, profileId: string = DEFAULT_PROFILE): Promise<ChatGPTFile | null> {
  try { return JSON.parse(await fs.readFile(chatgptPath(dir), "utf8")) as ChatGPTFile; } catch { /* not written yet */ }
  if (!short.trim()) return null;
  const s = await readState(profileId).catch(() => null);
  return writeChatGPT(dir, short, s?.profile.name ?? "");
}
