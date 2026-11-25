import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { profileIdFrom } from "@/lib/profile";
import { reportDir } from "@/lib/report";
import { readChatGPT, readShort } from "@/lib/soul-short";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The short soul file for Claude's preferences box (and, with ?for=chatgpt, ChatGPT's two boxes); written on first request. */
export async function GET(req: Request) {
  const id = profileIdFrom(req);
  const dir = reportDir(id);
  const agent = await fs.readFile(path.join(dir, "SOUL-MAP-agent.md"), "utf8").catch(() => "");
  if (!agent.trim()) return NextResponse.json({ short: "", chatgpt: null });
  const short = await readShort(dir, agent, id);
  const chatgpt = new URL(req.url).searchParams.get("for") === "chatgpt" ? await readChatGPT(dir, short, id) : null;
  return NextResponse.json({ short, chatgpt });
}
