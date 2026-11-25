/**
 * Which model does the thinking on this install, chosen once during onboarding:
 *   claude  Anthropic's Claude on the person's own API key. Haiku 5.5 for the small calls (story answers,
 *           speaker matching, evidence scoring), Opus 5.5 for the report. Nothing to download.
 *   local   Ollama on this Mac (scripts/local-model.sh installs it). Nothing leaves the Mac.
 * Stored in data/settings.json (mode 600, never committed). Before anyone has chosen, an ANTHROPIC_API_KEY
 * in the environment means claude and a SOUL_LOCAL_MODEL means local. The hosted demo always uses claude.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { dataDir } from "./state";

export type Engine = "claude" | "local";
type Settings = { engine?: Engine; anthropic_key?: string; local_model?: string; personal_engine?: Engine };

export const SMALL_MODEL = "claude-haiku-5-5";
export const REPORT_MODELS: Record<string, string> = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" };
const HOSTED = process.env.NEXT_PUBLIC_HOSTED === "1";

const file = () => path.join(dataDir(), "settings.json");
async function read(): Promise<Settings> {
  if (HOSTED) return {};
  try { return JSON.parse(await fs.readFile(file(), "utf8")) as Settings; } catch { return {}; }
}
export async function saveAiSettings(patch: Settings) {
  const next = { ...(await read()), ...patch };
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
}

export type AiConfig = { engine: Engine | null; key?: string; localModel: string; chosen: boolean; personalEngine: Engine };
export async function aiConfig(): Promise<AiConfig> {
  const s = await read();
  const key = s.anthropic_key || process.env.ANTHROPIC_API_KEY || undefined;
  const localModel = s.local_model || process.env.SOUL_LOCAL_MODEL || "qwen3:8b";
  // SOUL_FORCE_ENGINE=local runs a test copy on the free local model whatever the settings say.
  const forced = process.env.SOUL_FORCE_ENGINE === "local" ? "local" : null;
  const engine: Engine | null = forced ?? (HOSTED ? "claude" : s.engine ?? (key ? "claude" : process.env.SOUL_LOCAL_MODEL ? "local" : null));
  // Messages and email are scored on this Mac unless the person allowed Claude for them too.
  const personalEngine: Engine = s.personal_engine === "claude" ? "claude" : "local";
  return { engine: engine === "claude" && !key ? null : engine, key, localModel, chosen: !!s.engine || HOSTED, personalEngine };
}

export async function claudeClient(): Promise<Anthropic> {
  const { key } = await aiConfig();
  if (!key) throw new Error("No Anthropic API key. Add one in Settings, or switch to the local model.");
  return new Anthropic({ apiKey: key });
}

/** Rejects a key Anthropic does not accept, so onboarding can say so before saving it. */
export async function checkKey(key: string): Promise<string | null> {
  try { await new Anthropic({ apiKey: key }).models.retrieve(SMALL_MODEL); return null; }
  catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return "Anthropic did not accept that key.";
    if (e instanceof Anthropic.PermissionDeniedError) return "That key cannot use Claude yet. Check billing in the Anthropic Console.";
    if (e instanceof Anthropic.APIConnectionError) return "Could not reach Anthropic. Check the internet connection.";
    return e instanceof Error ? e.message : "Could not check the key.";
  }
}

export const ollamaUrl = () => (process.env.SOUL_OLLAMA_URL ?? process.env.OLLAMA_URL ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/v1\/?$/, "").replace(/\/api\/chat$/, "").replace(/\/$/, "");
const thinks = (model: string) => /^(qwen3|deepseek-r1|gpt-oss|magistral)/i.test(model);

/**
 * One short completion on whichever engine is chosen. Resolves to "" when no engine is set up, so callers
 * fall back the way they did when the local model was off.
 */
export async function complete(o: { system?: string; user: string; maxTokens: number; json?: boolean; timeoutMs?: number }): Promise<string> {
  const cfg = await aiConfig();
  const signal = AbortSignal.timeout(o.timeoutMs ?? 60_000);
  if (cfg.engine === "claude") {
    const client = await claudeClient();
    const msg = await client.messages.create({
      model: SMALL_MODEL,
      max_tokens: Math.max(o.maxTokens, 1024),
      output_config: { effort: "low" },
      ...(o.system ? { system: o.system } : {}),
      messages: [{ role: "user", content: o.user }],
    } as Anthropic.MessageCreateParamsNonStreaming, { signal });
    if (msg.stop_reason === "refusal") return "";
    return msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  }
  if (cfg.engine === "local") {
    const body: Record<string, unknown> = {
      model: cfg.localModel, stream: false, ...(o.json ? { format: "json" } : {}),
      options: { temperature: 0, num_predict: o.maxTokens },
      messages: [...(o.system ? [{ role: "system", content: o.system }] : []), { role: "user", content: o.user }],
    };
    if (thinks(cfg.localModel)) body.think = false;
    const res = await fetch(`${ollamaUrl()}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!res.ok) return "";
    const j = (await res.json()) as { message?: { content?: string } };
    return (j.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }
  return "";
}

/** Environment for the Python evidence scorer, so it scores with the same engine. */
export async function aiEnv(): Promise<Record<string, string>> {
  const cfg = await aiConfig();
  const local = { SOUL_LOCAL_MODEL: cfg.localModel, OLLAMA_URL: `${ollamaUrl()}/api/chat`, SOUL_PERSONAL_ENGINE: cfg.personalEngine };
  return cfg.engine === "claude" && cfg.key
    ? { ...local, SOUL_ENGINE: "claude", ANTHROPIC_API_KEY: cfg.key, SOUL_CLAUDE_MODEL: SMALL_MODEL }
    : { ...local, SOUL_ENGINE: "local" };
}

/** Local model status for the settings screen: is Ollama answering, and is the model pulled. */
export async function localStatus(model: string): Promise<{ running: boolean; installed: boolean }> {
  try {
    const r = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const j = (await r.json()) as { models?: { name: string }[] };
    return { running: true, installed: !!j.models?.some((m) => m.name === model || m.name === `${model}:latest`) };
  } catch { return { running: false, installed: false }; }
}
