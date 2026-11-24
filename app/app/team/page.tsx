"use client";

import { useEffect, useState } from "react";
import { api, personId, useHref } from "@/components/api";
import { Markdown } from "@/components/Markdown";
import { ThemeToggle } from "@/components/Theme";
import { ArrowLeft, Loader } from "@/components/Icons";
import { Plate } from "@/components/Brand";

type Card = { id: string; name: string; card: string | null };

/** Screen 13: one "how to work with" card per teammate, the viewer's own first. Never the full report. */
export default function TeamPage() {
  const h = useHref();
  const [team, setTeam] = useState<Card[] | null>(null);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    api<{ team?: Card[] }>("/api/team").then((j) => setTeam(j.team ?? [])).catch(() => setTeam([]));
    api<{ profile?: { id?: string } }>("/api/live").then((j) => setMe(j.profile?.id ?? personId())).catch(() => setMe(personId()));
  }, []);

  const ordered = team ? [...team].sort((x, y) => (x.id === me ? -1 : y.id === me ? 1 : x.name.localeCompare(y.name))) : [];

  return (
    <main className="mx-auto max-w-2xl">
      <header className="gutter flex items-center gap-2 pt-[max(8px,env(safe-area-inset-top))]">
        <a className="icon-btn" href={h("/soul-file")} aria-label="Back to the soul file"><ArrowLeft /></a>
        <h1 className="min-w-0 flex-1 truncate text-[var(--text-h2)]">Team</h1>
        <ThemeToggle />
      </header>
      <Plate name="island" position="50% 55%" className="mt-2" />

      <div className="gutter safe-bottom flex flex-col gap-4 pt-4">
        <p className="t-small muted">How to work with each other. Each card is the one section a person shares; the rest of their report stays theirs.</p>
        {team === null ? <p className="muted"><Loader /></p> : ordered.length === 0 ? (
          <section className="card"><h2>No cards yet.</h2><p className="t-small muted mt-2">A card appears once a person has consented and built their report.</p></section>
        ) : ordered.map((c) => (
          <section key={c.id} className="card flex flex-col gap-2">
            <p className="t-label muted">How to work with</p>
            <h2 className="text-[var(--text-h1)]">{c.name}{c.id === me ? <span className="t-caption muted ml-2 font-normal">you</span> : null}</h2>
            {c.card ? <div className="t-small"><Markdown md={c.card} /></div> : <p className="t-small muted">Card not ready yet.</p>}
          </section>
        ))}
      </div>
    </main>
  );
}
