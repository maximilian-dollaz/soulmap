import type { SoulState } from "./state";
import type { Live } from "@/components/SoulMap";
import { score_enneagram, score_attachment, score_kolbe_proxy, score_bigfive, score_working_genius, score_chronotype, score_values, score_drucker, score_wealth_dynamics, type DruckerBank, type WealthBank, type Answers, type EnneagramBank, type AttachmentBank, type KolbeBank } from "./questions/scoring";
import bigfiveBank from "./questions/bigfive.json";
import wgBank from "./questions/working_genius.json";
import chronoBank from "./questions/chronotype.json";
import valuesBank from "./questions/values.json";
import enneagramBank from "./questions/enneagram.json";
import attachmentBank from "./questions/attachment.json";
import kolbeBank from "./questions/kolbe_proxy.json";
import druckerBank from "./questions/drucker.json";
import wealthBank from "./questions/wealth_dynamics.json";

const EB = enneagramBank as unknown as EnneagramBank;
const AB = attachmentBank as unknown as AttachmentBank;
const KB = kolbeBank as unknown as KolbeBank;

export function normalizeSection(s: string): SoulState["answers"][number]["section"] {
  const k = s.toLowerCase();
  if (k.startsWith("kolbe")) return "kolbe";
  if (k.startsWith("enn")) return "enneagram";
  if (k.startsWith("att")) return "attachment";
  if (k.startsWith("big")) return "bigfive";
  if (k.startsWith("work")) return "working_genius";
  if (k.startsWith("chrono")) return "chronotype";
  if (k.startsWith("val")) return "values";
  if (k.startsWith("druck")) return "drucker";
  if (k.startsWith("wealth")) return "wealth_dynamics";
  return "open";
}

/** Item ids each bank still asks. An answer to a retired item (Drucker's old self-guessed DR2) stays in the state file but is not scored or counted. */
const SCORED_IDS: Record<string, Set<string>> = { drucker: new Set((druckerBank as { items: { id: string }[] }).items.map((i) => i.id)) };

function answersFor(s: SoulState, section: string): Answers {
  const out: Answers = {};
  const known = SCORED_IDS[section];
  for (const a of s.answers) if (a.section === section && (!known || known.has(a.item_id))) out[a.item_id] = a.value;
  return out;
}

export function scoreAll(s: SoulState) {
  const e = answersFor(s, "enneagram");
  const a = answersFor(s, "attachment");
  const k = answersFor(s, "kolbe");
  const bf = answersFor(s, "bigfive"), wg = answersFor(s, "working_genius"), ch = answersFor(s, "chronotype"), va = answersFor(s, "values"), dr = answersFor(s, "drucker"), wd = answersFor(s, "wealth_dynamics");
  const n = (o: Answers) => Object.keys(o).length;
  const BF = bigfiveBank as never, WG = wgBank as never, CH = chronoBank as never, VA = valuesBank as never;
  return {
    enneagram: n(e) ? score_enneagram(e, EB) : null,
    attachment: n(a) ? score_attachment(a, AB) : null,
    kolbe_proxy: n(k) ? score_kolbe_proxy(k, KB) : null,
    bigfive: n(bf) ? score_bigfive(bf, BF) : null,
    working_genius: n(wg) ? score_working_genius(wg, WG) : null,
    chronotype: n(ch) ? score_chronotype(ch, CH) : null,
    values: n(va) ? score_values(va, VA) : null,
    drucker: n(dr) ? score_drucker(dr, druckerBank as unknown as DruckerBank) : null,
    wealth_dynamics: n(wd) ? score_wealth_dynamics(wd, wealthBank as unknown as WealthBank) : null,
    answered: { enneagram: n(e), attachment: n(a), kolbe: n(k), bigfive: n(bf), working_genius: n(wg), chronotype: n(ch), values: n(va), drucker: n(dr), wealth_dynamics: n(wd) },
    totals: { enneagram: EB.items.length, attachment: AB.items.length, kolbe: KB.items.length, bigfive: (bigfiveBank as { items: unknown[] }).items.length, working_genius: (wgBank as { items: unknown[] }).items.length, chronotype: (chronoBank as { items: unknown[] }).items.length, values: (valuesBank as { items: unknown[] }).items.length, drucker: (druckerBank as { items: unknown[] }).items.length, wealth_dynamics: (wealthBank as { items: unknown[] }).items.length },
    total_items: EB.items.length + AB.items.length + KB.items.length + (bigfiveBank as { items: unknown[] }).items.length + (wgBank as { items: unknown[] }).items.length + (chronoBank as { items: unknown[] }).items.length + (valuesBank as { items: unknown[] }).items.length,
  };
}

export function liveFromState(s: SoulState): Live {
  const sc = scoreAll(s);
  const prog = (n: number, t: number) => Math.min(1, t ? n / t : 0);
  const en = sc.enneagram as (ReturnType<typeof score_enneagram> & { scores_by_type?: Record<string, number> }) | null;
  const scores = en?.scores_by_type ? Array.from({ length: 9 }, (_, i) => en.scores_by_type![String(i + 1)] ?? 0) : Array(9).fill(0);
  const minS = Math.min(...scores);
  const chart = adaptChart(s.chart);
  return {
    progress: {
      enneagram: prog(sc.answered.enneagram, sc.totals.enneagram),
      attachment: prog(sc.answered.attachment, sc.totals.attachment),
      kolbe: prog(sc.answered.kolbe, sc.totals.kolbe),
      birth: s.chart ? 1 : 0,
    },
    enneagram: en ? { scores: scores.map((v) => v - minS), type: en.type, wing: en.wing, confidence: en.confidence } : null,
    attachment: sc.attachment ? { anxiety: (sc.attachment.anxiety - 1) / 4, avoidance: (sc.attachment.avoidance - 1) / 4, style: sc.attachment.style } : null,
    kolbe: sc.kolbe_proxy ? { fact_finder: sc.kolbe_proxy.fact_finder, follow_thru: sc.kolbe_proxy.follow_thru, quick_start: sc.kolbe_proxy.quick_start, implementor: sc.kolbe_proxy.implementor, mo: sc.kolbe_proxy.mo_string } : null,
    chart,
  };
}

type RawChart = {
  type?: string; strategy?: string; authority?: string;
  profile?: { value?: string; name?: string } | string;
  centers?: Record<string, { defined?: boolean }>;
  channels?: { gates: [number, number]; name?: string }[];
  gene_keys?: { activation_sequence?: Record<string, { key: number; line: number; gift?: string; shadow?: string; siddhi?: string }> };
};

/** hdcalc JSON → the compact shape the SVG needs. */
export function adaptChart(raw: Record<string, unknown> | null): Live["chart"] {
  if (!raw) return null;
  const c = raw as RawChart;
  return {
    type: c.type,
    strategy: c.strategy,
    authority: c.authority,
    profile: typeof c.profile === "string" ? c.profile : c.profile?.value,
    defined_centers: Object.entries(c.centers ?? {}).filter(([, v]) => v?.defined).map(([k]) => k),
    channels: c.channels,
    gene_keys: { activation: c.gene_keys?.activation_sequence },
  };
}
