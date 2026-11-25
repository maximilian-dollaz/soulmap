"use client";

import { useEffect, useState } from "react";
import { api, useHref } from "@/components/api";
import { ThemeToggle } from "@/components/Theme";
import { ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Copy, Download, Link, Loader, Mic, Undo } from "@/components/Icons";
import { detectVoiceSupport } from "@/components/useVoice";

type Correction = { at: string; text: string };
type Peer = { n: number; link: string | null };

const INSTALLS: { key: string; name: string; auto?: boolean; steps: string[] }[] = [
  { key: "recall", name: "Recall", auto: true, steps: ["Nothing to do. Recall loads this file at the start of every session on this Mac.", "Corrections you make anywhere land here and mirror into your Recall library."] },
  { key: "claude_code", name: "Claude Code", steps: ["On the Mac this app runs on: tap Add to Claude Code above. Every new Claude Code session reads it.", "On another computer: tap Download, save the file as ~/.claude/soul.md, then add the line @~/.claude/soul.md to ~/.claude/CLAUDE.md."] },
  { key: "claude", name: "Claude Project (full file)", steps: ["The short file at the top already works in every chat. For deep work, add the full file too.", "Tap Copy on the full file above.", "In Claude make a Project called 'Me' and paste it into the project instructions."] },
  { key: "grok", name: "Grokbot", steps: ["Tap Copy above.", "In Grok open Settings, Customize, and paste into the custom instructions field. Save.", "Start a new chat so it picks the file up."] },
];

const CLAUDE_SETTINGS = "https://claude.ai/settings/profile";
const CHATGPT_SETTINGS = "https://chatgpt.com/#settings/Personalization";
const TEST_PROMPT = "Here is everything on my plate this week. Plan it for me, and tell me anything you'd do differently: ";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="display shrink-0 text-[1.25rem] leading-6 text-[var(--color-accent)]">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </li>
  );
}

export default function SoulFilePage() {
  const h = useHref();
  const [agent, setAgent] = useState("");
  const [short, setShort] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState("");
  const [target, setTarget] = useState<"claude" | "chatgpt">("claude");
  const [chatgpt, setChatgpt] = useState<{ respond: string; about: string } | null | "loading" | undefined>(undefined);
  const [testCopied, setTestCopied] = useState(false);
  const [name, setName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(false);
  const [open, setOpen] = useState<string>("recall");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [updated, setUpdated] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [canDictate, setCanDictate] = useState(false);
  const [listening, setListening] = useState(false);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [peerBusy, setPeerBusy] = useState(false);
  const [peerCopied, setPeerCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [setup, setSetup] = useState<{ owner: boolean; recall: boolean; claude_code: boolean } | null>(null);
  const [installing, setInstalling] = useState(false);

  const loadCorrections = () => api<{ corrections?: Correction[]; updated_at?: string | null }>("/api/soul/correct").then((j) => { if (j._status === 200) { setCorrections(j.corrections ?? []); setUpdated(j.updated_at ?? null); } }).catch(() => {});
  useEffect(() => {
    setCanDictate(detectVoiceSupport().recognition);
    api<{ agent?: string }>("/api/report").then((j) => {
      setAgent(j.agent ?? ""); setLoaded(true);
      if (j.agent) api<{ short?: string }>("/api/soul/short").then((k) => setShort(k.short ?? "")).catch(() => setShort(""));
    });
    api<{ profile?: { name?: string } }>("/api/live").then((j) => setName(j.profile?.name ?? "")).catch(() => {});
    loadCorrections();
    api<{ owner: boolean; recall: boolean; claude_code: boolean }>("/api/soul/install").then((j) => { if (j._status === 200) { setSetup(j); setOpen(j.recall ? "recall" : "claude_code"); } }).catch(() => {});
    setOrigin(window.location.origin);
    api<Peer>("/api/peer").then((j) => { if (j._status === 200) setPeer({ n: j.n ?? 0, link: j.link ?? null }); }).catch(() => {});
    if (window.location.hash === "#tell") setTimeout(() => document.getElementById("tell")?.scrollIntoView({ behavior: "smooth" }), 300);
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(agent); } catch {
      const ta = document.createElement("textarea"); ta.value = agent; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    setCopied(true); setFlash(true);
    setTimeout(() => { setCopied(false); setFlash(false); }, 1500);
  };
  const addToClaudeCode = async () => {
    setInstalling(true); setErr("");
    try {
      const j = await api<{ ok?: boolean; error?: string }>("/api/soul/install", { method: "POST" });
      if (!j.ok) throw new Error(j.error ?? "could not add it");
      setSetup((s) => (s ? { ...s, claude_code: true } : s));
    } catch (e) { setErr(e instanceof Error ? e.message : "could not add it"); }
    finally { setInstalling(false); }
  };
  const download = () => {
    const blob = new Blob([agent], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `soul-map-${(name || "me").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setErr("");
    try {
      const j = await api<{ ok?: boolean; error?: string }>("/api/soul/correct", { method: "POST", json: { text: t, source: "app" } });
      if (!j.ok) throw new Error(j.error ?? "not saved");
      setText("");
      await loadCorrections();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save that."); }
    finally { setSending(false); }
  };
  const copyText = async (t: string) => {
    try { await navigator.clipboard.writeText(t); } catch {
      const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
  };
  const copyKey = async (key: string, t: string) => { if (!t) return; await copyText(t); setCopiedKey(key); setTimeout(() => setCopiedKey(""), 1500); };
  const copyTest = async () => { await copyText(TEST_PROMPT); setTestCopied(true); setTimeout(() => setTestCopied(false), 1500); };
  const pickTarget = (k: "claude" | "chatgpt") => {
    setTarget(k);
    if (k === "chatgpt" && (chatgpt === undefined || chatgpt === null)) {
      setChatgpt("loading");
      api<{ chatgpt?: { respond: string; about: string } | null }>("/api/soul/short?for=chatgpt").then((j) => setChatgpt(j.chatgpt ?? null)).catch(() => setChatgpt(null));
    }
  };
  const TryIt = () => (
    <>
      <span className="t-small">Start a new chat and try this. Add your real list at the end.</span>
      <button type="button" className="copy-block text-left" onClick={copyTest} aria-live="polite">{testCopied ? "Copied" : TEST_PROMPT + "…"}</button>
      <span className="t-caption muted">Your AI should plan around your energy, tell you what to hand off, and ask your view before giving its own on judgment calls. When it gets something wrong, correct it. It will offer the line to add to your file.</span>
    </>
  );
  /** One tap: reuse the newest link or make one, then copy its full URL (same host the person is on, so teammates reach it the same way). */
  const askTeammate = async () => {
    if (peerBusy) return;
    setPeerBusy(true);
    try {
      let link = peer?.link ?? null;
      if (!link) { const j = await api<{ ok?: boolean; path?: string }>("/api/peer/link", { method: "POST" }); if (j.ok && j.path) link = j.path; }
      if (!link) return;
      setPeer((p) => ({ n: p?.n ?? 0, link }));
      await copyText(window.location.origin + link);
      setPeerCopied(true); setTimeout(() => setPeerCopied(false), 1500);
    } finally { setPeerBusy(false); }
  };
  const undo = async (at: string) => { await api("/api/soul/correct", { method: "DELETE", json: { at } }); loadCorrections(); };
  const dictate = () => {
    const w = window as unknown as { SpeechRecognition?: new () => { lang: string; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start(): void }; webkitSpeechRecognition?: typeof w.SpeechRecognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor(); r.lang = "en-US";
    r.onresult = (e) => { const t = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join(" ").trim(); if (t) setText((s) => (s ? s + " " : "") + t); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    setListening(true); r.start();
  };

  const lines = agent.split("\n").length;

  return (
    <main className="mx-auto max-w-2xl">
      <header className="gutter flex items-center gap-2 pt-[max(8px,env(safe-area-inset-top))]">
        <a className="icon-btn" href={h("/report")} aria-label="Back to the report"><ArrowLeft /></a>
        <h1 className="min-w-0 flex-1 truncate text-[var(--text-h2)]">Soul file</h1>
        <ThemeToggle />
      </header>

      <div className="gutter safe-bottom flex flex-col gap-6 pt-4">
        <p className="t-small muted">The file every AI you work with should read first. {updated ? `Last changed ${new Date(updated).toLocaleString()}.` : ""}</p>

        {!loaded ? <p className="muted"><Loader /></p> : !agent ? (
          <section className="card flex flex-col gap-3">
            <h2>No soul file yet.</h2>
            <p className="t-small muted">It is written together with your report.</p>
            <a className="btn btn-primary" href={h("/report")}>Go to the report</a>
          </section>
        ) : (
          <>
            <section className="card flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <h2 className="flex-1">Put it in your AI</h2>
                <div className="flex gap-1" role="tablist">
                  {(["claude", "chatgpt"] as const).map((k) => (
                    <button key={k} type="button" role="tab" aria-selected={target === k} className={`btn btn-sm ${target === k ? "btn-primary" : "btn-ghost"}`} onClick={() => pickTarget(k)}>{k === "claude" ? "Claude" : "ChatGPT"}</button>
                  ))}
                </div>
              </div>
              <p className="t-small muted">A few taps. Your AI reads this before every chat, so it works the way you do.</p>
              {target === "claude" ? (
              <ol className="flex flex-col gap-3">
                <Step n={1}>
                  <button type="button" className={`btn w-full ${copiedKey === "short" ? "btn-secondary" : "btn-primary"}`} style={{ minHeight: 48 }} onClick={() => copyKey("short", short ?? "")} disabled={!short} aria-live="polite">
                    {short === null ? <><Loader /> Writing your short file</> : !short ? "Short file not ready. Use the full file below" : copiedKey === "short" ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy my soul file</>}
                  </button>
                </Step>
                <Step n={2}>
                  <a className="btn btn-secondary" style={{ minHeight: 48 }} href={CLAUDE_SETTINGS} target="_blank" rel="noreferrer">Open Claude settings <ArrowRight size={16} /></a>
                  <span className="t-small muted">Paste into &quot;What personal preferences should Claude consider in responses?&quot; and tap Save.</span>
                </Step>
                <Step n={3}><TryIt /></Step>
              </ol>
              ) : (
              <ol className="flex flex-col gap-3">
                {chatgpt === undefined || chatgpt === "loading" ? <p className="t-small muted"><Loader /> Fitting your file to ChatGPT&apos;s two boxes</p> : !chatgpt ? <p className="t-small muted">Couldn&apos;t fit it to ChatGPT yet. Tap ChatGPT again to retry.</p> : (<>
                <Step n={1}>
                  <a className="btn btn-secondary" style={{ minHeight: 48 }} href={CHATGPT_SETTINGS} target="_blank" rel="noreferrer">Open ChatGPT settings <ArrowRight size={16} /></a>
                  <span className="t-small muted">Then Personalization, then Custom instructions.</span>
                </Step>
                <Step n={2}>
                  <button type="button" className={`btn w-full ${copiedKey === "respond" ? "btn-secondary" : "btn-primary"}`} style={{ minHeight: 48 }} onClick={() => copyKey("respond", chatgpt.respond)}>{copiedKey === "respond" ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy part 1</>}</button>
                  <span className="t-small muted">Paste into the box about how ChatGPT should respond.</span>
                </Step>
                <Step n={3}>
                  <button type="button" className={`btn w-full ${copiedKey === "about" ? "btn-secondary" : "btn-primary"}`} style={{ minHeight: 48 }} onClick={() => copyKey("about", chatgpt.about)}>{copiedKey === "about" ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy part 2</>}</button>
                  <span className="t-small muted">Paste into the box about you. Tap Save.</span>
                </Step>
                <Step n={4}><TryIt /></Step>
                </>)}
              </ol>
              )}
              {short && <details><summary className="t-small muted cursor-pointer">See the short file</summary><div className="copy-block mt-2">{short}</div></details>}
            </section>

            <section>
              <h2 className="mb-3">Full soul file</h2>
              <p className="t-small muted mb-3">The complete version, for a Claude Project, Claude Code or any agent.</p>
              <div className={`copy-block ${expanded || lines <= 7 ? "" : "collapsed"} ${flash ? "flash" : ""}`}>
                <button type="button" className={`btn btn-sm absolute right-3 top-3 z-10 ${copied ? "btn-secondary" : "btn-primary"}`} onClick={copy} aria-live="polite">{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}</button>
                {agent}
              </div>
              <div className="mt-2 flex items-center justify-between">
                {lines > 7 && <button type="button" className="btn btn-ghost" onClick={() => setExpanded((e) => !e)}>{expanded ? "Show less" : "Show all"} <ChevronDown size={16} style={{ transform: expanded ? "rotate(180deg)" : undefined }} /></button>}
                <button type="button" className="btn btn-ghost ml-auto" onClick={download}><Download size={18} /> Download</button>
              </div>
              {setup?.owner && (
                <button type="button" className={`btn mt-2 w-full ${setup.claude_code ? "btn-secondary" : "btn-primary"}`} style={{ minHeight: 48 }} onClick={addToClaudeCode} disabled={installing}>
                  {installing ? <Loader /> : setup.claude_code ? <><Check size={18} /> In Claude Code. Tap to update</> : "Add to Claude Code"}
                </button>
              )}
            </section>

            <section>
              <h2 className="mb-3">Other places to put it</h2>
              <div className="flex flex-col gap-2">
                {INSTALLS.filter((i) => i.key !== "recall" || setup?.recall).map((i) => (
                  <div key={i.key} className="card p-0">
                    <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open === i.key} onClick={() => setOpen(open === i.key ? "" : i.key)}>
                      <span className="flex-1 font-medium">{i.name}</span>
                      {i.auto && <span className="chip ok" style={{ minHeight: 28 }}><Check size={14} /> automatic</span>}
                      <ChevronDown size={18} style={{ transform: open === i.key ? "rotate(180deg)" : undefined, transition: "transform 160ms" }} />
                    </button>
                    {open === i.key && (
                      <ol className="t-small flex flex-col gap-2 px-4 pb-4 fade-in">
                        {i.steps.map((s, n) => <li key={n} className="flex gap-3"><span className="display shrink-0 text-[1.25rem] leading-6 text-[var(--color-accent)]">{n + 1}</span><span>{s}</span></li>)}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="card flex flex-col gap-3">
          <h2>Ask a teammate</h2>
          <p className="t-small muted">Two or three people who work with you often. Three minutes each, no login, nobody sees who answered. Their averages go into your report as the &quot;how others experience you&quot; layer.</p>
          <div className="flex items-center gap-2">
            <button type="button" className={`btn ${peerCopied ? "btn-secondary" : "btn-primary"}`} style={{ minHeight: 48 }} onClick={askTeammate} disabled={peerBusy} aria-live="polite">
              {peerBusy ? <Loader /> : peerCopied ? <><Check size={16} /> Link copied</> : <><Link size={16} /> {peer?.link ? "Copy link" : "Create link"}</>}
            </button>
            <span className="t-small muted">{peer ? `${peer.n} response${peer.n === 1 ? "" : "s"} so far` : ""}</span>
          </div>
          {peer?.link && <p className="t-caption muted break-all">{origin}{peer.link}</p>}
          <a className="btn btn-ghost self-start" href={h("/team")}>See the team&apos;s cards <ArrowRight size={16} /></a>
        </section>

        <section id="tell" className="card flex scroll-mt-4 flex-col gap-3">
          <h2>Tell my Soul Map</h2>
          <p className="t-small muted">One sentence on how you want to be worked with. It applies immediately, everywhere this file goes.</p>
          <div className="flex items-end gap-2">
            <textarea className="field min-h-[3.25rem] flex-1 resize-none" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="I prefer options over questions." aria-label="Correction" />
            {canDictate && <button type="button" className={`icon-btn lg outlined ${listening ? "bg-[var(--color-accent-soft)]" : ""}`} onClick={dictate} aria-label="Dictate" aria-pressed={listening}><Mic /></button>}
            <button type="button" className="btn btn-primary" style={{ minHeight: 48, padding: "0 16px" }} onClick={send} disabled={sending || !text.trim()} aria-label="Send">{sending ? <Loader /> : <ArrowUp />}</button>
          </div>
          {err && <p className="t-small text-[var(--color-danger)]">{err}</p>}
          {corrections.length > 0 && (
            <ul className="mt-2 flex flex-col divide-y divide-[var(--color-line)]">
              {corrections.map((c) => (
                <li key={c.at} className="flex items-start gap-3 py-2.5">
                  <div className="min-w-0 flex-1"><p className="t-small">{c.text}</p><p className="t-caption muted">{new Date(c.at).toLocaleString()}</p></div>
                  <button type="button" className="icon-btn" onClick={() => undo(c.at)} aria-label="Undo this correction"><Undo size={18} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
