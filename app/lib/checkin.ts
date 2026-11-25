/**
 * The energy check-in every agent runs (lib/energy.ts). Appended to the soul file wherever it is read,
 * so it reaches Claude Code, claude.ai, ChatGPT and the rest without rewriting the report.
 * SOUL_PUBLIC_URL is where the person opens the app (for example https://recall.example.com/soul);
 * a Mac install falls back to its local address.
 */
export function appUrl(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return (process.env.SOUL_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3355}${base}`).replace(/\/$/, "");
}

export const CHECKIN_HEADING = "## Energy check-in (every major task)";

export function checkinProtocol(url = appUrl()): string {
  return `${CHECKIN_HEADING}
A major task is anything with several steps or more than about 15 minutes of work. For each one, ask these two questions as soon as its main piece works, before the wrap-up, final checks or summary, so they get asked even if the session ends early. In a long task, ask at the midpoint milestone instead. Once per task. Never interrupt a thought; skip quick questions and one-line fixes. Use the two questions word for word. When the whole task is one reply, put them right after the work and before any summary or offer.

1. "How did this task affect your energy? 0 is completely drained, 10 is fully alive."
2. "What worked, what didn't, and how can I do better?"

Give this link with the task filled in, so they can answer with a slider and add notes: ${url}/energy?task=<the task in a few words, URL-encoded>&agent=<your name>
If they answer in chat, log it yourself when you can reach the app: POST ${url}/api/energy with JSON {"task","energy" (0-10),"notes","feedback","agent"}. Otherwise send the link with their answer.
Use their feedback for the rest of this session. Do not change standing behavior from one answer: lasting changes come from the weekly Energy Audit, and only the ones the person approves.`;
}

/** The soul file plus the check-in, unless it already has one. */
export function withCheckin(agentDoc: string): string {
  const doc = agentDoc.trim();
  if (!doc || doc.includes(CHECKIN_HEADING)) return doc;
  return `${doc}\n\n${checkinProtocol()}`;
}
