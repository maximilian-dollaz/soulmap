"use client";

import { useEffect, useRef, useState } from "react";
import { api, useHref } from "@/components/api";
import { ArrowLeft, ArrowRight, Check, Link as LinkIcon, Loader, Mic, Shield, Trash } from "@/components/Icons";
import { lensName } from "@/components/interview-types";
import { detectVoiceSupport } from "@/components/useVoice";
import { Plate } from "@/components/Brand";

const ALWAYS_ON = ["human_design", "gene_keys", "enneagram", "attachment", "bigfive", "chronotype", "values"];
const PAID = [
  { key: "kolbe", name: "Kolbe A", blurb: "Your conative MO: how you naturally take action.", buy: "https://www.kolbe.com/kolbe-a-index/" },
  { key: "working_genius", name: "Working Genius", blurb: "The six kinds of work and which ones give you energy.", buy: "https://www.workinggenius.com/" },
];

type Form = {
  name: string; email: string; intention: string;
  date: string; time: string; timeKnown: boolean; place: string;
  kolbe: boolean; working_genius: boolean;
  proof: Record<string, string>; // lens -> uploaded file name (client-side only for now)
  consent: boolean;
};

const STEPS = ["You", "Birth", "Lenses", "Thinking", "Consent"] as const;
const LAST = STEPS.length - 1;
const STEP_BY_NAME: Record<string, number> = { you: 0, birth: 1, lenses: 2, ai: 3, thinking: 3, consent: 4 };
const HOSTED = process.env.NEXT_PUBLIC_HOSTED === "1";
type Engine = "claude" | "local";
type AiStatus = { engine: Engine | null; chosen: boolean; managed?: boolean; has_key: boolean; local: { installed: boolean }; install: { state: "idle" | "running" | "done" | "failed"; step?: string; percent?: number } };
/** `?step=lenses` (the home screen's Settings link) opens that step straight away, with Back going home. */
function initialStep(): number {
  if (typeof window === "undefined") return 0;
  const q = new URLSearchParams(window.location.search).get("step") ?? "";
  return STEP_BY_NAME[q.toLowerCase()] ?? (/^[0-4]$/.test(q) ? Number(q) : 0);
}

export default function Onboarding() {
  const h = useHref();
  const [step, setStep] = useState(0);
  const [entryStep, setEntryStep] = useState(0); // where Settings dropped us in; Back from there goes home
  const [resolved, setResolved] = useState<{ place: string; tz: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveErr, setResolveErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [f, setF] = useState<Form>({ name: "", email: "", intention: "", date: "", time: "", timeKnown: true, place: "", kolbe: false, working_genius: false, proof: {}, consent: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [existing, setExisting] = useState(false);
  const [listening, setListening] = useState(false);
  const [canDictate, setCanDictate] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [engine, setEngine] = useState<Engine | "">("");
  const [key, setKey] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s0 = initialStep();
    if (s0) { setStep(s0); setEntryStep(s0); }
    setCanDictate(detectVoiceSupport().recognition);
    api<{ profile?: { name?: string; email?: string; intention?: string; birth_time_known?: boolean; enabled_lenses?: string[]; consent_at?: string }; birth?: { date: string; time: string; place: string; tz?: string; time_confidence?: string } }>("/api/profile").then((j) => {
      if (j._status !== 200 || !j.profile) return;
      const p = j.profile;
      setExisting(!!p.consent_at);
      setF((s) => ({
        ...s,
        name: p.consent_at && p.name ? p.name : s.name,
        email: p.email ?? "",
        intention: p.intention ?? "",
        date: j.birth?.date ?? "",
        time: j.birth && j.birth.time_confidence !== "unknown" ? j.birth.time : "",
        timeKnown: j.birth ? j.birth.time_confidence !== "unknown" : true,
        place: j.birth?.place ?? "",
      }));
      if (j.birth?.place && j.birth?.tz) setResolved({ place: j.birth.place, tz: j.birth.tz });
      setF((s) => ({
        ...s,
        kolbe: !!p.enabled_lenses?.includes("kolbe"),
        working_genius: !!p.enabled_lenses?.includes("working_genius"),
        consent: !!p.consent_at,
      }));
    }).catch(() => {});
  }, []);
  useEffect(() => { first.current?.focus(); }, [step]);
  // The engine choice, and while the local model downloads, its progress.
  useEffect(() => {
    let stop = false;
    const load = () => api<AiStatus>("/api/settings/ai").then((j) => {
      if (stop || j._status !== 200) return;
      setAi(j);
      setEngine((e) => e || (j.chosen && j.engine ? j.engine : ""));
    }).catch(() => {});
    load();
    const t = window.setInterval(() => { if (engine === "local") load(); }, 3000);
    return () => { stop = true; window.clearInterval(t); };
  }, [engine]);

  // A teammate on someone else's install: the owner already chose the engine, so the Thinking step is skipped.
  const managed = !!ai?.managed;
  /** Saves the engine choice before moving on: checks a Claude key, or starts the local model download. */
  const saveEngine = async (): Promise<boolean> => {
    if (HOSTED) return true;
    setBusy(true); setErr("");
    try {
      const r = await api<{ ok?: boolean; error?: string }>("/api/settings/ai", { method: "POST", json: { engine, key: engine === "claude" ? key.trim() : undefined } });
      if (r._status >= 400 || !r.ok) { setErr(r.error ?? "Could not save that choice."); return false; }
      setKey("");
      return true;
    } catch { setErr("Could not save that choice."); return false; }
    finally { setBusy(false); }
  };

  const dictate = () => {
    const w = window as unknown as { SpeechRecognition?: new () => { lang: string; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start(): void }; webkitSpeechRecognition?: typeof w.SpeechRecognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.onresult = (e) => { const t = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join(" ").trim(); if (t) set("intention", (f.intention ? f.intention + " " : "") + t); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  };

  /** Once date and city are in, ask the server to geocode so the person sees the place and timezone it understood. */
  const resolvePlace = async () => {
    const place = f.place.trim();
    if (!place || !f.date || (resolved && resolved.place === place)) return;
    setResolving(true); setResolveErr("");
    try {
      const r = await api<{ ok?: boolean; birth?: { place: string; tz: string } | null; chart_error?: string }>("/api/profile", {
        method: "POST", json: { birth: { date: f.date, time: f.timeKnown && f.time ? f.time : undefined, place } },
      });
      if (r._status === 200 && r.birth?.place && r.birth?.tz && !r.chart_error) setResolved({ place: r.birth.place, tz: r.birth.tz });
      else { setResolved(null); setResolveErr(r.chart_error ? `Could not find "${place}". Try the nearest big city.` : "Could not look that up right now."); }
    } catch { setResolveErr("Could not look that up right now."); }
    finally { setResolving(false); }
  };

  const valid = [
    f.name.trim().length > 0,
    f.date.length > 0 && f.place.trim().length > 0 && (!f.timeKnown || f.time.length > 0),
    true,
    HOSTED || managed || engine === "local" || (engine === "claude" && (key.trim().length > 20 || !!ai?.has_key)),
    f.consent,
  ];

  const finish = async () => {
    if (!valid.every(Boolean)) return;
    setBusy(true); setErr("");
    try {
      const enabled = [...ALWAYS_ON, ...(f.kolbe ? ["kolbe"] : []), ...(f.working_genius ? ["working_genius"] : [])];
      const birth = { date: f.date, time: f.timeKnown && f.time ? f.time : undefined, place: f.place.trim(), time_known: f.timeKnown && !!f.time };
      const r = await api<{ ok?: boolean; has_chart?: boolean; chart_error?: string; error?: string }>("/api/profile", {
        method: "POST",
        json: { name: f.name.trim(), email: f.email.trim() || undefined, birth, birth_time_known: birth.time_known, intention: f.intention.trim(), enabled_lenses: enabled, consent: true },
      });
      if (r._status >= 400) throw new Error(r.error ?? "Could not save your profile.");
      if (!r.has_chart) {
        // the chart did not come back with the profile call: ask the chart tool directly
        const b = await api<{ ok?: boolean; error?: string }>("/api/tool/record-birth", {
          method: "POST",
          json: { args: { date: birth.date, time: birth.time ?? "", place: birth.place, time_confidence: birth.time_known ? "exact" : "unknown" } },
        });
        if (!b.ok) setErr(`Saved. The chart could not be computed yet (${b.error ?? r.chart_error ?? "unknown place?"}); you can fix the city in Settings later.`);
      }
      window.location.assign(h("/"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setBusy(false); }
  };

  /** Two taps: "Delete everything" then "Yes, delete it all". Removes profile, report, soul file and evidence. */
  const deleteEverything = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true); setErr("");
    try {
      const r = await api<{ ok?: boolean; error?: string }>("/api/profile", { method: "DELETE" });
      if (r._status >= 400 || !r.ok) throw new Error(r.error ?? "Could not delete.");
      setF({ name: "", email: "", intention: "", date: "", time: "", timeKnown: true, place: "", kolbe: false, working_genius: false, proof: {}, consent: false });
      setResolved(null); setExisting(false); setConfirmDelete(false); setEntryStep(0); setStep(0);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not delete."); }
    finally { setDeleting(false); }
  };

  const next = async () => {
    if (step === 3 && !managed && !(await saveEngine())) return;
    if (step < LAST) setStep(step === 2 && managed ? 4 : step + 1); else finish();
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="gutter flex items-center justify-between pt-[max(8px,env(safe-area-inset-top))]">
        <button type="button" className="icon-btn" onClick={() => (step && step !== entryStep ? setStep(step === 4 && managed ? 2 : step - 1) : window.location.assign(h("/")))} aria-label={step && step !== entryStep ? "Back" : "Back to home"} disabled={busy && step === LAST}><ArrowLeft /></button>
        <ol className="flex items-center gap-2" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          {STEPS.map((s, i) => <li key={s} className={`h-2 rounded-full transition-all ${i === step ? "w-6 bg-[var(--color-accent)]" : i < step ? "w-2 bg-[var(--color-accent)] opacity-60" : "w-2 bg-[var(--color-line)]"}`} aria-current={i === step ? "step" : undefined} />)}
        </ol>
        <span className="w-11" />
      </header>

      <form className="gutter flex flex-1 flex-col gap-5 pt-6" onSubmit={(e) => { e.preventDefault(); if (valid[step]) next(); }}>
        {step === 0 && (
          <div key="s0" className="fade-in flex flex-col gap-5">
            <Plate name="roots" size="md" rounded position="50% 45%" />
            <p className="eyebrow">Know Thyself.</p>
            <h1 className="display">{existing ? "Your details." : "Let's start with you."}</h1>
            <label className="block">
              <span className="field-label t-caption muted">What should I call you?</span>
              <input ref={first} className="field" value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="given-name" placeholder="Your name" required />
            </label>
            <label className="block">
              <span className="field-label t-caption muted">Email, optional. Only for sending you the report.</span>
              <input className="field" type="email" inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </label>
            <label className="block">
              <span className="field-label t-caption muted">What&apos;s the best possible outcome of doing this?</span>
              <div className="flex items-start gap-2">
                <textarea className="field min-h-[6rem] flex-1 resize-none" value={f.intention} onChange={(e) => set("intention", e.target.value)} placeholder="One sentence is plenty." rows={3} />
                {canDictate && <button type="button" className={`icon-btn lg outlined ${listening ? "bg-[var(--color-accent-soft)]" : ""}`} onClick={dictate} aria-label="Dictate" aria-pressed={listening}><Mic /></button>}
              </div>
            </label>
          </div>
        )}

        {step === 1 && (
          <div key="s1" className="fade-in flex flex-col gap-5">
            <h1 className="display">When and where were you born?</h1>
            <p className="t-small muted">Human Design and Gene Keys come from the sky at that moment. Date and city are enough to start.</p>
            <label className="block">
              <span className="field-label t-caption muted">Date</span>
              <input ref={first} className="field" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} max={new Date().toISOString().slice(0, 10)} required />
            </label>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="t-caption muted">Time</span>
                <button type="button" role="switch" aria-checked={!f.timeKnown} className="chip" onClick={() => set("timeKnown", !f.timeKnown)}>
                  <span className={`check-box ${!f.timeKnown ? "on" : ""}`} style={{ width: 20, height: 20 }}>{!f.timeKnown && <Check size={14} />}</span>
                  Not sure
                </button>
              </div>
              <input className="field" type="time" value={f.time} onChange={(e) => set("time", e.target.value)} disabled={!f.timeKnown} aria-label="Time of birth" />
              {!f.timeKnown && <p className="t-caption muted mt-2">No problem. The map draws those two lenses dashed, and the report says where to find the time (a birth certificate or a hospital record usually has it).</p>}
            </div>
            <label className="block">
              <span className="field-label t-caption muted">City</span>
              <input className="field" value={f.place} onChange={(e) => { set("place", e.target.value); setResolved(null); setResolveErr(""); }} onBlur={resolvePlace} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolvePlace(); } }} placeholder="City, country" autoComplete="off" required />
              <p className="t-caption mt-2 min-h-[1.2em]" aria-live="polite">
                {resolving ? <span className="muted inline-flex items-center gap-1"><Loader size={14} /> Looking that up…</span>
                  : resolved ? <span className="inline-flex items-center gap-1 text-[var(--color-ok)]"><Check size={14} className="shrink-0" /> <span>{resolved.place} · {resolved.tz}</span></span>
                  : resolveErr ? <span className="text-[var(--color-danger)]">{resolveErr}</span>
                  : f.place.trim() && f.date ? <span className="muted">Tap outside the field to check the place.</span> : null}
              </p>
            </label>
          </div>
        )}

        {step === 2 && (
          <div key="s2" className="fade-in flex flex-col gap-5">
            <h1 className="display">Your lenses.</h1>
            <div>
              <p className="t-caption muted mb-2">Included, always on</p>
              <div className="flex flex-wrap gap-2">{ALWAYS_ON.map((l) => <span key={l} className="chip ok"><Check size={14} /> {lensName(l)}</span>)}</div>
            </div>
            <p className="t-caption muted">Two paid instruments. Off means they are simply absent from your interview and report; nothing is guessed.</p>
            {PAID.map((lens) => {
              const on = f[lens.key as "kolbe" | "working_genius"];
              const proof = f.proof[lens.key];
              return (
                <div key={lens.key} className={`card flex flex-col gap-3 ${on ? "" : "opacity-80"}`}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[var(--text-body)] font-[var(--font-body)]" style={{ fontFamily: "var(--font-body)", fontWeight: 500, letterSpacing: 0 }}>{lens.name}</h2>
                      <p className="t-caption muted">{on ? lens.blurb : "Not included"}</p>
                    </div>
                    <button type="button" role="switch" aria-checked={on} aria-label={`${lens.name} on`} className="toggle" onClick={() => set(lens.key as "kolbe", !on)} />
                  </div>
                  {on && (
                    <div className="flex flex-col gap-2">
                      {proof ? (
                        <p className="t-small flex items-center gap-2 text-[var(--color-ok)]"><Check size={18} /> {proof} <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => set("proof", { ...f.proof, [lens.key]: "" })}>Replace</button></p>
                      ) : (
                        <>
                          <div className="flex gap-2">
                            <label className="btn btn-secondary btn-sm flex-1 cursor-pointer">
                              I have my result
                              <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) set("proof", { ...f.proof, [lens.key]: file.name }); }} />
                            </label>
                            <a className="btn btn-secondary btn-sm flex-1" href={lens.buy} target="_blank" rel="noreferrer"><LinkIcon size={16} /> Buy</a>
                          </div>
                          <p className="t-caption muted">Until your result is in, it is not in your interview or report.</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {step === 3 && (
          <div key="s3" className="fade-in flex flex-col gap-5">
            <h1 className="display">Who does the thinking?</h1>
            {HOSTED ? (
              <p className="t-small muted">Here, Claude by Anthropic reads your answers and writes your report. To keep everything on your own computer, install the Mac version.</p>
            ) : (
              <>
                <p className="t-small muted">Something has to read your answers, score your meetings and write your report. Pick one. You can change it later in Settings.</p>
                <button type="button" className={`card flex flex-col gap-2 text-left ${engine === "claude" ? "border-[var(--color-accent)]" : ""}`} onClick={() => setEngine("claude")} role="radio" aria-checked={engine === "claude"}>
                  <span className="flex items-center gap-3">
                    <span className={`check-box ${engine === "claude" ? "on" : ""}`}>{engine === "claude" && <Check size={18} />}</span>
                    <span style={{ fontWeight: 500 }}>Claude (recommended)</span>
                  </span>
                  <span className="t-small muted">Claude by Anthropic reads your answers and your own lines from meetings, then writes your report. Nothing to download.</span>
                  <span className="t-caption muted">Uses your Anthropic API key. About 30 cents a report.</span>
                </button>
                {engine === "claude" && (
                  <label className="block">
                    <span className="field-label t-caption muted">{ai?.has_key ? "A key is saved on this Mac. Paste a new one to replace it." : "Anthropic API key"}</span>
                    <input ref={first} className="field" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." />
                    <a className="t-caption mt-2 inline-flex items-center gap-1 text-[var(--color-accent)]" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"><LinkIcon size={14} /> Get a key from the Anthropic Console</a>
                  </label>
                )}
                <button type="button" className={`card flex flex-col gap-2 text-left ${engine === "local" ? "border-[var(--color-accent)]" : ""}`} onClick={() => setEngine("local")} role="radio" aria-checked={engine === "local"}>
                  <span className="flex items-center gap-3">
                    <span className={`check-box ${engine === "local" ? "on" : ""}`}>{engine === "local" && <Check size={18} />}</span>
                    <span style={{ fontWeight: 500 }}>Only this Mac</span>
                  </span>
                  <span className="t-small muted">A free model runs on this Mac. Nothing you say leaves it.</span>
                  <span className="t-caption muted">One download of about 5 GB. Reports take a few minutes and read plainer.</span>
                </button>
                {engine === "local" && ai && <LocalProgress ai={ai} />}
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div key="s4" className="fade-in flex flex-col gap-5">
            <h1 className="display">Before we start.</h1>
            <ul className="flex flex-col gap-3">
              {[
                HOSTED ? "Your answers, chart and report are stored for this browser only." : managed ? "Your answers, chart and report are stored on the team's Recall server, in your own profile." : "Your answers, chart and report are stored on this Mac, in your own profile.",
                HOSTED || managed || engine === "claude" ? "Claude by Anthropic reads your answers and your own meeting lines to score them and write your report. Nothing else is sent." : "Nothing leaves this Mac: the local model does all the thinking.",
                "Anything you upload is summarised, then the raw file is deleted.",
                "Reports never contain other people's words, only patterns.",
                "If you share with a team, they see one card: how to work with you. Never the full report.",
                "You can delete everything, any time, from this screen.",
              ].map((t) => <li key={t} className="flex gap-3"><Shield className="mt-0.5 shrink-0 text-[var(--color-ok)]" /> <span>{t}</span></li>)}
            </ul>
            <button type="button" className="check-row" onClick={() => set("consent", !f.consent)} role="checkbox" aria-checked={f.consent}>
              <span className={`check-box ${f.consent ? "on" : ""}`}>{f.consent && <Check size={18} />}</span>
              <span>I understand, and I want to do this.</span>
            </button>
            {confirmDelete ? (
              <div className="card flex flex-col gap-3 border-[var(--color-danger)]" role="alertdialog" aria-label="Confirm delete">
                <p className="t-small">This removes every answer, your chart, the conversation, your report, your soul file and your uploaded evidence from this Mac. It cannot be undone.</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-secondary flex-1" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep it</button>
                  <button type="button" className="btn btn-primary flex-1 bg-[var(--color-danger)]" onClick={deleteEverything} disabled={deleting}>{deleting ? <><Loader /> Deleting</> : "Yes, delete it all"}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost self-start text-[var(--color-danger)]" onClick={deleteEverything}><Trash size={18} /> Delete everything</button>
            )}
          </div>
        )}

        {err && <p className="t-small text-[var(--color-danger)]" role="alert">{err}</p>}

        <div className="safe-bottom mt-auto pt-4">
          <button type="submit" className="btn btn-primary btn-block" disabled={!valid[step] || busy}>
            {busy ? <><Loader /> {step === 3 && engine === "claude" ? "Checking the key" : "Saving"}</> : step === LAST ? (existing ? "Save" : "Start") : <>Next <ArrowRight /></>}
          </button>
        </div>
      </form>
    </main>
  );
}

/** Where the local model download is. It keeps going in the background; the interview works meanwhile. */
function LocalProgress({ ai }: { ai: AiStatus }) {
  if (ai.local.installed || ai.install.state === "done") return <p className="t-caption inline-flex items-center gap-1 text-[var(--color-ok)]"><Check size={14} /> The local model is installed.</p>;
  if (ai.install.state === "running") return <p className="t-caption muted inline-flex items-center gap-1"><Loader size={14} /> {ai.install.step ?? "Installing"}{ai.install.percent !== undefined ? ` · ${ai.install.percent}%` : ""}. You can carry on meanwhile.</p>;
  if (ai.install.state === "failed") return <p className="t-caption text-[var(--color-danger)]">{ai.install.step ?? "The download failed."} Tap Next to try again.</p>;
  return <p className="t-caption muted">The download starts when you tap Next.</p>;
}
