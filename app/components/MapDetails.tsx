"use client";

import { BIG5, ENNEA_NAMES, GENIUS_SHORT, VALUE_KEYS, nice, type Live, type MapRegion } from "./SoulMap";

/** Drucker's five questions, each with the choices that answer it. Learning is the way most of the remembered moments came in. */
const DRUCKER_ROWS: [string, [string, string][]][] = [
  ["How you perform", [["intake", "Taking things in"], ["shape", "First you want"], ["delivery", "Reports back"], ["with_people", "Best work"], ["role", "Role"], ["pace", "Pace"]]],
  ["How you learn", [["learning", "Fastest way in"], ["learning_slow", "Doesn't stick"]]],
  ["What you value", [["mirror", "In the mirror"], ["value_clash", "Line not to cross"]]],
  ["Where you belong", [["setting", "Setting"], ["best_fit", "Best fit so far"]]],
  ["What you contribute", [["needed", "Needed now"], ["result", "In 18 months"]]],
];

/** Wealth Dynamics in plain words: what each energy and profile means in a working day. */
const WD_ENERGY: Record<string, string> = { dynamo: "Ideas, creating", blaze: "People, connecting", tempo: "Timing, doing", steel: "Detail, systems" };
const WD_PLAIN: Record<string, string> = {
  Creator: "You make value by starting new things. Hand the running of them to others.",
  Star: "You make value by being the face and voice of an idea. Put yourself out front.",
  Supporter: "You make value through people: leading, connecting, lifting a team.",
  "Deal Maker": "You make value by bringing the right people together at the right moment.",
  Trader: "You make value through timing and a steady hand: acting when the moment is right.",
  Accumulator: "You make value by building steadily and reliably, and keeping what you build.",
  Lord: "You make value by controlling the detail: systems, numbers and cash flow.",
  Mechanic: "You make value by making things work better and turning them into systems.",
};

/** Full-width cards under the map for everything the phone-size SVG hides. Each card carries id=`map-<region>`. */
export function MapDetails({ live, regions }: { live: Live; regions?: MapRegion[] }) {
  const enabled = new Set(live.enabled ?? ["human_design", "gene_keys", "enneagram", "attachment", "bigfive", "chronotype", "values"]);
  const show = (r: MapRegion) => (!regions || regions.includes(r)) && (r === "kolbe" || r === "working_genius" ? enabled.has(r) : true);
  const gk = Object.entries(live.chart?.gene_keys?.activation ?? {});
  const Bar = ({ label, v, max = 100, text }: { label: string; v: number | null; max?: number; text?: string }) => (
    <div className="flex items-center gap-3">
      <span className="t-caption w-28 shrink-0 truncate muted">{label}</span>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]">
        <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${v === null ? 0 : (v / max) * 100}%`, transition: "width 320ms var(--ease-out)" }} />
      </span>
      <span className="t-caption w-10 text-right tabular-nums">{text ?? (v === null ? "–" : Math.round(v))}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 fade-in-stagger">
      {show("human_design") && (
        <section id="map-human_design" className="card">
          <h3 className="mb-1">Human Design</h3>
          {live.chart?.type ? (
            <p className="t-small">{live.chart.type}{live.chart.profile ? ` · ${live.chart.profile}` : ""}. {live.chart.authority} authority{live.chart.strategy ? `, ${live.chart.strategy.toLowerCase()}` : ""}.{live.approx ? " Birth time not sure, so the chart is approximate." : ""}</p>
          ) : <p className="t-small muted">Fills in from your birth date, time and place.</p>}
          {!!live.chart?.defined_centers?.length && <p className="t-caption muted mt-2">Defined: {live.chart.defined_centers.join(", ")}</p>}
        </section>
      )}
      {show("gene_keys") && (
        <section id="map-gene_keys" className="card">
          <h3 className="mb-2">Gene Keys</h3>
          {gk.length ? (
            <ul className="flex flex-col gap-2">
              {gk.map(([sphere, g]) => (
                <li key={sphere} className="flex items-baseline gap-3">
                  <span className="display shrink-0 text-[1.375rem] text-[var(--color-accent)]">{g.key}.{g.line}</span>
                  <span className="t-small"><span className="muted">{nice(sphere)}</span>{g.gift ? ` · ${g.gift}` : ""}{g.shadow ? <span className="muted"> · shadow {g.shadow}</span> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="t-small muted">Fills in with the chart.</p>}
        </section>
      )}
      {show("enneagram") && (
        <section id="map-enneagram" className="card">
          <h3 className="mb-2">Enneagram</h3>
          {live.enneagram?.type ? (() => {
            const sc = live.enneagram.scores;
            const top = Math.max(...sc);
            const tied = sc.filter((v) => v === top).length > 1;
            return <p className="t-small mb-3">Leading type {live.enneagram.type}, {ENNEA_NAMES[live.enneagram.type - 1]}{live.enneagram.wing ? ` with a ${live.enneagram.wing} wing` : ""}.{tied ? " Several types are tied so far; " : " "}Confidence {Math.round((live.enneagram.confidence ?? 0) * 100)}%.</p>;
          })() : <p className="t-small muted mb-3">Nine points grow as you answer.</p>}
          <div className="flex flex-col gap-1.5">{(live.enneagram?.scores ?? Array<number | null>(9).fill(null)).map((s, i) => <Bar key={i} label={`${i + 1} ${ENNEA_NAMES[i]}`} v={s} max={Math.max(1, ...((live.enneagram?.scores ?? [1]) as number[]))} text={s === null ? "–" : s.toFixed(1)} />)}</div>
        </section>
      )}
      {show("attachment") && (
        <section id="map-attachment" className="card">
          <h3 className="mb-2">Attachment</h3>
          <div className="flex gap-4">
            <svg width={200} height={200} viewBox="0 0 200 200" className="shrink-0" role="img" aria-label="Attachment compass">
              <rect x={10} y={10} width={180} height={180} fill="none" stroke="var(--color-line)" />
              <line x1={100} y1={10} x2={100} y2={190} stroke="var(--color-line)" />
              <line x1={10} y1={100} x2={190} y2={100} stroke="var(--color-line)" />
              <text x={14} y={24} fill="var(--color-muted)" fontSize={11}>secure</text>
              <text x={186} y={24} textAnchor="end" fill="var(--color-muted)" fontSize={11}>anxious</text>
              <text x={14} y={184} fill="var(--color-muted)" fontSize={11}>avoidant</text>
              <text x={186} y={184} textAnchor="end" fill="var(--color-muted)" fontSize={11}>fearful</text>
              {live.attachment && <circle cx={10 + live.attachment.anxiety * 180} cy={10 + live.attachment.avoidance * 180} r={8} fill="var(--color-accent)" />}
            </svg>
            <div className="t-small">
              {live.attachment ? <p>{nice(live.attachment.style ?? "")}. Anxiety {Math.round(live.attachment.anxiety * 100)}, avoidance {Math.round(live.attachment.avoidance * 100)} (of 100).</p> : <p className="muted">Anxiety left to right, avoidance top to bottom.</p>}
            </div>
          </div>
        </section>
      )}
      {show("bigfive") && (
        <section id="map-bigfive" className="card">
          <h3 className="mb-2">Big Five</h3>
          <div className="flex flex-col gap-1.5">{BIG5.map((d) => <Bar key={d} label={nice(d)} v={live.bigfive?.scores?.[d] ?? null} />)}</div>
          {live.bigfive && <p className="t-caption muted mt-2">Confidence {Math.round(live.bigfive.confidence * 100)}%</p>}
        </section>
      )}
      {show("chronotype") && (
        <section id="map-chronotype" className="card">
          <h3 className="mb-1">Body clock</h3>
          {live.chronotype ? (() => {
            const c = live.chronotype;
            const toH = (t?: string) => { const m = (t ?? "").match(/^(\d{1,2}):(\d{2})$/); if (!m) return null; const h = Number(m[1]) + Number(m[2]) / 60; return h >= 0 && h < 24 ? h : null; };
            const wake = toH(c.natural_wake), bed = toH(c.natural_bed);
            // bed at or after wake on the clock means bed is the night before: 23:00 -> 07:00 is 8 h
            const sleep = wake !== null && bed !== null ? Math.round(((wake - bed + 24) % 24) * 10) / 10 : null;
            return <p className="t-small">{nice(c.label)}. Peak {c.peak_window}{wake !== null ? `; natural wake ${c.natural_wake}` : ""}{bed !== null ? `, bed ${c.natural_bed}` : ""}{sleep !== null && sleep > 0 ? ` (about ${sleep} h of sleep)` : ""}.</p>;
          })() : <p className="t-small muted">Two clock questions and a few statements.</p>}
        </section>
      )}
      {show("values") && (
        <section id="map-values" className="card">
          <h3 className="mb-2">Values</h3>
          {live.values?.top?.length ? <p className="t-small mb-3">Top three: {live.values.top.slice(0, 3).map(nice).join(", ")}.</p> : <p className="t-small muted mb-3">Ten values, ranked against your own average.</p>}
          <div className="flex flex-col gap-1.5">{VALUE_KEYS.map((k) => { const c = live.values?.centered?.[k]; return <Bar key={k} label={nice(k)} v={typeof c === "number" ? c + 2.5 : null} max={5} text={typeof c === "number" ? (c > 0 ? "+" : "") + c.toFixed(1) : "–"} />; })}</div>
        </section>
      )}
      {show("drucker") && (
        <section id="map-drucker" className="card">
          <h3 className="mb-2">How you work best</h3>
          {live.drucker && Object.keys(live.drucker.choices).length ? (
            <div className="flex flex-col gap-3">
              {DRUCKER_ROWS.map(([q, rows]) => {
                const shown = rows.filter(([k]) => live.drucker!.choices[k]);
                if (!shown.length) return null;
                return (
                  <div key={q}>
                    <p className="t-caption mb-1">{q}</p>
                    <ul className="t-small flex flex-col gap-1.5">
                      {shown.map(([k, label]) => {
                        const c = live.drucker!.choices[k];
                        const l = k === "learning" ? live.drucker!.learning : null;
                        return <li key={k} className="flex gap-3"><span className="t-caption w-28 shrink-0 muted">{label}</span><span>{c.text}{l && l.of > 1 ? ` (${l.count} of ${l.of} moments${l.tie ? ", a tie" : ""})` : ""}</span></li>;
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : <p className="t-small muted">Sixteen quick choices, after Peter Drucker&apos;s five questions: how you perform, learn, value, belong and contribute.</p>}
        </section>
      )}
      {show("wealth_dynamics") && (
        <section id="map-wealth_dynamics" className="card">
          <h3 className="mb-2">How you create value{live.wealth_dynamics?.profile ? ` · ${live.wealth_dynamics.profile}` : ""}</h3>
          {live.wealth_dynamics ? (
            <>
              <p className="t-small mb-3">{WD_PLAIN[live.wealth_dynamics.profile] ?? ""}</p>
              <div className="flex flex-col gap-1.5">{(["dynamo", "blaze", "tempo", "steel"] as const).map((k) => <Bar key={k} label={WD_ENERGY[k]} v={live.wealth_dynamics!.energies[k] ?? 0} max={100} text={`${live.wealth_dynamics!.energies[k] ?? 0}%`} />)}</div>
            </>
          ) : <p className="t-small muted">Twelve quick choices, after Roger Hamilton&apos;s Wealth Dynamics: which kind of work and money-making fits you.</p>}
        </section>
      )}
      {show("kolbe") && (
        <section id="map-kolbe" className="card">
          <h3 className="mb-2">Kolbe A{live.kolbe?.mo ? ` · ${live.kolbe.mo}` : ""}</h3>
          <div className="flex flex-col gap-1.5">{(["fact_finder", "follow_thru", "quick_start", "implementor"] as const).map((k) => <Bar key={k} label={nice(k)} v={live.kolbe?.[k] ?? null} max={10} />)}</div>
        </section>
      )}
      {show("working_genius") && (
        <section id="map-working_genius" className="card">
          <h3 className="mb-2">Working Genius</h3>
          <div className="flex flex-col gap-1.5">{Object.keys(GENIUS_SHORT).map((g) => { const r = live.working_genius?.ranking?.find((x) => x.genius === g); return <Bar key={g} label={`${nice(g)}${r ? ` · ${r.band}` : ""}`} v={r?.energy ?? null} />; })}</div>
        </section>
      )}
    </div>
  );
}
