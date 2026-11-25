"use client";

import { useEffect, useState } from "react";
import { api, personId, useHref } from "@/components/api";
import { Markdown } from "@/components/Markdown";
import { ThemeToggle } from "@/components/Theme";
import { ArrowLeft, Check, Copy, Loader, Trash } from "@/components/Icons";

type Card = { id: string; name: string; card: string | null; shared?: boolean };

/**
 * One "how to work with" card per person, the viewer's own first. Never the full report.
 * People on other Macs share theirs by copying it; pasting it here adds it to this Team page.
 */
export default function TeamPage() {
  const h = useHref();
  const [team, setTeam] = useState<Card[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  const load = () => api<{ team?: Card[] }>("/api/team").then((j) => setTeam(j.team ?? [])).catch(() => setTeam([]));
  useEffect(() => {
    load();
    api<{ profile?: { id?: string } }>("/api/live").then((j) => setMe(j.profile?.id ?? personId())).catch(() => setMe(personId()));
  }, []);

  const ordered = team ? [...team].sort((x, y) => (x.id === me ? -1 : y.id === me ? 1 : x.name.localeCompare(y.name))) : [];
  const mine = ordered.find((c) => c.id === me && c.card);

  const copyMine = async () => {
    if (!mine?.card) return;
    const text = `How to work with ${mine.name}\n\n${mine.card}\n\n— from the Soul Map (soulmap.nextmissionsi.com)`;
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const add = async () => {
    setAdding(true); setErr("");
    const j = await api<{ error?: string }>("/api/team", { method: "POST", json: { text: paste } }).catch(() => ({ _status: 500, error: "Could not reach the Soul Map." }));
    setAdding(false);
    if (j._status !== 200) { setErr(j.error ?? "Could not add it."); return; }
    setPaste(""); load();
  };

  const remove = async (id: string) => { await api("/api/team", { method: "DELETE", json: { id } }).catch(() => {}); load(); };

  return (
    <main className="mx-auto max-w-2xl">
      <header className="gutter flex items-center gap-2 pt-[max(8px,env(safe-area-inset-top))]">
        <a className="icon-btn" href={h("/soul-file")} aria-label="Back to the soul file"><ArrowLeft /></a>
        <h1 className="min-w-0 flex-1 truncate text-[var(--text-h2)]">Team</h1>
        <ThemeToggle />
      </header>

      <div className="gutter safe-bottom flex flex-col gap-4 pb-16 pt-4">
        <p className="t-small muted">How to work with each other. Each card is the one section a person shares; the rest of their report stays theirs.</p>

        {mine && (
          <section className="card flex flex-col gap-2">
            <h2 className="text-[var(--text-h2)]">Share your card</h2>
            <p className="t-small muted">Copy it and send it to the people you work with. If they use the Soul Map, they paste it below on their Team page; if not, it reads fine as a message.</p>
            <button type="button" className="btn btn-primary self-start" onClick={copyMine}>{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy my card</>}</button>
          </section>
        )}

        {team === null ? <p className="muted"><Loader /></p> : ordered.length === 0 ? (
          <section className="card"><h2>No cards yet.</h2><p className="t-small muted mt-2">Your card appears once your report is built. Cards friends send you can be added below.</p></section>
        ) : ordered.map((c) => (
          <section key={c.id} className="card flex flex-col gap-2">
            <p className="t-label muted">How to work with</p>
            <h2 className="text-[var(--text-h1)]">{c.name}{c.id === me ? <span className="t-caption muted ml-2 font-normal">you</span> : null}</h2>
            {c.card ? <div className="t-small"><Markdown md={c.card} /></div> : <p className="t-small muted">Card not ready yet.</p>}
            {c.shared && <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => remove(c.id)}><Trash size={16} /> Remove</button>}
          </section>
        ))}

        <section className="card flex flex-col gap-3">
          <h2 className="text-[var(--text-h2)]">Add someone&apos;s card</h2>
          <p className="t-small muted">Paste the card a friend or teammate sent you, starting with &ldquo;How to work with&rdquo;. It stays on this Mac.</p>
          <textarea className="field min-h-[120px]" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"How to work with Alex\n\n- Lead with the point..."} />
          <button type="button" className="btn btn-secondary self-start" disabled={adding || !paste.trim()} onClick={add}>{adding ? <><Loader size={16} /> Adding</> : "Add card"}</button>
          {err && <p className="t-small text-[var(--color-danger)]">{err}</p>}
        </section>
      </div>
    </main>
  );
}
