"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BASE } from "@/components/api";
import { ScalePicker } from "@/components/ScalePicker";
import { ThemeToggle } from "@/components/Theme";
import { Check, Loader } from "@/components/Icons";
import { Plate } from "@/components/Brand";

type Item = { n: number; text: string };
type Meta = { name?: string; items?: Item[]; open?: { a: string; b: string }; error?: string };

const LABELS: Record<number, string> = { 1: "rarely", 2: "sometimes", 3: "about half the time", 4: "often", 5: "almost always" };
const KEY = (t: string) => `soul-peer-sent-${t}`;

/** The peer side of screen 10: ten 1–5 items, two short answers, one send. Nothing about the rater is kept. */
export default function PeerPage() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    try { if (localStorage.getItem(KEY(token))) setSent(true); } catch { /* private mode */ }
    fetch(`${BASE}/api/peer/${token}`, { cache: "no-store" }).then((r) => r.json()).then(setMeta).catch(() => setMeta({ error: "Could not load this link." }));
  }, [token]);

  const items = meta?.items ?? [];
  const missing = items.filter((i) => !answers[i.n]).length;
  const first = (meta?.name ?? "").split(" ")[0] || "them";

  const send = async () => {
    if (missing || sending) return;
    setSending(true); setErr("");
    try {
      const body = { answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v])), a: a.trim(), b: b.trim() };
      const r = await fetch(`${BASE}/api/peer/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Could not send.");
      try { localStorage.setItem(KEY(token), "1"); } catch { /* ignore */ }
      setSent(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not send."); }
    finally { setSending(false); }
  };

  return (
    <main className="mx-auto max-w-2xl">
      <header className="gutter flex items-center gap-2 pt-[max(8px,env(safe-area-inset-top))]">
        <h1 className="min-w-0 flex-1 truncate text-[var(--text-h2)]">Three minutes for {first}</h1>
        <ThemeToggle />
      </header>
      <Plate name="water" position="50% 40%" className="mt-2" />

      <div className="gutter safe-bottom flex flex-col gap-6 pt-4 pb-24">
        {!meta ? <p className="muted"><Loader /></p> : meta.error ? (
          <section className="card"><h2>{meta.error}</h2><p className="t-small muted mt-2">Ask {first} for a fresh link.</p></section>
        ) : sent ? (
          <section className="card flex flex-col gap-3 fade-in">
            <h2 className="flex items-center gap-2"><Check /> Sent. Thank you.</h2>
            <p className="t-small muted">Your answers went into {first}&apos;s Soul Map as the &quot;how others experience you&quot; layer. Nothing about who you are was recorded.</p>
          </section>
        ) : (
          <>
            <p className="t-small muted">{first} asked for a few outside views. Gut answers, no explanations. 1 = rarely, 5 = almost always. Nobody sees who answered.</p>

            {items.map((it, idx) => (
              <section key={it.n} className="card flex flex-col gap-3">
                <p className="flex gap-3"><span className="display shrink-0 text-[1.25rem] leading-6 text-[var(--color-accent)]">{idx + 1}</span><span>{it.text}</span></p>
                <ScalePicker max={5} labels={LABELS} value={answers[it.n] ?? null} onPick={(v) => setAnswers((s) => ({ ...s, [it.n]: v }))} />
              </section>
            ))}

            <section className="card flex flex-col gap-3">
              <label className="field-label" htmlFor="peer-a">{meta.open?.a ?? ""}</label>
              <textarea id="peer-a" className="field min-h-[3.25rem] resize-none" rows={2} maxLength={300} value={a} onChange={(e) => setA(e.target.value)} placeholder="One sentence is plenty." />
            </section>
            <section className="card flex flex-col gap-3">
              <label className="field-label" htmlFor="peer-b">{meta.open?.b ?? ""}</label>
              <textarea id="peer-b" className="field min-h-[3.25rem] resize-none" rows={2} maxLength={300} value={b} onChange={(e) => setB(e.target.value)} placeholder="Honest beats kind here." />
            </section>

            {err && <p className="t-small text-[var(--color-danger)]">{err}</p>}
            <button type="button" className="btn btn-primary btn-block" style={{ minHeight: 52 }} disabled={sending || missing > 0} onClick={send}>
              {sending ? <><Loader /> Sending</> : missing ? `${missing} left to answer` : "Send"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
