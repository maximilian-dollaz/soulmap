import { NextResponse } from "next/server";
import { addSharedCard, removeSharedCard, sharedCards, teamCards } from "@/lib/team";
import { profileIdFrom } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The team view: for each consented person with a report on this install, only { id, name, card }; plus the
 * cards people on other Macs sent and were pasted in here (`shared: true`).
 * POST { text } adds a pasted card; DELETE { id } removes one.
 */
export async function GET() {
  const local = await teamCards();
  const shared = (await sharedCards()).map((c) => ({ id: c.id, name: c.name, card: c.card, shared: true }));
  return NextResponse.json({ team: [...local, ...shared] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { text?: string };
  try { return NextResponse.json({ ok: true, card: await addSharedCard(String(b.text ?? ""), profileIdFrom(req)) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "could not add" }, { status: 400 }); }
}

export async function DELETE(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string };
  if (!b.id?.startsWith("shared-")) return NextResponse.json({ error: "only pasted cards can be removed here" }, { status: 400 });
  await removeSharedCard(b.id);
  return NextResponse.json({ ok: true });
}
