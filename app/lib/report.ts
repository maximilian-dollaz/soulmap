import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readState, updateState } from "./state";
import { scoreAll } from "./score";
import { DEFAULT_PROFILE } from "./profile";
import { summarize as summarizePeers } from "./peer";
import { energyForReport } from "./energy";
import { withCheckin } from "./checkin";
import { chatgptPath, shortPath, writeChatGPT, writeShort } from "./soul-short";

const ROOT = path.resolve(process.cwd(), "..");
/** The default profile keeps report/ as before; anyone else gets report/profiles/<id>/. */
export const reportDir = (id: string) => (id === DEFAULT_PROFILE ? path.join(ROOT, "report") : path.join(ROOT, "report", "profiles", id));

async function readIf(p: string) { try { return await fs.readFile(p, "utf8"); } catch { return ""; } }

/**
 * Compiles everything into two markdown documents, written by the chosen engine (lib/ai.ts):
 *   report/SOUL-MAP-human.md  — for the person (and, as one card, their team)
 *   report/SOUL-MAP-agent.md  — loaded by every AI agent
 */
export async function generateReport(profileId: string = DEFAULT_PROFILE): Promise<{ human: string; agent: string }> {
  const REPORT_DIR = reportDir(profileId);
  const s = await readState(profileId);
  if (s.status !== "complete" && s.status !== "reported") throw new Error("The interview is not finished yet. Finish it (the interviewer marks it complete), then build.");
  const scores = scoreAll(s);
  await updateState((st) => { st.scores = scores; }, profileId);

  // Per SPEC the writer only receives summarized, structured evidence (no raw text, no third-party words).
  // Evidence is per person: evidence/out/<id>/summary.json, or the flat evidence/out/summary.json only when it names this person.
  let evidence = await readIf(path.join(ROOT, "evidence", "out", profileId, "summary.json"));
  if (!evidence) {
    const flat = await readIf(path.join(ROOT, "evidence", "out", "summary.json"));
    try { if (flat && (JSON.parse(flat) as { person?: string }).person === profileId) evidence = flat; } catch { /* ignore */ }
  }
  const workingStyle = evidence || "(no behavioral evidence yet)";
  const meetings = "(included in the summarized evidence above when present)";
  const claudeAi = "(included in the summarized evidence above when present)";
  const template = await fs.readFile(path.join(ROOT, "analysis", "report-prompt.md"), "utf8");
  const standingRules = await standingRulesFor(profileId, s.notes);

  const input = {
    birth: s.birth,
    chart: s.chart,
    scores,
    overrides: s.override,
    notes: s.notes,
    answers: s.answers.map((a) => ({ id: a.item_id, section: a.section, value: a.value })),
    person: { name: s.profile.name, intention: s.profile.intention ?? null, birth_time_known: s.profile.birth_time_known },
    // Peer averages (items 2 and 7 already reverse-keyed) plus the two short open answers, each capped at 300 chars (PEER-INPUT.md).
    peer: summarizePeers(s.peer_responses),
    // Energy Audit: check-in average, the latest weekly audit, and the adjustments the person said yes to.
    energy_audit: await energyForReport(profileId).catch(() => null),
    // No transcript and no raw answer text: the writer receives structured inputs only (SPEC, Synthesis).
  };

  const name = s.profile.name || "this person";
  const lensNames: Record<string, string> = { human_design: "Human Design", gene_keys: "Gene Keys", enneagram: "Enneagram", attachment: "attachment style", bigfive: "Big Five", chronotype: "chronotype", values: "Schwartz values", drucker: "Drucker (how you perform, learn, value, belong and contribute)", wealth_dynamics: "Wealth Dynamics (how you create value)", kolbe: "Kolbe A", working_genius: "Working Genius" };
  const lenses = (s.profile.enabled_lenses ?? []).map((l) => lensNames[l] ?? l).join(", ");
  const prompt = template
    .replace(/\{\{NAME\}\}/g, name)
    .replace(/\{\{INTENTION\}\}/g, s.profile.intention || "not stated")
    .replace(/\{\{LENSES\}\}/g, lenses || "the completed lenses")
    .replace("{{INPUT_JSON}}", JSON.stringify(input, null, 1))
    .replace("{{STANDING_RULES}}", standingRules || "(none recorded)")
    .replace("{{WORKING_STYLE_LLM}}", workingStyle || "(not available)")
    .replace("{{WORKING_STYLE_MEETINGS}}", meetings || "(not available)")
    .replace("{{WORKING_STYLE_CLAUDE_AI}}", claudeAi || "(not available)");

  const out = await runClaude(prompt, process.env.REPORT_MODEL ?? "opus");

  const marker = "=====AGENT VERSION=====";
  const [human, agent] = out.includes(marker) ? out.split(marker) : [out, ""];
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "SOUL-MAP-human.md"), human.trim() + "\n");
  await fs.writeFile(path.join(REPORT_DIR, "SOUL-MAP-agent.md"), agent.trim() + "\n");
  await fs.writeFile(path.join(REPORT_DIR, "scores.json"), JSON.stringify(scores, null, 2));
  // The short soul file (for Claude's preferences box) follows the agent file; drop the old one first so a failed rewrite is redone on next read.
  await fs.rm(shortPath(REPORT_DIR), { force: true });
  await fs.rm(chatgptPath(REPORT_DIR), { force: true });
  const short = await writeShort(REPORT_DIR, agent, name).catch(() => "");
  if (short) await writeChatGPT(REPORT_DIR, short, name).catch(() => null);
  await updateState((st) => { st.status = "reported"; }, profileId);
  if (profileId === DEFAULT_PROFILE) await mirrorToLibrary(name, human.trim(), withCheckin(agent)).catch(() => {});
  return { human: human.trim(), agent: agent.trim() };
}

/**
 * The owner's soul file in Recall: soul/soul (agent version every agent loads) and soul/map (human version).
 * Written through Recall's gbrain server as the `cl` client, so the page is indexed and the server owns the file
 * (a file dropped into library/ by hand is refused as "canonical_path_occupied"). Without the server, the file
 * is written in place for the next backfill.
 */
const LIBRARY_SOUL = process.env.SOUL_LIBRARY_DIR ?? path.join(ROOT, "..", "context-library", "library", "soul");
async function mirrorToLibrary(name: string, human: string, agent: string) {
  const day = new Date().toISOString().slice(0, 10);
  const fm = (title: string, type: string) => `---\ntitle: "${title}"\ntype: ${type}\nperson: ${DEFAULT_PROFILE}\nshelf: soul\nstate: done\nupdated: ${day}\n---\n\n`;
  const pages: [string, string][] = [
    ["soul", fm(`soul.md: ${name}`, "soul") + "> How to work with " + name + ". Written by the Soul Map from the full assessment, chart and evidence. Standing rules and corrections: `soul/rules.md`.\n\n" + agent + "\n"],
    ["map", fm(`The Soul Map: ${name}`, "profile") + human + "\n"],
  ];
  const home = process.env.HOME ?? "";
  const gbrain = path.join(home, ".bun", "bin", "gbrain");
  let secret = "";
  try { secret = (JSON.parse(await fs.readFile(path.join(home, ".gbrain", "serve", "clients", "cl.json"), "utf8")) as { client_secret?: string }).client_secret ?? ""; } catch { /* no server credentials */ }
  for (const [slug, content] of pages) {
    const ok = secret && await new Promise<boolean>((resolve) => {
      const child = spawn(gbrain, ["put", `soul/${slug}`, "--force", "--request-id", crypto.randomUUID(), "--content-origin", "inferred"], {
        env: { ...process.env, GBRAIN_HOME: path.join(home, ".gbrain", "serve", "cl-home"), GBRAIN_REMOTE_CLIENT_SECRET: secret },
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
      child.stdin.end(content);
    });
    if (!ok) await fs.writeFile(path.join(LIBRARY_SOUL, `${slug}.md`), content).catch(() => {});
  }
}

/**
 * The person's own rules for working with them: the owner's rules.md in Recall (sections A to E: how to
 * communicate, how to work, hard gates, decisions and energy, asking), plus every correction filed through
 * the Soul API. These win over the questionnaire defaults in the soul file.
 */
async function standingRulesFor(profileId: string, notes: string[]): Promise<string> {
  const parts: string[] = [];
  if (profileId === DEFAULT_PROFILE) {
    const rules = await readIf(path.join(LIBRARY_SOUL, "rules.md"));
    const a = rules.search(/^## A\./m), f = rules.search(/^## F\./m);
    if (a >= 0) parts.push(rules.slice(a, f > a ? f : undefined).trim());
  }
  const corrections = notes.filter((n) => n.startsWith("[correction ")).slice(-40).map((n) => {
    try { const j = JSON.parse(n.slice(n.indexOf("] ") + 2)) as { text?: string; rule?: string }; return `- ${j.rule || j.text}`; } catch { return ""; }
  }).filter(Boolean);
  if (corrections.length) parts.push("Corrections, newest last:\n" + corrections.join("\n"));
  return parts.join("\n\n").slice(0, 8000);
}

export async function readReports(profileId: string = DEFAULT_PROFILE) {
  const REPORT_DIR = reportDir(profileId);
  return {
    human: await readIf(path.join(REPORT_DIR, "SOUL-MAP-human.md")),
    agent: withCheckin(await readIf(path.join(REPORT_DIR, "SOUL-MAP-agent.md"))),
  };
}

import { aiConfig, claudeClient, ollamaUrl, REPORT_MODELS } from "./ai";

/**
 * Report writer, on the engine chosen in onboarding (lib/ai.ts): Claude Opus 5.5 on the person's key
 * (about $0.20 a report), or the local model. REPORT_WRITER=local forces local.
 */
async function runClaude(prompt: string, model: string): Promise<string> {
  const cfg = await aiConfig();
  if (process.env.REPORT_WRITER === "local" || cfg.engine === "local") return runLocal(prompt, cfg.localModel);
  if (cfg.engine !== "claude") throw new Error("Choose who writes the report first: Settings, then Claude or this Mac.");
  const client = await claudeClient();
  const stream = client.beta.messages.stream({
    model: REPORT_MODELS[model || "opus"] ?? model,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: prompt }],
  } as never);
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The report writer declined this request.");
  return msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
}

/** Small local models ignore "two documents in one answer", so the local path asks for each document separately. */
async function runLocal(prompt: string, model: string): Promise<string> {
  const one = async (instruction: string, maxTokens: number) => {
    const body: Record<string, unknown> = { model, stream: false, options: { temperature: 0.4, num_predict: maxTokens }, messages: [{ role: "user", content: prompt + "\n\n" + instruction }] };
    if (model.startsWith("qwen3")) body.think = false;
    const res = await fetch(`${ollamaUrl()}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`local writer failed: ${res.status}`);
    const j = (await res.json()) as { message: { content: string } };
    return j.message.content.trim();
  };
  // A small local model needs the outline spelled out, or it writes about missing data instead of the person.
  const rules = "Lead every result with what it practically means for how this person lives and works, and put the framework label after it in brackets; never open with the label. End each result with three lines: For you, For your team, For your AI, each one concrete behavior. Use only what the input shows; where a source is empty, leave it out silently. Never write that data is missing. Plain words, short sentences, no emoji, no tables, no dashes as punctuation.";
  const human = await one(`WRITE ONLY DOCUMENT 1 NOW (the person's own report), in markdown, with exactly these sections:
# The Soul Map: <name>
## 1. In one breath (three sentences)
## 2. Your design (Human Design: type and strategy, decision style, profile, open centers and what each one makes you absorb, built-in talents from the channels, and the life theme from the incarnation cross in a full paragraph: the contribution it points to, its four gates as four parts of one job, the work that lets it run and the work that fights it; each with a "You'll likely recognize this if" line)
## 3. Your gifts (Gene Keys: for Life's Work, Evolution, Radiance and Purpose, the shadow, the gift and how each shows up in a real working situation; then \"Orienting for creative flow\" with three short lists: You, Your team, Your AI, each four concrete behaviors)
## 4. How you work best (from scores.drucker, Drucker's five questions: how you perform (reader or listener, what you want first, how reports should reach you, where you work best); how you learn (scores.drucker.learning is the way most of their remembered fast-learning moments came in, count of of, and slow is what didn't stick); what you value (mirror test, the clash they named); where you belong; what you should contribute in the next 18 months; end with four bullets on how to brief you)
## 5. How you create value (from scores.wealth_dynamics: the profile in plain words, the two strongest energies, the work to hand off, the partners who complement them, the roles that fit)
## 6. What drives you (top values, Enneagram, attachment)
## 7. How you work best (Big Five, chronotype, strengths)
## 8. Where you get stuck (two or three patterns, each with one thing to try)
## 9. How to work with you (five bullets for teammates)
${rules} Treat Human Design and Gene Keys as maps from birth data to check against experience; never use the words cosmic, divine, universe, aura, vibration or destiny. Do not write Document 2.`, 7000);
  const agent = await one(`WRITE ONLY DOCUMENT 2 NOW: instructions an AI agent follows when working with this person. Address the agent directly ("Lead with...", "Ask before..."). Markdown, exactly these sections, three to six bullets each:
# Working with <name>: agent instructions
## Profile summary
## How information reaches them (reader or listener, what comes first, length, format, medium, how to teach them something new)
## Contribution (the 18-month contribution, their mirror test, what crosses their values)
## Communication
## Structuring work
## Decision support
## Energy guardrails
## People
## Iteration protocol (one bullet: when the person corrects you, apply it and prefer it over this file)
${rules} Do not write Document 1.`, 2500);
  return human + "\n=====AGENT VERSION=====\n" + agent;
}
