"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Soul Map: one SVG that fills in while the person answers.
 *  - Centre: Human Design bodygraph (9 centres light up when defined; dashed when birth time is not sure)
 *  - Inner ring: Enneagram, 9 points; each grows with evidence
 *  - Outer rim: Gene Keys activation sequence once the chart exists
 *  - Corners: attachment compass (BL), paid action lens (BR: Kolbe, else Working Genius), values wheel (TL), Big Five bars (TR)
 *  - Bottom centre: chronotype, a 24-hour arc with the peak window lit
 * Everything is driven by `live`, computed server-side. Below 400px the corners and labels hide (cards take over).
 */

export type Live = {
  progress: { enneagram: number; attachment: number; kolbe: number; birth: number; bigfive?: number; chronotype?: number; values?: number; working_genius?: number }; // 0..1
  enneagram: { scores: number[]; type: number | null; wing: number | null; confidence: number } | null;
  attachment: { anxiety: number; avoidance: number; style: string | null; confidence?: number } | null;
  kolbe: { fact_finder: number | null; follow_thru: number | null; quick_start: number | null; implementor: number | null; mo: string | null; confidence?: number } | null;
  bigfive?: { scores: Record<string, number>; levels?: Record<string, string>; confidence: number } | null;
  chronotype?: { label: string; score: number; peak_window: string; natural_wake?: string; natural_bed?: string; confidence: number } | null;
  values?: { centered: Record<string, number>; top: string[]; confidence: number } | null;
  drucker?: { choices: Record<string, { value: string; text: string }>; learning?: { value: string; text: string; count: number; of: number; tie: boolean } | null } | null;
  wealth_dynamics?: { profile: string; primary: string; secondary: string; energies: Record<string, number> } | null;
  working_genius?: { ranking: { genius: string; name?: string; band: string; energy: number }[]; confidence: number } | null;
  enabled?: string[]; // lenses drawn; paid lenses absent = not drawn at all
  approx?: boolean; // birth time not sure: birth lenses draw dashed
  chart: {
    type?: string;
    profile?: string;
    authority?: string;
    strategy?: string;
    defined_centers?: string[];
    channels?: { gates: [number, number]; name?: string }[] | string[];
    gene_keys?: { activation?: Record<string, { key: number; line: number; gift?: string; shadow?: string; siddhi?: string }> };
  } | null;
  agentTalking?: boolean;
};

export type MapRegion = "human_design" | "gene_keys" | "enneagram" | "attachment" | "kolbe" | "working_genius" | "bigfive" | "values" | "chronotype" | "drucker" | "wealth_dynamics";

const CENTERS: { id: string; x: number; y: number; shape: "tri" | "sq" | "dia" | "tri-down" }[] = [
  { id: "Head", x: 0, y: -150, shape: "tri" },
  { id: "Ajna", x: 0, y: -105, shape: "tri-down" },
  { id: "Throat", x: 0, y: -55, shape: "sq" },
  { id: "G", x: 0, y: 0, shape: "dia" },
  { id: "Heart", x: 48, y: 22, shape: "tri" },
  { id: "Spleen", x: -85, y: 80, shape: "tri" },
  { id: "Sacral", x: 0, y: 70, shape: "sq" },
  { id: "Solar Plexus", x: 85, y: 80, shape: "tri" },
  { id: "Root", x: 0, y: 150, shape: "sq" },
];

export const ENNEA_NAMES = ["Reformer", "Helper", "Achiever", "Individualist", "Investigator", "Loyalist", "Enthusiast", "Challenger", "Peacemaker"];
export const BIG5 = ["openness", "conscientiousness", "extraversion", "agreeableness", "emotional_stability"] as const;
export const BIG5_SHORT: Record<string, string> = { openness: "O", conscientiousness: "C", extraversion: "E", agreeableness: "A", emotional_stability: "S" };
export const VALUE_KEYS = ["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"] as const;
export const GENIUS_SHORT: Record<string, string> = { wonder: "W", invention: "I", discernment: "D", galvanizing: "G", enablement: "E", tenacity: "T" };
export const nice = (s: string) => s.replace(/_/g, " ");

function shapePath(s: (typeof CENTERS)[number]["shape"], x: number, y: number, r = 16) {
  if (s === "sq") return `M${x - r},${y - r} h${2 * r} v${2 * r} h${-2 * r} z`;
  if (s === "dia") return `M${x},${y - r * 1.2} L${x + r * 1.2},${y} L${x},${y + r * 1.2} L${x - r * 1.2},${y} z`;
  if (s === "tri-down") return `M${x - r},${y - r * 0.8} L${x + r},${y - r * 0.8} L${x},${y + r} z`;
  return `M${x},${y - r} L${x + r},${y + r * 0.8} L${x - r},${y + r * 0.8} z`;
}

function norm(id: string) { return id.toLowerCase().replace(/[^a-z]/g, ""); }
const polar = (cx: number, cy: number, r: number, deg: number) => ({ x: cx + r * Math.cos((deg * Math.PI) / 180), y: cy + r * Math.sin((deg * Math.PI) / 180) });
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${p0.x},${p0.y} A${r},${r} 0 ${large} 1 ${p1.x},${p1.y}`;
}
/** "7:30" or "7:30 am" → hours 0..24 */
export function clockToHours(s?: string): number | null {
  if (!s) return null;
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]) + Number(m[2] ?? 0) / 60;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h >= 12) h -= 12;
  return h;
}
/** "9:00 am–12:00 pm" → [9, 12] */
export function peakToHours(win?: string): [number, number] | null {
  if (!win) return null;
  const [a, b] = win.split(/[–-]/).map((x) => clockToHours(x.trim()));
  if (a === null || b === null || a === undefined || b === undefined) return null;
  return [a, b < a ? b + 24 : b];
}

type Props = { live: Live; compact?: boolean; onRegion?: (r: MapRegion) => void; className?: string };

export function SoulMap({ live, compact: compactProp, onRegion, className }: Props) {
  const W = 760;
  const H = 760;
  const cx = W / 2;
  const cy = H / 2 - 20;
  const R_ENNEA = 250;
  const R_RIM = 330;

  // Measure the container; below 400px the corners hide and the viewBox tightens to the rim.
  const wrap = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (compactProp !== undefined || !wrap.current) return;
    const el = wrap.current;
    const ro = new ResizeObserver((es) => { for (const e of es) setMeasured(e.contentRect.width); });
    ro.observe(el);
    setMeasured(el.clientWidth);
    return () => ro.disconnect();
  }, [compactProp]);
  const compact = compactProp ?? (measured !== null && measured < 400);
  const scale = measured ? measured / W : 1;
  // minimum rendered label is 11px: keep a label in the SVG only when fontSize * scale >= 11
  const fs = (desktop: number, phone: number) => (compact ? phone : desktop);
  const labelOk = (size: number) => size * scale >= 11 || scale >= 1 || measured === null;

  const enabled = new Set(live.enabled ?? ["human_design", "gene_keys", "enneagram", "attachment", "bigfive", "chronotype", "values", "kolbe"]);
  const drawKolbe = enabled.has("kolbe") && (live.enabled ? true : !!live.kolbe);
  const drawWG = enabled.has("working_genius");
  const defined = new Set((live.chart?.defined_centers ?? []).map(norm));
  const ennea = live.enneagram?.scores ?? Array(9).fill(0);
  const enneaMax = Math.max(0.0001, ...ennea);
  const p = live.progress;
  const parts = [p.enneagram, p.attachment, p.birth, p.bigfive ?? 0, p.chronotype ?? 0, p.values ?? 0];
  if (drawKolbe) parts.push(p.kolbe);
  if (drawWG) parts.push(p.working_genius ?? 0);
  const totalProgress = parts.reduce((a, b) => a + b, 0) / parts.length;
  const conf = (c?: number) => 0.55 + 0.45 * Math.max(0, Math.min(1, c ?? 1));
  const dash = live.approx ? "6 5" : undefined;

  const enneaPts = Array.from({ length: 9 }, (_, i) => {
    const t = i === 0 ? 9 : i;
    const ang = (-90 + (t % 9) * 40) * (Math.PI / 180);
    return { t, x: cx + R_ENNEA * Math.cos(ang), y: cy + R_ENNEA * Math.sin(ang) };
  });
  const byType = new Map(enneaPts.map((q) => [q.t, q]));

  const gk = live.chart?.gene_keys?.activation ?? null;
  const gkEntries = gk ? Object.entries(gk) : [];

  // chronotype arc geometry (bottom centre, a 24h half-dial from 18:00 left to 18:00 right, noon at top)
  const CH = { cx, cy: H - 40, r: 120 };
  const hourAngle = (h: number) => 180 + ((((h - 18) % 24) + 24) % 24) * (180 / 24); // 18:00 → 180°, 06:00 → 270°(top), 18:00 → 360°
  const peak = peakToHours(live.chronotype?.peak_window);
  const wake = clockToHours(live.chronotype?.natural_wake);
  const bed = clockToHours(live.chronotype?.natural_bed);

  const region = (r: MapRegion, cls = "") => (onRegion ? { onClick: () => onRegion(r), className: `${cls} map-region`.trim(), role: "button" as const, tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") onRegion(r); } } : { className: cls || undefined });

  return (
    <div ref={wrap} className={`theme-dark h-full w-full ${className ?? ""}`}>
      <svg viewBox={compact ? `0 40 ${W} 680` : `0 0 ${W} ${H}`} className={`soulmap h-full w-full ${compact ? "compact" : ""}`} role="img" aria-label="Soul map, building as you answer">
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* breathing field: earned by progress, starts at nothing */}
        <circle cx={cx} cy={cy} r={R_RIM + 40} fill="url(#glow)" opacity={totalProgress} className={live.agentTalking ? "orb-talk" : "orb-breathe"} style={{ transformOrigin: `${cx}px ${cy}px` }} />

        {/* outer rim: gene keys */}
        <g {...region("gene_keys")}>
          <circle cx={cx} cy={cy} r={R_RIM} fill="none" stroke="var(--color-line)" strokeWidth={1} strokeDasharray="2 6" />
          {gkEntries.map(([sphere, g], i) => {
            const ang = (-90 + i * (360 / Math.max(4, gkEntries.length))) * (Math.PI / 180);
            const x = cx + R_RIM * Math.cos(ang);
            const y = cy + R_RIM * Math.sin(ang);
            return (
              <g key={sphere} className="fade-in">
                <circle cx={x} cy={y} r={22} fill="var(--color-bg-soft)" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray={dash} />
                <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" fill="var(--color-ink)" fontSize={fs(14, 24)} fontFamily="var(--font-display)">{g.key}.{g.line}</text>
                <g className="map-sphere-label">
                  <text x={x} y={y + 36} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>{nice(sphere)}</text>
                  {g.gift && <text x={x} y={y + 49} textAnchor="middle" fill="var(--color-accent)" fontSize={10}>{g.gift}</text>}
                </g>
              </g>
            );
          })}
        </g>

        {/* enneagram */}
        <g {...region("enneagram")} opacity={live.enneagram ? conf(live.enneagram.confidence) : 1}>
          <g stroke="var(--color-line)" strokeWidth={1} fill="none" opacity={0.3 + p.enneagram * 0.7}>
            <polygon points={[3, 6, 9].map((t) => `${byType.get(t)!.x},${byType.get(t)!.y}`).join(" ")} />
            <polyline points={[1, 4, 2, 8, 5, 7, 1].map((t) => `${byType.get(t)!.x},${byType.get(t)!.y}`).join(" ")} />
          </g>
          {enneaPts.map((q) => {
            const s = ennea[q.t - 1] ?? 0;
            const rel = s / enneaMax;
            const isTop = live.enneagram?.type === q.t;
            const r = 6 + rel * 22 * Math.min(1, p.enneagram * 1.5 + 0.2);
            return (
              <g key={q.t}>
                <circle cx={q.x} cy={q.y} r={compact ? Math.max(r, 14) : r} fill={isTop ? "var(--color-accent)" : "var(--color-bg-soft)"} stroke={isTop ? "var(--color-accent)" : "var(--color-muted)"} strokeWidth={1.5} style={{ transition: "r 320ms var(--ease-out), fill 320ms var(--ease-out)" }} />
                <text x={q.x} y={q.y + 1} textAnchor="middle" dominantBaseline="middle" fill={isTop ? "var(--color-accent-ink)" : "var(--color-ink)"} fontSize={fs(13, 24)} fontFamily="var(--font-display)">{q.t}</text>
                {isTop && labelOk(12) && <text x={q.x} y={q.y + r + 16} textAnchor="middle" fill="var(--color-accent)" fontSize={fs(11, 12)}>{ENNEA_NAMES[q.t - 1]}{live.enneagram?.wing ? ` w${live.enneagram.wing}` : ""}</text>}
              </g>
            );
          })}
        </g>

        {/* bodygraph */}
        <g {...region("human_design")}>
          <g stroke="var(--color-line)" strokeWidth={2}>
            {[["Head", "Ajna"], ["Ajna", "Throat"], ["Throat", "G"], ["G", "Sacral"], ["Sacral", "Root"], ["Throat", "Heart"], ["Heart", "G"], ["Throat", "Spleen"], ["Throat", "Solar Plexus"], ["Spleen", "Sacral"], ["Solar Plexus", "Sacral"], ["Spleen", "Root"], ["Solar Plexus", "Root"], ["Heart", "Solar Plexus"], ["G", "Spleen"]].map(([a, b]) => {
              const A = CENTERS.find((c) => c.id === a)!;
              const B = CENTERS.find((c) => c.id === b)!;
              const on = defined.has(norm(a)) && defined.has(norm(b));
              return <line key={a + b} x1={cx + A.x} y1={cy + A.y} x2={cx + B.x} y2={cy + B.y} stroke={on ? "var(--color-accent)" : "var(--color-line)"} strokeWidth={on ? 3 : 1.5} opacity={on ? 0.9 : 0.6} strokeDasharray={on ? dash : undefined} />;
            })}
          </g>
          {CENTERS.map((c) => {
            const on = defined.has(norm(c.id));
            return <path key={c.id} d={shapePath(c.shape, cx + c.x, cy + c.y)} fill={on ? "var(--color-accent)" : "var(--color-bg)"} stroke={on ? "var(--color-accent)" : "var(--color-muted)"} strokeWidth={1.5} strokeDasharray={on ? dash : undefined} fillOpacity={on && live.approx ? 0.55 : 1} style={{ transition: "fill 320ms var(--ease-out)" }} />;
          })}
          {live.chart?.type && (
            <g className="fade-in">
              <text x={cx} y={cy + 200} textAnchor="middle" fill="var(--color-ink)" fontSize={fs(18, 30)} fontFamily="var(--font-display)">{live.chart.type}{live.chart.profile ? ` · ${live.chart.profile}` : ""}</text>
              {labelOk(12) && <text x={cx} y={cy + 222} textAnchor="middle" fill="var(--color-muted)" fontSize={fs(12, 14)}>{live.chart.authority} authority{live.chart.strategy ? ` · ${live.chart.strategy}` : ""}{live.approx ? " · time approximate" : ""}</text>}
            </g>
          )}
        </g>

        {/* TL: values wheel */}
        <g transform="translate(30, 30)" opacity={0.35 + (p.values ?? 0) * 0.65} {...region("values", "map-corner")}>
          <text x={70} y={-6} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>values</text>
          <circle cx={70} cy={70} r={60} fill="none" stroke="var(--color-line)" />
          <circle cx={70} cy={70} r={30} fill="none" stroke="var(--color-line)" strokeDasharray="2 4" />
          {VALUE_KEYS.map((k, i) => {
            const ang = -90 + i * 36;
            const c = live.values?.centered?.[k] ?? 0; // about -2.5..+2.5
            const len = 30 + Math.max(-28, Math.min(28, c * 12));
            const top = live.values?.top?.includes(k);
            const a = polar(70, 70, 0, ang), b = polar(70, 70, len, ang);
            return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={top ? "var(--color-accent)" : "var(--color-muted)"} strokeWidth={top ? 4 : 2} strokeLinecap="round" opacity={live.values ? 1 : 0.4} style={{ transition: "all 320ms var(--ease-out)" }} />;
          })}
          {live.values?.top?.slice(0, 3).map((k, i) => (
            <text key={k} x={70} y={150 + i * 13} textAnchor="middle" fill={i === 0 ? "var(--color-accent)" : "var(--color-muted)"} fontSize={10}>{nice(k)}</text>
          ))}
        </g>

        {/* TR: Big Five bars */}
        <g transform={`translate(${W - 190}, 30)`} opacity={0.35 + (p.bigfive ?? 0) * 0.65} {...region("bigfive", "map-corner")}>
          <text x={70} y={-6} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>big five</text>
          <line x1={0} y1={65} x2={150} y2={65} stroke="var(--color-line)" strokeDasharray="2 4" />
          {BIG5.map((d, i) => {
            const v = live.bigfive?.scores?.[d];
            const h = typeof v === "number" ? (v / 100) * 120 : 4;
            return (
              <g key={d}>
                <rect x={i * 30} y={125 - h} width={22} height={h} rx={3} fill={typeof v === "number" ? "var(--color-accent)" : "var(--color-line)"} opacity={typeof v === "number" ? 0.5 + 0.5 * (live.bigfive?.confidence ?? 1) : 1} style={{ transition: "height 320ms var(--ease-out), y 320ms var(--ease-out)" }} />
                <text x={i * 30 + 11} y={139} textAnchor="middle" fill="var(--color-muted)" fontSize={9}>{BIG5_SHORT[d]}</text>
              </g>
            );
          })}
        </g>

        {/* BL: attachment compass */}
        <g transform={`translate(70, ${H - 150})`} opacity={0.35 + p.attachment * 0.65} {...region("attachment", "map-compass")}>
          <rect x={0} y={0} width={120} height={120} fill="none" stroke="var(--color-line)" />
          <line x1={60} y1={0} x2={60} y2={120} stroke="var(--color-line)" />
          <line x1={0} y1={60} x2={120} y2={60} stroke="var(--color-line)" />
          <text x={60} y={-6} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>attachment</text>
          <text x={-4} y={64} textAnchor="end" fill="var(--color-muted)" fontSize={9}>low anx</text>
          <text x={124} y={64} fill="var(--color-muted)" fontSize={9}>high anx</text>
          <text x={60} y={134} textAnchor="middle" fill="var(--color-muted)" fontSize={9}>avoidance, down</text>
          {live.attachment && <circle cx={live.attachment.anxiety * 120} cy={live.attachment.avoidance * 120} r={7} fill="var(--color-accent)" style={{ transition: "cx 320ms var(--ease-out), cy 320ms var(--ease-out)" }} />}
          {live.attachment?.style && <text x={60} y={150} textAnchor="middle" fill="var(--color-accent)" fontSize={11}>{nice(live.attachment.style)}</text>}
        </g>

        {/* BR: the paid action lens, only when enabled. Kolbe first; Working Genius otherwise. */}
        {drawKolbe && (
          <g transform={`translate(${W - 190}, ${H - 150})`} opacity={0.35 + p.kolbe * 0.65} {...region("kolbe", "map-bars")}>
            <text x={60} y={-6} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>Kolbe{live.kolbe?.mo ? ` · ${live.kolbe.mo}` : ""}</text>
            {(["fact_finder", "follow_thru", "quick_start", "implementor"] as const).map((k, i) => {
              const v = live.kolbe?.[k] ?? null;
              const h = v ? (v / 10) * 110 : 4;
              return (
                <g key={k}>
                  <rect x={i * 30} y={120 - h} width={22} height={h} rx={3} fill={v ? "var(--color-accent)" : "var(--color-line)"} style={{ transition: "height 320ms var(--ease-out), y 320ms var(--ease-out)" }} />
                  <text x={i * 30 + 11} y={134} textAnchor="middle" fill="var(--color-muted)" fontSize={9}>{["FF", "FT", "QS", "IM"][i]}</text>
                  {v && <text x={i * 30 + 11} y={120 - h - 4} textAnchor="middle" fill="var(--color-ink)" fontSize={10}>{v}</text>}
                </g>
              );
            })}
          </g>
        )}
        {drawWG && (
          <g transform={drawKolbe ? `translate(${W - 110}, 200)` : `translate(${W - 190}, ${H - 150})`} opacity={0.35 + (p.working_genius ?? 0) * 0.65} {...region("working_genius", "map-bars")}>
            <text x={drawKolbe ? 45 : 60} y={-6} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>working genius</text>
            {["wonder", "invention", "discernment", "galvanizing", "enablement", "tenacity"].map((g, i) => {
              const row = live.working_genius?.ranking?.find((r) => r.genius === g);
              const v = row?.energy ?? null;
              const bw = drawKolbe ? 12 : 20, step = drawKolbe ? 15 : 24;
              const h = v !== null ? (v / 100) * 110 : 4;
              const col = row?.band === "genius" ? "var(--color-accent)" : row?.band === "competency" ? "var(--color-muted)" : "var(--color-line)";
              return (
                <g key={g}>
                  <rect x={i * step} y={120 - h} width={bw} height={h} rx={3} fill={v !== null ? col : "var(--color-line)"} style={{ transition: "height 320ms var(--ease-out), y 320ms var(--ease-out)" }} />
                  <text x={i * step + bw / 2} y={134} textAnchor="middle" fill="var(--color-muted)" fontSize={9}>{GENIUS_SHORT[g]}</text>
                </g>
              );
            })}
          </g>
        )}

        {/* bottom centre: chronotype 24h arc */}
        <g opacity={0.35 + (p.chronotype ?? 0) * 0.65} {...region("chronotype", "map-chrono")}>
          <path d={arcPath(CH.cx, CH.cy, CH.r, 180, 359.9)} fill="none" stroke="var(--color-line)" strokeWidth={1.5} />
          {[0, 6, 12].map((h) => { const a = polar(CH.cx, CH.cy, CH.r, hourAngle(h)); const b = polar(CH.cx, CH.cy, CH.r - 6, hourAngle(h)); return <line key={h} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-muted)" />; })}
          <text x={CH.cx - CH.r - 6} y={CH.cy + 4} textAnchor="end" fill="var(--color-muted)" fontSize={9}>6pm</text>
          <text x={CH.cx} y={CH.cy - CH.r - 8} textAnchor="middle" fill="var(--color-muted)" fontSize={9}>6am</text>
          <text x={CH.cx + CH.r + 6} y={CH.cy + 4} fill="var(--color-muted)" fontSize={9}>6pm</text>
          {peak && <path d={arcPath(CH.cx, CH.cy, CH.r, hourAngle(peak[0]), hourAngle(peak[1]))} fill="none" stroke="var(--color-accent)" strokeWidth={6} strokeLinecap="round" opacity={0.5 + 0.5 * (live.chronotype?.confidence ?? 1)} />}
          {bed !== null && wake !== null && <path d={arcPath(CH.cx, CH.cy, CH.r - 12, hourAngle(bed), hourAngle(wake) < hourAngle(bed) ? hourAngle(wake) + 180 : hourAngle(wake))} fill="none" stroke="var(--color-muted)" strokeWidth={3} strokeLinecap="round" opacity={0.6} />}
          {live.chronotype?.label && <text x={CH.cx} y={CH.cy - 14} textAnchor="middle" fill="var(--color-accent)" fontSize={11}>{nice(live.chronotype.label)}{live.chronotype.peak_window ? ` · peak ${live.chronotype.peak_window}` : ""}</text>}
          {!live.chronotype && <text x={CH.cx} y={CH.cy - 14} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>body clock</text>}
        </g>

        {/* progress arc */}
        <circle cx={cx} cy={cy} r={R_RIM + 18} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeDasharray={`${2 * Math.PI * (R_RIM + 18) * totalProgress} ${2 * Math.PI * (R_RIM + 18)}`} transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: "stroke-dasharray 800ms var(--ease-out)" }} opacity={0.8} />
      </svg>
    </div>
  );
}
