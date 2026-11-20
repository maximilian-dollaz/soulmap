"use client";

import { useEffect, useState } from "react";
import { api, useHref } from "@/components/api";
import { ThemeToggle } from "@/components/Theme";
import { ArrowLeft, Check, Loader } from "@/components/Icons";
import { Plate } from "@/components/Brand";

type Checkin = { id: string; at: string; task: string; energy: number; notes?: string; feedback?: string; agent?: string };
type Adjustment = { id: string; text: string; why?: string; status: "pending" | "yes" | "no"; nuance?: string };
type Audit = {
  id: string; week_start: string; week_end: string; written_at: string;
  gave_energy: { work: string; why: string }[]; drained: { work: string; why: string }[];
  noticed: string[]; adjustments: Adjustment[]; based_on: { checkins: number; ai_hours: number; meetings: number };
};
type Week = {
  ai: { days: number; sessions: number; hours: number; by_time: Record<string, number>; late_nights: number; longest_session_h: number; weekend_hours: number };
  meetings: { total: number; busiest_day: string | null; busiest_count: number };
  corrections: number;
};

const day = (iso: string) => new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** The Energy Audit: log a task, read the weekly audit, say yes or no to each adjustment. Private to the person. */
export default function EnergyPage() {
  const h = useHref();
  const [task, setTask] = useState("");
  const [agent, setAgent] = useState("");
  const [energy, setEnergy] = useState(5);
  const [touched, setTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [writing, setWriting] = useState(false);
  const [auditErr, setAuditErr] = useState("");

  const load = () => api<{ checkins?: Checkin[]; audit?: Audit | null; week?: Week }>("/api/energy").then((j) => {
    if (j._status !== 200) return;
    setCheckins(j.checkins ?? []); setAudit(j.audit ?? null); setWeek(j.week ?? null);
  }).catch(() => {});

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setTask(q.get("task") ?? ""); setAgent(q.get("agent") ?? "");
    load();
  }, []);

  const save = async () => {
    setSaving(true); setErr("");
    const j = await api<{ error?: string }>("/api/energy", { method: "POST", json: { task, energy, notes, feedback, agent } }).catch(() => ({ _status: 500, error: "Could not reach the Soul Map." }));
    setSaving(false);
    if (j._status !== 200) { setErr(j.error ?? "Could not save."); return; }
    setSaved(true); setTask(""); setNotes(""); setFeedback(""); setEnergy(5); setTouched(false);
    setTimeout(() => setSaved(false), 4000);
    load();
  };

  const writeAudit = async () => {
    setWriting(true); setAuditErr("");
    const j = await api<{ audit?: Audit; error?: string }>("/api/energy/audit", { method: "POST" }).catch(() => ({ _status: 500, error: "Could not reach the Soul Map." } as { _status: number; error?: string; audit?: Audit }));
    setWriting(false);
    if (j._status !== 200 || !j.audit) { setAuditErr(j.error ?? "The audit could not be written."); return; }
    setAudit(j.audit);
  };

  return (
    <main className="mx-auto max-w-2xl">
      <header className="gutter flex items-center gap-2 pt-[max(8px,env(safe-area-inset-top))]">
        <a className="icon-btn" href={h("/")} aria-label="Back to the map"><ArrowLeft /></a>
        <h1 className="min-w-0 flex-1 truncate text-[var(--text-h2)]">Energy Audit</h1>
        <ThemeToggle />
      </header>
      <Plate name="spark" position="50% 58%" className="mt-2" />

      <div className="gutter safe-bottom flex flex-col gap-6 pb-24 pt-4">
        <p className="t-small muted">Log how each task affects your energy. Once a week you get an audit: what gave you energy, what drained you, and small adjustments to try. Nothing changes until you say yes. Only you see this page.</p>

        <section className="card flex flex-col gap-5" id="log">
          <h2 className="text-[var(--text-h2)]">Log a task</h2>
          <label className="block">
            <span className="field-label t-label muted">Task</span>
            <input className="field" value={task} onChange={(e) => setTask(e.target.value)} placeholder="What did you just work on?" maxLength={200} />
          </label>

          <div>
            <span className="field-label text-[1rem] font-medium">How did this task affect your energy?</span>
            <div className="flex items-baseline justify-between">
              <span className="text-[var(--text-display)] font-semibold tabular-nums" aria-live="polite">{touched ? energy : "–"}</span>
              <span className="t-small muted">{touched ? (energy <= 2 ? "Drained" : energy <= 4 ? "A bit drained" : energy === 5 ? "No change" : energy <= 7 ? "Energized" : "Alive") : "Move the slider"}</span>
            </div>
            <input type="range" min={0} max={10} step={1} value={energy} aria-label="Energy from 0, completely drained, to 10, fully alive"
              onChange={(e) => { setEnergy(Number(e.target.value)); setTouched(true); }} onPointerDown={() => setTouched(true)}
              className="mt-2 w-full" style={{ accentColor: "var(--color-accent)", height: 32 }} />
            <div className="t-caption muted mt-1 flex justify-between"><span>0 · Completely drained</span><span>10 · Fully alive</span></div>
          </div>

          <label className="block">
            <span className="field-label t-label muted">Notes (optional)</span>
            <textarea className="field min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What made it better or worse? Any nuance." maxLength={2000} />
          </label>

          <label className="block">
            <span className="field-label text-[1rem] font-medium">What worked, what didn&apos;t, and how can your AI do better?</span>
            <span className="t-caption muted mb-2 block">Optional. {agent ? `From ${agent}.` : "Your AI asks this so it can improve."}</span>
            <textarea className="field min-h-[72px]" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="One line is enough" maxLength={2000} />
          </label>

          <button type="button" className="btn btn-primary" disabled={saving || !touched} onClick={save}>{saving ? <><Loader size={16} /> Saving</> : "Save"}</button>
          {saved && <p className="t-small flex items-center gap-2 text-[var(--color-ok)]"><Check size={16} /> Saved. It goes into this week&apos;s audit.</p>}
          {err && <p className="t-small text-[var(--color-danger)]">{err}</p>}
        </section>

        <section className="card flex flex-col gap-4" id="audit">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[var(--text-h2)]">This week&apos;s audit</h2>
            {audit && <span className="t-caption muted">{day(audit.week_start)} to {day(audit.week_end)}</span>}
          </div>
          {!audit && <p className="t-small muted">Your first audit is written after a week of work and check-ins. You can also write one now.</p>}
          {audit && <AuditView audit={audit} onChange={setAudit} />}
          <button type="button" className="btn btn-secondary self-start" disabled={writing} onClick={writeAudit}>{writing ? <><Loader size={16} /> Writing, about a minute</> : audit ? "Rewrite with the latest week" : "Write this week's audit"}</button>
          {auditErr && <p className="t-small text-[var(--color-danger)]">{auditErr}</p>}
        </section>

        {week && (
          <section className="card flex flex-col gap-3" id="tracked">
            <h2 className="text-[var(--text-h2)]">Tracked without asking</h2>
            <p className="t-caption muted">The last 7 days, from your AI sessions and meetings. The weekly audit also reads a sample of your own messages from the week, never anyone else's words.</p>
            <ul className="t-small flex flex-col gap-1.5">
              <li>Work with your AI: <b>{week.ai.hours} h</b> over {week.ai.days} days, {week.ai.sessions} sessions. Longest: {week.ai.longest_session_h} h.</li>
              <li>When: morning {week.ai.by_time.morning ?? 0} h, afternoon {week.ai.by_time.afternoon ?? 0} h, evening {week.ai.by_time.evening ?? 0} h, late night {week.ai.by_time["late night"] ?? 0} h.</li>
              <li>Late nights: {week.ai.late_nights}. Weekend: {week.ai.weekend_hours} h.</li>
              <li>Meetings: {week.meetings.total}{week.meetings.busiest_day ? `, most on ${day(week.meetings.busiest_day)} (${week.meetings.busiest_count})` : ""}.</li>
              <li>Corrections you gave your AI: {week.corrections}.</li>
            </ul>
          </section>
        )}

        {checkins.length > 0 && (
          <section className="card flex flex-col gap-3" id="checkins">
            <h2 className="text-[var(--text-h2)]">Your check-ins</h2>
            <ul className="flex flex-col divide-y divide-[var(--color-line)]">
              {checkins.map((c) => (
                <li key={c.id} className="flex items-start gap-3 py-3">
                  <span className="w-9 shrink-0 text-center text-[1.25rem] font-semibold tabular-nums" style={{ color: c.energy >= 6 ? "var(--color-ok)" : c.energy <= 4 ? "var(--color-warn)" : "var(--color-ink)" }}>{c.energy}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[1rem]">{c.task}</p>
                    <p className="t-caption muted">{day(c.at)}{c.agent ? ` · ${c.agent}` : ""}</p>
                    {c.notes && <p className="t-small mt-1">{c.notes}</p>}
                    {c.feedback && <p className="t-small muted mt-1">For your AI: {c.feedback}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function AuditView({ audit, onChange }: { audit: Audit; onChange: (a: Audit) => void }) {
  const list = (title: string, items: { work: string; why: string }[]) => items.length > 0 && (
    <div>
      <h3 className="t-label muted mb-2">{title}</h3>
      <ul className="flex flex-col gap-2">{items.map((x, i) => <li key={i} className="t-small"><b className="font-medium">{x.work}.</b> {x.why}</li>)}</ul>
    </div>
  );
  return (
    <div className="flex flex-col gap-5">
      <p className="t-caption muted">Based on {audit.based_on.checkins} check-ins, {audit.based_on.ai_hours} h of AI work and {audit.based_on.meetings} meetings.</p>
      {list("Gave you energy", audit.gave_energy)}
      {list("Drained you", audit.drained)}
      {audit.noticed.length > 0 && (
        <div>
          <h3 className="t-label muted mb-2">What I noticed</h3>
          <ul className="flex list-disc flex-col gap-2 pl-5">{audit.noticed.map((x, i) => <li key={i} className="t-small">{x}</li>)}</ul>
        </div>
      )}
      {audit.adjustments.length > 0 && (
        <div>
          <h3 className="t-label muted mb-1">Adjustments to try</h3>
          <p className="t-caption muted mb-3">Say yes and your AI follows it from now on. Say no and it won&apos;t be suggested again.</p>
          <ul className="flex flex-col gap-3">{audit.adjustments.map((a) => <AdjustmentRow key={a.id} audit={audit} adj={a} onChange={onChange} />)}</ul>
        </div>
      )}
    </div>
  );
}

function AdjustmentRow({ audit, adj, onChange }: { audit: Audit; adj: Adjustment; onChange: (a: Audit) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(adj.nuance ?? "");
  const [busy, setBusy] = useState(false);
  const send = async (decision: "yes" | "no" | "nuance") => {
    setBusy(true);
    const j = await api<{ adjustment?: Adjustment }>("/api/energy/decide", { method: "POST", json: { audit: audit.id, adjustment: adj.id, decision, nuance: note } }).catch(() => ({ _status: 500 } as { _status: number; adjustment?: Adjustment }));
    setBusy(false);
    if (j._status === 200 && j.adjustment) { onChange({ ...audit, adjustments: audit.adjustments.map((x) => (x.id === adj.id ? j.adjustment! : x)) }); setOpen(false); }
  };
  return (
    <li className="card-raised flex flex-col gap-2 rounded-[var(--radius-md)] p-3">
      <p className="text-[1rem]">{adj.text}</p>
      {adj.why && <p className="t-caption muted">{adj.why}</p>}
      {adj.nuance && !open && <p className="t-small">Your note: {adj.nuance}</p>}
      {adj.status === "yes" && <p className="t-small flex items-center gap-2 text-[var(--color-ok)]"><Check size={16} /> You said yes. Your AI follows this now.</p>}
      {adj.status === "no" && <p className="t-small muted">You said no.</p>}
      {open && <textarea className="field min-h-[64px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add nuance: when it applies, what to change about it" maxLength={1000} autoFocus />}
      <div className="flex flex-wrap gap-2">
        {adj.status === "pending" && <>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => send("yes")}>Yes</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => send("no")}>No</button>
        </>}
        {open
          ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !note.trim()} onClick={() => send("nuance")}>Save note</button>
          : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Add nuance</button>}
      </div>
    </li>
  );
}
