"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, HOSTED, personId, useHref } from "@/components/api";
import { ThemeToggle } from "@/components/Theme";
import { ArrowLeft, Check, Loader, Shield, Trash } from "@/components/Icons";

type Source = "claude-ai" | "chatgpt" | "claude-code" | "granola" | "otter" | "imessage" | "whatsapp" | "email";
type Job = { id: string; source: Source | "sync"; file: string; started_at: string; finished_at?: string; state: "queued" | "running" | "done" | "failed"; error?: string };
type Summary = {
  generated_at: string;
  sources: Record<string, { windows: number; turns_scored?: number }>;
  dimensions: Record<string, { mean: number | null; spread: number; per_source: Record<string, number>; flag: string }>;
  observations: Record<string, string[]>;
  caveats: string[];
};
type ConnectorId = "claude_code" | "granola" | "claude_ai" | "otter" | "imessage" | "whatsapp" | "email";
type Connector = { id: ConnectorId; name: string; available: boolean; mode: "auto" | "one_click" | "claude_code" | "missing" | "connect" | "permission"; personal?: boolean; detail: string; enabled: boolean; last_sync?: string; items?: number; connected?: boolean; account?: string };

/** One card per source. `transcript` sources ask for the person's speaker label; `manual` ones (Mac-only) show steps instead of a picker. */
const SOURCES: { key: Source; name: string; how: string; accept: string; transcript?: boolean; manual?: string[] }[] = [
  { key: "claude-ai", name: "Claude.ai", how: "claude.ai, Settings, Privacy, Export data. The zip arrives by email; upload it here.", accept: ".zip,.json" },
  { key: "chatgpt", name: "ChatGPT", how: "chatgpt.com, Settings, Data controls, Export data. The zip arrives by email; upload it here.", accept: ".zip,.json" },
  { key: "granola", name: "Granola", how: "Open a note, tap Share, then Export transcript. Upload the file, or a zip of several.", accept: ".md,.txt,.json,.zip", transcript: true },
  { key: "otter", name: "Otter", how: "Open a conversation, tap Export, choose Text. Upload the .txt, or a zip of several.", accept: ".txt,.srt,.md,.zip", transcript: true },
  { key: "claude-code", name: "Claude Code", how: "Mac only. Your sessions already live on this Mac: it connects on its own under Your sources, so there is nothing to upload.", accept: "", manual: ["On the Mac that runs this app, open Connections and tap Sync now next to Claude Code.", "Or in Terminal: cd ~/SoulMap/evidence && uv run evidence import --source claude-code --file ~/.claude/projects --person <your id>", "Then: uv run evidence score --person <your id> --max-windows 12 --out-dir out/<your id>"] },
];

const DIMENSION_LABELS: Record<string, string> = {
  detail_level: "Detail", directness: "Directness", warmth: "Warmth", brevity_demand: "Wants it short", autonomy_granted: "Delegates",
  pace_pressure: "Pace pressure", structure_tolerance: "Likes structure", question_vs_statement: "Asks vs tells", repair_after_friction: "Resets after friction",
  vision_vs_execution: "Vision over steps", energy_markers: "Energy",
};
const STATE_LABEL: Record<Job["state"], string> = { queued: "queued", running: "summarizing on this Mac", done: "done, raw deleted", failed: "failed" };

/** The status chip per connector: what it does on its own, and what the person still has to do. */
function chipFor(c: Connector): { label: string; cls: string } {
  if (c.connected) return { label: "Connected", cls: "ok" };
  if (c.mode === "permission") return { label: "Needs your permission", cls: "active" };
  if (c.mode === "connect") return { label: "Not connected", cls: "muted" };
  if (c.mode === "auto" && c.available) return { label: "Connected automatically", cls: "ok" };
  if (c.mode === "claude_code") return { label: c.available ? "Ready from Claude Code" : "Syncs through Claude Code", cls: c.available ? "ok" : "muted" };
  if (c.mode === "one_click") return { label: "Needs one click", cls: "active" };
  return { label: "Not found on this Mac", cls: "muted" };
}

function sourceName(key: string) { return key === "sync" ? "Sync" : SOURCES.find((s) => s.key === key)?.name ?? key; }
function when(iso?: string) { return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never"; }

export default function EvidencePage() {
  const h = useHref();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [syncing, setSyncing] = useState<ConnectorId | "all" | null>(null);
  const [toggling, setToggling] = useState<ConnectorId | null>(null);
  const [speaker, setSpeaker] = useState("");
  const [busy, setBusy] = useState<Source | null>(null);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [purging, setPurging] = useState(false);
  const inputs = useRef<Partial<Record<Source, HTMLInputElement | null>>>({});

  const load = useCallback(async () => {
    const j = await api<{ jobs?: Job[]; summary?: Summary | null }>("/api/evidence");
    if (j._status === 200) { setJobs(j.jobs ?? []); setSummary(j.summary ?? null); }
    setLoaded(true);
  }, []);
  const loadConnectors = useCallback(async () => {
    if (HOSTED) return;
    const j = await api<{ hosted?: boolean; connectors?: Connector[] }>("/api/connectors");
    if (j._status === 200 && !j.hosted) setConnectors(j.connectors ?? []);
  }, []);

  // Back from Otter/Granola's sign-in page: say how it went, then drop the flag from the address.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ok = q.get("connected"), bad = q.get("connect_error");
    if (!ok && !bad) return;
    if (bad) setErr(`Could not connect: ${bad}`);
    q.delete("connected"); q.delete("connect_error");
    window.history.replaceState(null, "", window.location.pathname + (q.toString() ? `?${q}` : ""));
  }, []);

  const disconnect = async (c: Connector) => {
    setErr("");
    const j = await api<{ ok?: boolean; error?: string }>("/api/connectors/disconnect", { method: "POST", json: { id: c.id } });
    if (!j.ok) setErr(j.error ?? "could not disconnect");
    await loadConnectors();
  };

  useEffect(() => {
    load(); loadConnectors();
    api<{ profile?: { name?: string } }>("/api/live").then((j) => setSpeaker((s) => s || j.profile?.name || personId() || "")).catch(() => {});
  }, [load, loadConnectors]);

  // Poll while something is running; refresh connector rows (last sync) when it ends.
  const active = jobs.some((j) => j.state === "queued" || j.state === "running");
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) loadConnectors();
    wasActive.current = active;
    if (!active) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [active, load, loadConnectors]);

  const sync = async (id?: ConnectorId) => {
    if (syncing || active) return;
    setSyncing(id ?? "all"); setErr("");
    try {
      const j = await api<{ ok?: boolean; error?: string; synced?: string[]; skipped?: { id: string; why: string }[] }>("/api/connectors/sync", { method: "POST", json: id ? { ids: [id] } : {} });
      if (!j.ok) throw new Error(j.error ?? "sync failed");
      if (!j.synced?.length) setErr(id ? `Nothing to sync: ${j.skipped?.[0]?.why ?? "no data found"}` : "Nothing to sync right now.");
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "sync failed"); }
    finally { setSyncing(null); }
  };

  const toggle = async (c: Connector) => {
    if (toggling) return;
    setToggling(c.id); setErr("");
    try {
      const j = await api<{ ok?: boolean; error?: string }>("/api/connectors/toggle", { method: "POST", json: { id: c.id, enabled: !c.enabled } });
      if (!j.ok) throw new Error(j.error ?? "could not save");
      setConnectors((cs) => cs?.map((x) => (x.id === c.id ? { ...x, enabled: !c.enabled } : x)) ?? cs);
    } catch (e) { setErr(e instanceof Error ? e.message : "could not save"); }
    finally { setToggling(null); }
  };

  const upload = async (source: Source, file: File | undefined) => {
    if (!file || busy) return;
    setBusy(source); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("source", source);
      if (SOURCES.find((s) => s.key === source)?.transcript && speaker.trim()) fd.append("speaker", speaker.trim());
      const j = await api<{ ok?: boolean; error?: string }>("/api/evidence/upload", { method: "POST", body: fd });
      if (!j.ok) throw new Error(j.error ?? "upload failed");
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "upload failed"); }
    finally { setBusy(null); const el = inputs.current[source]; if (el) el.value = ""; }
  };

  const purge = async () => {
    setPurging(true); setErr("");
    try {
      const j = await api<{ ok?: boolean; error?: string }>("/api/evidence", { method: "DELETE" });
      if (!j.ok) throw new Error(j.error ?? "could not delete");
      setConfirm(false);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "could not delete"); }
    finally { setPurging(false); }
  };

  const dims = summary ? Object.entries(summary.dimensions).filter(([, d]) => d.mean !== null) : [];
  const observations = summary ? Object.entries(summary.observations) : [];
  const canSyncAll = !!connectors?.some((c) => c.available && c.enabled);

  return (
    <main className="mx-auto max-w-2xl">
      <header className="gutter flex items-center gap-2 pt-[max(8px,env(safe-area-inset-top))]">
        <a className="icon-btn" href={h("/")} aria-label="Back home"><ArrowLeft /></a>
        <h1 className="min-w-0 flex-1 truncate text-[var(--text-h2)]">Connections</h1>
        <ThemeToggle />
      </header>

      <div className="gutter safe-bottom flex flex-col gap-6 pt-4">
        <p className="t-small muted flex items-start gap-2"><Shield size={18} className="mt-0.5 shrink-0" /><span>Your sources are read on this Mac and summarized by the local model. Only numbers and short paraphrases are kept, nothing leaves the machine, and the report never sees anyone else&apos;s words.</span></p>

        {err && <p className="t-small text-[var(--color-danger)]" role="alert">{err}</p>}

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="flex-1">Your sources</h2>
            {!HOSTED && connectors && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={!canSyncAll || !!syncing || active} onClick={() => sync()}>
                {syncing === "all" || active ? <><Loader size={14} /> Syncing</> : "Sync now"}
              </button>
            )}
          </div>
          {HOSTED ? (
            <div className="card"><p className="t-small muted">Connections work on the Mac install; here you can upload exports.</p></div>
          ) : !connectors ? <p className="muted"><Loader /></p> : (
            <ul className="card flex flex-col divide-y divide-[var(--color-line)] p-0" aria-label="Connectors">
              {connectors.map((c) => {
                const chip = chipFor(c);
                return (
                  <li key={c.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{c.name}</p>
                        <p className="t-caption muted">Last sync {when(c.last_sync)}{summary?.sources[c.id.replace("_", "-")] ? ` · ${summary.sources[c.id.replace("_", "-")].windows} windows` : ""}</p>
                      </div>
                      <button type="button" role="switch" aria-checked={c.enabled} aria-label={`${c.name} on`} className="toggle" disabled={toggling === c.id} onClick={() => toggle(c)} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`chip ${chip.cls}`} style={{ minHeight: 28 }}>{chip.cls === "ok" && <Check size={14} />} {chip.label}</span>
                      {(c.id === "otter" || c.id === "granola") && !c.connected && (
                        <a className="btn btn-primary btn-sm" style={{ minHeight: 36 }} href={h(`/api/connectors/connect?id=${c.id}`)}>Connect</a>
                      )}
                      {c.mode === "permission" && (
                        <a className="btn btn-primary btn-sm" style={{ minHeight: 36 }} href="x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles">Open System Settings</a>
                      )}
                      {c.available && c.enabled && (
                        <button type="button" className="btn btn-ghost" style={{ minHeight: 36 }} disabled={!!syncing || active} onClick={() => sync(c.id)}>
                          {syncing === c.id ? <><Loader size={14} /> Syncing</> : "Sync now"}
                        </button>
                      )}
                    </div>
                    <p className="t-small muted">{c.personal && !c.enabled ? "Off until you turn it on. " : ""}{c.detail}</p>
                    {c.connected && <button type="button" className="t-caption muted self-start underline" onClick={() => disconnect(c)}>Disconnect</button>}
                  </li>
                );
              })}
            </ul>
          )}
          {!HOSTED && connectors?.some((c) => c.personal) && <PersonalNote />}
        </section>

        <section>
          <h2 className="mb-3">What the evidence says</h2>
          {!loaded ? <p className="muted"><Loader /></p> : !summary ? (
            <div className="card"><p className="t-small muted">Nothing summarized yet. {HOSTED ? "Add an export below" : "Tap Sync now, or add an export below"}; the first one takes a few minutes.</p></div>
          ) : (
            <div className="card flex flex-col gap-4">
              <p className="t-caption muted">From {Object.keys(summary.sources).map(sourceName).join(", ")}. {new Date(summary.generated_at).toLocaleString()}.</p>
              <ul className="flex flex-col gap-2.5" aria-label="Dimensions">
                {dims.map(([key, d]) => (
                  <li key={key}>
                    <div className="t-small flex items-baseline justify-between gap-3">
                      <span>{DIMENSION_LABELS[key] ?? key}</span>
                      <span className="t-caption muted tabular-nums">{Math.round(d.mean ?? 0)}{d.flag === "disagree" ? " · sources disagree" : ""}</span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-raised)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.mean ?? 0)} aria-label={DIMENSION_LABELS[key] ?? key}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, d.mean ?? 0))}%`, background: d.flag === "disagree" ? "var(--color-warn)" : "var(--color-accent)" }} />
                    </div>
                  </li>
                ))}
              </ul>
              {observations.map(([src, obs]) => obs.length > 0 && (
                <div key={src}>
                  <p className="t-label muted mb-1">{sourceName(src)}</p>
                  <ul className="flex flex-col gap-1">{obs.slice(0, 3).map((o, i) => <li key={i} className="t-small">{o}</li>)}</ul>
                </div>
              ))}
              {summary.caveats.length > 0 && <p className="t-caption muted">{summary.caveats.join(". ")}.</p>}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3">Or upload a file</h2>
          <div className="flex flex-col gap-2">
            {SOURCES.map((s) => (
              <div key={s.key} className="card flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-medium">{s.name}</span>
                  {summary?.sources[s.key] && <span className="chip ok" style={{ minHeight: 28 }}><Check size={14} /> {summary.sources[s.key].windows} windows</span>}
                </div>
                <p className="t-small muted">{s.how}</p>
                {s.manual ? (
                  <ol className="t-small flex flex-col gap-2">
                    {s.manual.map((step, n) => <li key={n} className="flex gap-3"><span className="display shrink-0 text-[1.25rem] leading-6 text-[var(--color-accent)]">{n + 1}</span><span className="min-w-0 break-words">{step}</span></li>)}
                  </ol>
                ) : (
                  <>
                    {s.transcript && (
                      <label className="t-small flex flex-col gap-1">
                        <span className="muted">Your name in the transcript</span>
                        <input className="field" value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="As the transcript labels you" autoComplete="off" />
                      </label>
                    )}
                    <input ref={(el) => { inputs.current[s.key] = el; }} type="file" accept={s.accept} className="sr-only" id={`file-${s.key}`} onChange={(e) => upload(s.key, e.target.files?.[0])} disabled={!!busy} />
                    <label htmlFor={`file-${s.key}`} className={`btn btn-secondary btn-block ${busy ? "opacity-40" : ""}`} style={{ minHeight: 48, cursor: busy ? "default" : "pointer" }}>
                      {busy === s.key ? <><Loader size={16} /> Uploading</> : "Choose file"}
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        {jobs.length > 0 && (
          <section>
            <h2 className="mb-3">Uploads and syncs</h2>
            <ul className="card flex flex-col divide-y divide-[var(--color-line)] p-0">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-col gap-1.5 px-4 py-3">
                  <p className="t-small truncate">{sourceName(j.source)} · {j.file}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="t-caption muted">{new Date(j.started_at).toLocaleString()}</p>
                    <span className={`chip shrink-0 ${j.state === "done" ? "ok" : j.state === "failed" ? "" : "muted"}`} style={{ minHeight: 28, ...(j.state === "failed" ? { color: "var(--color-danger)", borderColor: "var(--color-danger)" } : {}) }}>
                      {j.state === "running" || j.state === "queued" ? <Loader size={14} /> : j.state === "done" ? <Check size={14} /> : null} {j.source === "sync" && j.state === "done" ? "done" : STATE_LABEL[j.state]}
                    </span>
                  </div>
                  {j.error && <p className="t-caption text-[var(--color-danger)]">{j.error}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {(jobs.length > 0 || summary) && (
          <section className="card flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-[var(--text-h2)]"><Trash size={18} /> Delete all evidence</h2>
            <p className="t-small muted">Removes the summaries and anything cached for you on this Mac. Your interview and report stay.</p>
            {!confirm ? (
              <button type="button" className="btn btn-ghost self-start" onClick={() => setConfirm(true)}>Delete evidence</button>
            ) : (
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" style={{ background: "var(--color-danger)" }} disabled={purging} onClick={purge}>{purging ? <Loader size={16} /> : "Yes, delete it"}</button>
                <button type="button" className="btn btn-ghost" disabled={purging} onClick={() => setConfirm(false)}>Keep</button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

type AiState = { engine: string | null; personal_engine?: "claude" | "local"; managed?: boolean; local: { running: boolean; installed: boolean }; install: { state: string; step?: string; percent?: number } };

/** Messages and email: who reads them. Default is this Mac only, on the free local model. */
function PersonalNote() {
  const [ai, setAi] = useState<AiState | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<AiState>("/api/settings/ai").then((j) => { if (j._status === 200) setAi(j); }).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (ai?.install.state !== "running") return; const t = setInterval(load, 4000); return () => clearInterval(t); }, [ai?.install.state, load]);
  if (!ai || ai.managed) return null;
  const set = async (json: Record<string, unknown>) => { setBusy(true); await api("/api/settings/ai", { method: "POST", json }).catch(() => {}); setBusy(false); load(); };
  const local = ai.personal_engine !== "claude";
  return (
    <div className="card mt-3 flex flex-col gap-3">
      <h3 className="flex items-center gap-2"><Shield size={18} /> Messages and email</h3>
      <p className="t-small">{local ? "Only what you sent is read, and it is read on this Mac by a free local model. Nothing from your messages or email leaves this Mac; only the scores reach your report." : "Only what you sent is read. Claude scores it with your key; only the scores reach your report."}</p>
      {local && !ai.local.installed && (ai.install.state === "running"
        ? <p className="t-small muted"><Loader size={14} /> Downloading the local model{ai.install.percent ? `, ${ai.install.percent}%` : ""}. About 5 GB, once.</p>
        : <p className="t-small muted">The local model is not on this Mac yet, so messages and email are kept but not scored. It is a one-time download of about 5 GB.</p>)}
      <div className="flex flex-wrap gap-2">
        {local && !ai.local.installed && ai.install.state !== "running" && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => set({ install_local: true })}>Download the local model</button>}
        {ai.engine === "claude" && (local
          ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => set({ personal_engine: "claude" })}>Let Claude score them instead</button>
          : <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => set({ personal_engine: "local" })}>Keep them on this Mac only</button>)}
      </div>
    </div>
  );
}
