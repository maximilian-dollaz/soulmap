"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, useHref } from "@/components/api";
import { Markdown, sections } from "@/components/Markdown";
import { ThemeToggle } from "@/components/Theme";
import { ArrowLeft, ArrowRight, Copy, Loader, Quote } from "@/components/Icons";
import { lensName } from "@/components/interview-types";
import { DeltaMark, Plate, plateSrc } from "@/components/Brand";

type Status = "idle" | "in_chat" | "in_call" | "ended" | "complete" | "reported" | string;

/** The report for the person: sticky section chips, the team card first, a "tell my Soul Map" entry at the bottom. */
export default function ReportPage() {
  const h = useHref();
  const [human, setHuman] = useState("");
  const [name, setName] = useState("");
  const [lenses, setLenses] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [active, setActive] = useState("card");
  const [copied, setCopied] = useState(false);
  const [hasEvidence, setHasEvidence] = useState<boolean | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ human?: string }>("/api/report").then((j) => setHuman(j.human ?? ""));
    api<{ summary?: unknown }>("/api/evidence").then((j) => setHasEvidence(!!j.summary)).catch(() => setHasEvidence(false));
    api<{ status?: string; profile?: { name?: string; enabled_lenses?: string[] } }>("/api/live").then((j) => { setStatus(j.status ?? "idle"); setName(j.profile?.name ?? ""); setLenses(j.profile?.enabled_lenses ?? []); }).catch(() => {});
  }, []);

  const unlocked = status === "complete" || status === "reported";
  const secs = useMemo(() => sections(human).filter((s) => s.level === 2), [human]);
  const disagreeId = secs.find((s) => /disagree|tension/i.test(s.title))?.id;
  const chips = useMemo(() => [{ id: "card", title: "Card" }, ...secs.filter((s) => s.id !== disagreeId).map((s) => ({ id: s.id, title: s.title })), ...(disagreeId ? [{ id: disagreeId, title: "Where lenses disagree" }] : [])], [secs, disagreeId]);

  // first paragraph after the first h2 = the essence line for the card
  const essence = useMemo(() => {
    const lines = human.split("\n");
    const start = lines.findIndex((l) => /^##\s/.test(l));
    if (start < 0) return "";
    for (let i = start + 1; i < lines.length; i++) { const t = lines[i].trim(); if (t && !t.startsWith("#") && !t.startsWith(">")) return t.replace(/\*\*/g, ""); }
    return "";
  }, [human]);

  // scroll-spy
  useEffect(() => {
    if (!human) return;
    const els = chips.map((c) => document.getElementById(c.id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id);
    }, { rootMargin: "-120px 0px -60% 0px", threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [human, chips]);
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);

  const build = async () => {
    setBusy(true); setErr("");
    try {
      const j = await api<{ human?: string; error?: string }>("/api/report", { method: "POST" });
      if (j._status >= 400) throw new Error(j.error ?? "The report could not be written.");
      setHuman(j.human ?? ""); setStatus("reported");
    } catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  };

  const copyCard = async () => {
    const text = `${name || "Me"}: how to work with me\n\n${essence}\n\n${lenses.map(lensName).join(" · ")}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <main className="mx-auto max-w-2xl">
      <header className="gutter flex items-center gap-2 pt-[max(8px,env(safe-area-inset-top))]">
        <a className="icon-btn" href={h("/")} aria-label="Back to the map"><ArrowLeft /></a>
        <h1 className="min-w-0 flex-1 truncate text-[var(--text-h2)]">Report</h1>
        <a className="btn btn-ghost" href={h("/energy")}>Energy Audit</a>
        <a className="btn btn-ghost" href={h("/soul-file")}>Soul file <ArrowRight size={16} /></a>
        <ThemeToggle />
      </header>
      <Plate name="lake" position="50% 62%" className="mt-2" />

      {human && (
        <nav ref={scroller} className="sticky top-0 z-10 -mx-0 flex gap-2 overflow-x-auto bg-[var(--color-bg)] px-4 py-3 [scrollbar-width:none]" aria-label="Sections">
          {chips.map((c) => (
            <button key={c.id} type="button" data-chip={c.id} className={`chip ${active === c.id ? "active" : ""}`} onClick={() => { setActive(c.id); document.getElementById(c.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{c.title}</button>
          ))}
        </nav>
      )}

      <div className="gutter safe-bottom pb-24">
        {!human && (
          <section className="card mt-4 flex flex-col gap-4">
            <h2>{unlocked ? "Your interview is done." : "Finish the interview first."}</h2>
            <p className="t-small muted">{unlocked ? "Writing the report takes a few minutes. It reads every score, your chart and your intention; never raw conversations." : "The report unlocks when every lens is answered. Your place is saved."}</p>
            {unlocked ? (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={build}>{busy ? <><Loader /> Writing, a few minutes</> : "Build my report"}</button>
            ) : (
              <a className="btn btn-primary" href={h("/")}>Back to the interview</a>
            )}
            {hasEvidence === false && <a className="btn btn-ghost self-start" href={h("/evidence")}>Add evidence <ArrowRight size={16} /></a>}
            {err && <p className="t-small text-[var(--color-danger)]">{err}</p>}
          </section>
        )}

        {human && (
          <>
            <section id="card" className="mt-4 scroll-mt-24">
              <div className="team-card mx-auto max-w-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="plate" src={plateSrc("embers")} alt="" aria-hidden="true" />
                <div className="glow orb-breathe" aria-hidden />
                <p className="t-label">How to work with</p>
                <h2 className="mt-1 text-[var(--text-h1)]">{name || "me"}</h2>
                <p className="mt-4 flex-1 text-[1rem] leading-relaxed">{essence}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">{lenses.map((l) => <span key={l} className="lens t-caption rounded-full px-2.5 py-1">{lensName(l)}</span>)}</div>
              </div>
              <div className="mt-3 flex justify-center gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={copyCard}><Copy size={16} /> {copied ? "Copied" : "Copy text"}</button>
              </div>
            </section>

            <article className="mt-8">
              <Markdown md={human} />
            </article>

            <section className="card mt-10 flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-[var(--text-h2)]"><Quote /> Something off?</h2>
              <p className="t-small muted">Tell your Soul Map in one sentence. It applies at once and every agent you work with picks it up.</p>
              <a className="btn btn-secondary" href={h("/soul-file#tell")}>Tell my Soul Map</a>
            </section>

            {hasEvidence === false && (
              <section className="card mt-6 flex flex-col gap-3">
                <h2 className="text-[var(--text-h2)]">No evidence yet</h2>
                <p className="t-small muted">Add a Claude, ChatGPT, Granola or Otter export and rebuild: the report then reads how you actually communicate, not only what you answered.</p>
                <a className="btn btn-secondary self-start" href={h("/evidence")}>Add evidence <ArrowRight size={16} /></a>
              </section>
            )}

            <div className="mt-8 flex items-center justify-between">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={build}>{busy ? <><Loader size={16} /> Rebuilding</> : "Rebuild report"}</button>
              <a className="btn btn-primary" href={h("/soul-file")}>Get the soul file <ArrowRight /></a>
            </div>
            {err && <p className="t-small mt-2 text-[var(--color-danger)]">{err}</p>}
            <DeltaMark size={56} thread className="mt-12" />
          </>
        )}
      </div>

      {human && (
        <a className="btn btn-primary fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-4 shadow-lg md:hidden" href={h("/soul-file#tell")} style={{ minHeight: 48 }}>Tell my Soul Map</a>
      )}
    </main>
  );
}
