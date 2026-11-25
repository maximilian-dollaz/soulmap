// Soul Map question-bank scorers. No dependencies. Runs under `node scoring.ts` (Node 22.18+) or `npx tsx`.
// Banks are passed in so this module stays pure; test_run.ts shows loading them from JSON.

export type Answer15 = 1 | 2 | 3 | 4 | 5;
export type Answers = Record<string, number | string | undefined>;
export type Zone = "counteract" | "respond" | "initiate";
export type Mode = "fact_finder" | "follow_thru" | "quick_start" | "implementor";
export type Instinct = "sp" | "so" | "sx";

export interface EnneagramItem { id: string; group: string; text: string; polarity: 1 | -1; pair?: number[];
  loads: Array<{ type?: number; instinct?: Instinct; weight: number }>; }
export interface EnneagramBank { items: EnneagramItem[] }
export interface AttachmentItem { id: string; dimension: "anxiety" | "avoidance"; context: "close" | "work"; text: string; polarity: 1 | -1 }
export interface AttachmentBank { items: AttachmentItem[] }
export interface KolbeItem { id: string; mode: Mode; text: string; options: Array<{ key: string; text: string; zone: Zone }> }
export interface KolbeBank { items: KolbeItem[]; modes: Record<Mode, { name: string; labels: Record<Zone, string>; sequence_verb: Record<Zone, string>;
  conables: Record<string, { do: string[]; dont: string[] }> }> }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const num = (v: unknown): number | null => { const n = typeof v === "string" ? parseFloat(v) : (v as number); return Number.isFinite(n) ? n : null; };

// ---------- Enneagram ----------
export interface EnneagramResult { type: number; wing: number | null; wing_label: string; instinct: Instinct; instinct_stack: Instinct[];
  confidence: number; runner_up: number; scores_by_type: Record<number, number>; instinct_scores: Record<Instinct, number>;
  answered: number; total: number; contenders: number[] }

export function score_enneagram(answers: Answers, bank: EnneagramBank): EnneagramResult {
  const raw: Record<number, number> = {}, span: Record<number, number> = {};
  const inst: Record<Instinct, number> = { sp: 0, so: 0, sx: 0 }, instSpan: Record<Instinct, number> = { sp: 0, so: 0, sx: 0 };
  for (let t = 1; t <= 9; t++) { raw[t] = 0; span[t] = 0; }
  let answered = 0;
  for (const it of bank.items) {
    const a = num(answers[it.id]);
    for (const l of it.loads) { if (l.type) span[l.type] += 2 * Math.abs(l.weight); if (l.instinct) instSpan[l.instinct] += 2 * Math.abs(l.weight); }
    if (a === null) continue;
    answered++;
    const c = (clamp(a, 1, 5) - 3) * it.polarity;
    for (const l of it.loads) { if (l.type) raw[l.type] += c * l.weight; if (l.instinct) inst[l.instinct] += c * l.weight; }
  }
  // normalize to 0-100 where 50 = neutral
  const pct: Record<number, number> = {};
  for (let t = 1; t <= 9; t++) pct[t] = round2(50 + (span[t] ? (raw[t] / span[t]) * 50 : 0));
  const ranked = Object.keys(pct).map(Number).sort((a, b) => pct[b] - pct[a] || a - b);
  const [type, runner_up] = ranked;
  const margin = pct[type] - pct[runner_up];
  const coverage = answered / bank.items.length;
  const confidence = round2(clamp(margin / 20, 0, 1) * (0.6 + 0.4 * coverage));
  const left = type === 1 ? 9 : type - 1, right = type === 9 ? 1 : type + 1;
  const wing = pct[left] === pct[right] ? null : (pct[left] > pct[right] ? left : right);
  const instPct = { sp: 0, so: 0, sx: 0 } as Record<Instinct, number>;
  (["sp", "so", "sx"] as Instinct[]).forEach(k => instPct[k] = round2(50 + (instSpan[k] ? (inst[k] / instSpan[k]) * 50 : 0)));
  const instinct_stack = (["sp", "so", "sx"] as Instinct[]).sort((a, b) => instPct[b] - instPct[a]);
  const contenders = ranked.filter(t => pct[type] - pct[t] < 20);
  return { type, wing, wing_label: wing ? `${type}w${wing}` : `${type} (balanced wings)`, instinct: instinct_stack[0], instinct_stack,
    confidence, runner_up, scores_by_type: pct, instinct_scores: instPct, answered, total: bank.items.length, contenders };
}

// ---------- Attachment ----------
export type AttachmentStyle = "secure" | "anxious" | "avoidant" | "fearful_avoidant";
export interface AttachmentResult { style: AttachmentStyle; anxiety: number; avoidance: number; confidence: number;
  by_context: { close: { anxiety: number; avoidance: number }; work: { anxiety: number; avoidance: number } }; answered: number; total: number }

export function score_attachment(answers: Answers, bank: AttachmentBank): AttachmentResult {
  const sums: Record<string, { s: number; n: number }> = {};
  const add = (k: string, v: number) => { (sums[k] ??= { s: 0, n: 0 }).s += v; sums[k].n++; };
  let answered = 0;
  for (const it of bank.items) {
    const a = num(answers[it.id]); if (a === null) continue; answered++;
    const v = it.polarity === 1 ? clamp(a, 1, 5) : 6 - clamp(a, 1, 5);
    add(it.dimension, v); add(`${it.dimension}:${it.context}`, v);
  }
  const mean = (k: string) => sums[k]?.n ? round2(sums[k].s / sums[k].n) : 3;
  const anxiety = mean("anxiety"), avoidance = mean("avoidance");
  const hiA = anxiety > 3, hiV = avoidance > 3;
  const style: AttachmentStyle = hiA && hiV ? "fearful_avoidant" : hiA ? "anxious" : hiV ? "avoidant" : "secure";
  // distance of each dimension from the 3.0 cut, scaled so 1.0 away = full confidence; weakest dimension limits it
  const coverage = answered / bank.items.length;
  const confidence = round2(clamp(Math.min(Math.abs(anxiety - 3), Math.abs(avoidance - 3)), 0, 1) * (0.6 + 0.4 * coverage));
  return { style, anxiety, avoidance, confidence,
    by_context: { close: { anxiety: mean("anxiety:close"), avoidance: mean("avoidance:close") }, work: { anxiety: mean("anxiety:work"), avoidance: mean("avoidance:work") } },
    answered, total: bank.items.length };
}

// ---------- Kolbe proxy ----------
export const ZONE_OF = (score: number): Zone => score <= 3 ? "counteract" : score <= 6 ? "respond" : "initiate";
export interface KolbeResult { fact_finder: number; follow_thru: number; quick_start: number; implementor: number; mo_string: string;
  strengths: Record<Mode, string>; zones: Record<Mode, Zone>; confidence: number; mode_confidence: Record<Mode, number>;
  problem_solving_sequence: Array<{ mode: Mode; label: string; verb: string }>; energy_pct: Record<Mode, number>;
  conables: Record<Mode, { label: string; do: string[]; dont: string[] }>; sum: number; notes: string[] }

export function score_kolbe_proxy(answers: Answers, bank: KolbeBank): KolbeResult {
  const MODES: Mode[] = ["fact_finder", "follow_thru", "quick_start", "implementor"];
  const tally: Record<Mode, Record<Zone, number>> = Object.fromEntries(MODES.map(m => [m, { counteract: 0, respond: 0, initiate: 0 }])) as any;
  for (const it of bank.items) {
    const a = answers[it.id]; if (a === undefined || a === null || a === "") continue;
    const key = String(a).trim().toLowerCase();
    const opt = it.options.find(o => o.key === key) ?? it.options.find(o => o.zone === key);
    if (opt) tally[it.mode][opt.zone]++;
  }
  const scores = {} as Record<Mode, number>, zones = {} as Record<Mode, Zone>, strengths = {} as Record<Mode, string>,
    mode_confidence = {} as Record<Mode, number>, conables = {} as Record<Mode, { label: string; do: string[]; dont: string[] }>;
  const notes: string[] = [];
  for (const m of MODES) {
    const t = tally[m], n = t.counteract + t.respond + t.initiate;
    const net = n ? (t.initiate - t.counteract) / n : 0;
    const s = n ? clamp(Math.round(5.5 + 4.5 * net), 1, 10) : 5;
    scores[m] = s; zones[m] = ZONE_OF(s); strengths[m] = bank.modes[m].labels[zones[m]];
    mode_confidence[m] = n ? round2(Math.max(t.counteract, t.respond, t.initiate) / n * (0.6 + 0.4 * n / 6)) : 0;
    const c = bank.modes[m].conables[strengths[m]]; conables[m] = { label: strengths[m], do: c.do, dont: c.dont };
    if (!n) notes.push(`${m}: no answers, defaulted to 5`);
    if (n && t.initiate > 0 && t.counteract > 0 && t.initiate === t.counteract) notes.push(`${m}: split between initiate and counteract, scored as respond; worth a follow-up question`);
  }
  const sum = MODES.reduce((a, m) => a + scores[m], 0);
  if (sum < 16 || sum > 24) notes.push(`mode scores sum to ${sum}; real Kolbe results usually sum to about 18-22, so one or more modes may be over- or under-stated`);
  const energy_pct = {} as Record<Mode, number>;
  MODES.forEach(m => energy_pct[m] = Math.round(scores[m] / sum * 100));
  const problem_solving_sequence = [...MODES].sort((a, b) => scores[b] - scores[a] || MODES.indexOf(a) - MODES.indexOf(b))
    .map(m => ({ mode: m, label: strengths[m], verb: bank.modes[m].sequence_verb[zones[m]] }));
  const confidence = round2(MODES.reduce((a, m) => a + mode_confidence[m], 0) / 4);
  return { ...scores, mo_string: MODES.map(m => scores[m]).join("-"), strengths, zones, confidence, mode_confidence,
    problem_solving_sequence, energy_pct, conables, sum, notes } as KolbeResult;
}

// ---------- Voice answer parsing (mirrors voice_answer_parser.json) ----------
const SCALE_WORDS: Array<[number, string[]]> = [
  [5, ["completely", "absolutely", "totally", "definitely", "very much", "always", "hundred percent", "100 percent", "exactly", "so true", "all the time", "big time", "yes definitely", "for sure", "without a doubt", "extremely"]],
  [4, ["mostly", "pretty much", "yeah", "yes", "yep", "usually", "often", "largely", "for the most part", "generally", "quite", "i'd say so", "true", "most of the time", "pretty true", "fairly"]],
  [3, ["somewhat", "sometimes", "kind of", "kinda", "sort of", "sorta", "a bit", "depends", "half", "in between", "fifty fifty", "medium", "neutral", "maybe", "middle", "not sure", "mixed"]],
  [2, ["a little", "slightly", "not really", "not much", "rarely", "barely", "not so much", "occasionally", "hardly", "a tiny bit", "not very", "once in a while"]],
  [1, ["not at all", "no", "never", "nope", "nah", "zero", "none", "the opposite", "definitely not", "no way", "absolutely not", "not even a little", "not me"]],
];
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 };

export function parseScaleAnswer(text: string): { value: Answer15 | null; matched: string | null } {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  let m = t.match(/ (\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten) (?:out of|over|on|of) (5|five|10|ten) /);
  if (m) { const x = NUM_WORDS[m[1]] ?? parseFloat(m[1]); const base = /10|ten/.test(m[2]) ? 10 : 5; return { value: clamp(Math.ceil(base === 10 ? x / 2 : x), 1, 5) as Answer15, matched: m[0].trim() }; }
  m = t.match(/ (?:a |like a |maybe a |probably a |say a )?([1-5]|one|two|three|four|five) /);
  if (m && !/ (half|fifty) /.test(t)) return { value: NUM_WORDS[m[1]] as Answer15, matched: m[1] };
  let best: { value: number; matched: string; len: number; pos: number } | null = null;
  for (const [value, phrases] of SCALE_WORDS) for (const p of phrases) {
    const idx = t.lastIndexOf(" " + p + " "); if (idx < 0) continue;
    let v = value;
    if ((value === 5 || value === 4) && t.slice(0, idx + 1).endsWith(" not ")) v = 2; // "not completely", "not usually"
    if (!best || p.length > best.len || (p.length === best.len && idx > best.pos)) best = { value: v, matched: p, len: p.length, pos: idx };
  }
  return best ? { value: best.value as Answer15, matched: best.matched } : { value: null, matched: null };
}

export function parseOptionAnswer(text: string, options: Array<{ key: string; text: string }>): { key: string | null; uncertain: boolean } {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  const pos: Record<string, string[]> = { a: ["a", "1", "first", "the first one", "number one", "option a"], b: ["b", "2", "second", "the second one", "middle one", "number two", "option b"], c: ["c", "3", "third", "the third one", "number three", "option c"], d: ["d", "4", "fourth", "the fourth one", "number four", "option d"], e: ["e", "5", "fifth", "the fifth one", "number five", "option e"], f: ["f", "6", "sixth", "the sixth one", "number six", "option f"] };
  for (const [k, ps] of Object.entries(pos)) if (options.some((o) => o.key === k) && ps.some(p => t.includes(" " + p + " ") || t.trim() === p)) return { key: k, uncertain: false };
  if (/ (the )?last( one)? /.test(t) && options.length) return { key: options[options.length - 1].key, uncertain: false };
  const stop = new Set(["i", "the", "a", "an", "it", "and", "or", "to", "of", "my", "me", "is", "in", "on", "then", "so", "that", "with", "if", "at", "for", "do", "what", "its", "it's", "i'd", "i'll", "i'm"]);
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(w => w && !stop.has(w)));
  const answer = words(text);
  const scored = options.map(o => { const ow = words(o.text); let n = 0; for (const w of answer) if (ow.has(w)) n++; return { key: o.key, n }; }).sort((x, y) => y.n - x.n);
  if (!scored[0].n) return { key: null, uncertain: true };
  return { key: scored[0].key, uncertain: scored[0].n === (scored[1]?.n ?? 0) || scored[0].n < 2 };
}

// ---------- Big Five (IPIP) ----------
export type BigFiveDomain = "openness" | "conscientiousness" | "extraversion" | "agreeableness" | "emotional_stability";
export type Level = "low" | "average" | "high";
export interface BigFiveItem { id: string; domain: BigFiveDomain; text: string; polarity: 1 | -1; facet?: string; skip_if_confident?: boolean }
export interface BigFiveBank { items: BigFiveItem[]; facets?: Record<string, { domain: BigFiveDomain; name: string }> }
export interface BigFiveResult { scores: Record<BigFiveDomain, number>; levels: Record<BigFiveDomain, Level>; facets: Record<string, number | null>;
  domain_confidence: Record<BigFiveDomain, number>; confidence: number; answered: number; total: number; notes: string[] }

const BIG5: BigFiveDomain[] = ["openness", "conscientiousness", "extraversion", "agreeableness", "emotional_stability"];
const to100 = (mean15: number) => round2((mean15 - 1) / 4 * 100);
const LEVEL_OF = (score: number): Level => score < 35 ? "low" : score > 65 ? "high" : "average";

export function score_bigfive(answers: Answers, bank: BigFiveBank): BigFiveResult {
  type Acc = { s: number; n: number; fwd: number[]; rev: number[] };
  const dom = Object.fromEntries(BIG5.map(d => [d, { s: 0, n: 0, fwd: [] as number[], rev: [] as number[] }])) as unknown as Record<BigFiveDomain, Acc>;
  const perDom = Object.fromEntries(BIG5.map(d => [d, 0])) as Record<BigFiveDomain, number>;
  const fac: Record<string, { s: number; n: number }> = {};
  for (const f of Object.keys(bank.facets ?? {})) fac[f] = { s: 0, n: 0 };
  let answered = 0;
  for (const it of bank.items) {
    perDom[it.domain]++;
    const a = num(answers[it.id]); if (a === null) continue; answered++;
    const v = it.polarity === 1 ? clamp(a, 1, 5) : 6 - clamp(a, 1, 5);
    const d = dom[it.domain]; d.s += v; d.n++; (it.polarity === 1 ? d.fwd : d.rev).push(v);
    if (it.facet) { (fac[it.facet] ??= { s: 0, n: 0 }).s += v; fac[it.facet].n++; }
  }
  const scores = {} as Record<BigFiveDomain, number>, levels = {} as Record<BigFiveDomain, Level>, domain_confidence = {} as Record<BigFiveDomain, number>;
  const notes: string[] = [];
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const d of BIG5) {
    const acc = dom[d];
    scores[d] = acc.n ? to100(acc.s / acc.n) : 50; levels[d] = LEVEL_OF(scores[d]);
    // forward and reversed halves should agree once reversed; a wide gap means acquiescence or a misread item
    const consistency = acc.fwd.length && acc.rev.length ? 1 - Math.abs(mean(acc.fwd) - mean(acc.rev)) / 4 : acc.n ? 0.75 : 0;
    domain_confidence[d] = round2(clamp(consistency, 0, 1) * (0.6 + 0.4 * acc.n / perDom[d]));
    if (!acc.n) notes.push(`${d}: no answers, defaulted to 50`);
    else if (consistency < 0.5) notes.push(`${d}: forward and reversed items disagree (gap ${round2(Math.abs(mean(acc.fwd) - mean(acc.rev)))}), worth a follow-up`);
  }
  const facets: Record<string, number | null> = {};
  for (const [f, acc] of Object.entries(fac)) facets[f] = acc.n ? to100(acc.s / acc.n) : null;
  const confidence = round2(BIG5.reduce((a, d) => a + domain_confidence[d], 0) / BIG5.length);
  return { scores, levels, facets, domain_confidence, confidence, answered, total: bank.items.length, notes };
}

// ---------- Working Genius proxy ----------
export type Genius = "wonder" | "invention" | "discernment" | "galvanizing" | "enablement" | "tenacity";
export type GeniusBand = "genius" | "competency" | "frustration";
export interface WorkingGeniusItem { id: string; genius: Genius; kind: "energy" | "competency"; text: string; polarity: 1 | -1; skip_if_confident?: boolean }
export interface WorkingGeniusBank { items: WorkingGeniusItem[]; types: Record<Genius, { name: string; short: string; description: string }> }
export interface WorkingGeniusResult { ranking: Array<{ genius: Genius; name: string; band: GeniusBand; energy: number; competency: number | null }>;
  genius: Genius[]; competency: Genius[]; frustration: Genius[]; energy_scores: Record<Genius, number>; competency_scores: Record<Genius, number | null>;
  confidence: number; answered: number; total: number; notes: string[] }

const GENIUS: Genius[] = ["wonder", "invention", "discernment", "galvanizing", "enablement", "tenacity"];

export function score_working_genius(answers: Answers, bank: WorkingGeniusBank): WorkingGeniusResult {
  const en = Object.fromEntries(GENIUS.map(g => [g, { s: 0, n: 0 }])) as Record<Genius, { s: number; n: number }>;
  const co = Object.fromEntries(GENIUS.map(g => [g, { s: 0, n: 0 }])) as Record<Genius, { s: number; n: number }>;
  const energyItems = Object.fromEntries(GENIUS.map(g => [g, 0])) as Record<Genius, number>;
  let answered = 0;
  for (const it of bank.items) {
    if (it.kind === "energy") energyItems[it.genius]++;
    const a = num(answers[it.id]); if (a === null) continue; answered++;
    const v = it.polarity === 1 ? clamp(a, 1, 5) : 6 - clamp(a, 1, 5);
    const acc = it.kind === "energy" ? en[it.genius] : co[it.genius]; acc.s += v; acc.n++;
  }
  const energy_scores = {} as Record<Genius, number>, competency_scores = {} as Record<Genius, number | null>;
  const notes: string[] = [];
  for (const g of GENIUS) {
    energy_scores[g] = en[g].n ? to100(en[g].s / en[g].n) : 50;
    competency_scores[g] = co[g].n ? to100(co[g].s / co[g].n) : null;
    if (!en[g].n) notes.push(`${g}: no energy answers, defaulted to 50`);
  }
  const order = [...GENIUS].sort((a, b) => energy_scores[b] - energy_scores[a]
    || (competency_scores[b] ?? 50) - (competency_scores[a] ?? 50) || GENIUS.indexOf(a) - GENIUS.indexOf(b));
  const bandOf = (i: number): GeniusBand => i < 2 ? "genius" : i < 4 ? "competency" : "frustration";
  const ranking = order.map((g, i) => ({ genius: g, name: bank.types[g].name, band: bandOf(i), energy: energy_scores[g], competency: competency_scores[g] }));
  // the two gaps that decide the bands; one scale step on a 3-item mean is about 8 points, so 10 = full
  const gapTop = energy_scores[order[1]] - energy_scores[order[2]], gapBottom = energy_scores[order[3]] - energy_scores[order[4]];
  const coverage = answered / bank.items.length;
  const confidence = round2(clamp(Math.min(gapTop, gapBottom) / 10, 0, 1) * (0.6 + 0.4 * coverage));
  if (gapTop === 0) notes.push(`${order[1]} and ${order[2]} tie on energy at the genius line; competency broke the tie`);
  if (gapBottom === 0) notes.push(`${order[3]} and ${order[4]} tie on energy at the frustration line; competency broke the tie`);
  for (const g of GENIUS) {
    const c = competency_scores[g]; if (c === null) continue;
    if (c >= 75 && energy_scores[g] <= 40) notes.push(`${g}: skilled but drained, the classic burnout spot; others will keep handing it over`);
    if (energy_scores[g] >= 75 && c <= 40) notes.push(`${g}: energizing but not yet a self-rated strength; worth developing`);
  }
  return { ranking, genius: order.slice(0, 2), competency: order.slice(2, 4), frustration: order.slice(4), energy_scores, competency_scores,
    confidence, answered, total: bank.items.length, notes };
}

// ---------- Chronotype (Morningness-Eveningness style) ----------
export type Chronotype = "definite_morning" | "moderate_morning" | "intermediate" | "moderate_evening" | "definite_evening";
export interface ChronotypeItem { id: string; kind: "agreement" | "clock"; clock?: "wake" | "bed"; text: string; polarity?: 1 | -1; skip_if_confident?: boolean }
export interface ChronotypeBank { items: ChronotypeItem[] }
export interface ChronotypeResult { label: Chronotype; score: number; peak_window: string; wake_window: string; sleep_window: string;
  natural_wake: string; natural_bed: string; agreement_score: number | null; clock_score: number | null;
  confidence: number; answered: number; total: number; notes: string[] }

const CHRONO_CUTS: Array<[number, Chronotype]> = [[20, "definite_evening"], [36, "moderate_evening"], [60, "intermediate"], [76, "moderate_morning"], [100, "definite_morning"]];
const CLOCK_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const hour24 = (h: number) => ((h % 24) + 24) % 24;
export const formatClock = (h: number): string => { const q = Math.round(hour24(h) * 4) / 4; const hh = Math.floor(q) % 24, mm = Math.round((q - Math.floor(q)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; };

/** Spoken clock time -> decimal hour 0-24, or null. `assume` resolves a bare "11" to 23:00 for bedtime and 11:00 for wake time. */
export function parseClockAnswer(text: string | number | undefined, assume?: "wake" | "bed"): number | null {
  if (text === undefined || text === null) return null;
  if (typeof text === "number") return Number.isFinite(text) ? hour24(text) : null;
  let t = " " + text.toLowerCase().replace(/\./g, ":").replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  if (/ (midnight|12 at night) /.test(t)) return 0;
  if (/ (noon|midday) /.test(t)) return 12;
  for (const [w, n] of Object.entries(CLOCK_WORDS)) t = t.replace(new RegExp(` ${w} `, "g"), ` ${n} `);
  t = t.replace(/ a m /g, " am ").replace(/ p m /g, " pm ").replace(/:(\d{2}) ?(am|pm) /g, ":$1 $2 ");
  let h: number | null = null, frac = 0;
  let m = t.match(/ (half|quarter) (past|to|after|before) (\d{1,2}) /);
  if (m) { h = parseInt(m[3]); frac = m[1] === "half" ? 0.5 : 0.25; if (m[2] === "to" || m[2] === "before") { h -= 1; frac = 1 - frac; } }
  else { m = t.match(/ (\d{1,2})(?::(\d{2}))? /); if (!m) return null; h = parseInt(m[1]); frac = m[2] ? parseInt(m[2]) / 60 : 0;
    const thirty = / (\d{1,2}) thirty /.test(t), fifteen = / (\d{1,2}) fifteen /.test(t), fortyfive = / (\d{1,2}) forty ?five /.test(t);
    if (!m[2]) frac = thirty ? 0.5 : fifteen ? 0.25 : fortyfive ? 0.75 : 0; }
  if (h === null || h > 24 || frac > 1) return null;
  const pm = / (pm|evening|night|afternoon) /.test(t), am = / (am|morning) /.test(t);
  if (h <= 12) {
    if (pm) h = h === 12 ? 12 : h + 12;
    else if (am) h = h === 12 ? 0 : h;
    else if (assume === "bed") h = h === 12 ? 0 : h <= 6 ? h : h + 12;  // bare "11" at bedtime is 23:00, bare "1" is 01:00
    else if (assume === "wake") h = h === 12 ? 12 : h;                    // bare numbers at wake time are a.m.
  }
  return hour24(h + frac);
}

export function score_chronotype(answers: Answers, bank: ChronotypeBank): ChronotypeResult {
  let s = 0, n = 0, answered = 0, wake: number | null = null, bed: number | null = null;
  for (const it of bank.items) {
    if (it.kind === "clock") {
      const h = parseClockAnswer(answers[it.id] as string | number | undefined, it.clock); if (h === null) continue; answered++;
      if (it.clock === "wake") wake = h; else bed = h;
    } else {
      const a = num(answers[it.id]); if (a === null) continue; answered++;
      s += (it.polarity ?? 1) === 1 ? clamp(a, 1, 5) : 6 - clamp(a, 1, 5); n++;
    }
  }
  const notes: string[] = [];
  const agreement_score = n ? to100(s / n) : null;
  const clockParts: number[] = [];
  if (wake !== null) clockParts.push(clamp((10 - (wake < 3 ? wake + 24 : wake)) / 5 * 100, 0, 100));       // 05:00 -> 100, 10:00 -> 0
  if (bed !== null) clockParts.push(clamp((26 - (bed < 12 ? bed + 24 : bed)) / 5 * 100, 0, 100));          // 21:00 -> 100, 02:00 -> 0
  const clock_score = clockParts.length ? round2(clockParts.reduce((a, b) => a + b, 0) / clockParts.length) : null;
  let score = agreement_score !== null && clock_score !== null ? 0.7 * agreement_score + 0.3 * clock_score : agreement_score ?? clock_score ?? 50;
  score = round2(score);
  if (agreement_score === null && clock_score === null) notes.push("no answers, defaulted to intermediate");
  const label = CHRONO_CUTS.find(([max]) => score <= max)![1];
  const natural_wake = wake ?? 10 - score / 100 * 5;
  const natural_bed = bed ?? hour24(natural_wake - 8);
  const peakStart = natural_wake + 2 + (1 - score / 100) * 5;
  let confidence = clamp(Math.min(...CHRONO_CUTS.slice(0, 4).map(([cut]) => Math.abs(score - cut))) / 8, 0, 1) * (0.6 + 0.4 * answered / bank.items.length);
  if (agreement_score !== null && clock_score !== null && Math.abs(agreement_score - clock_score) > 35) {
    confidence *= 0.5; notes.push(`stated times (${clock_score}) and the agreement items (${agreement_score}) disagree; ask which is the real pattern vs the schedule they're stuck with`);
  }
  if (wake !== null && bed !== null) { const sleep = hour24(natural_wake - natural_bed); if (sleep < 6 || sleep > 10) notes.push(`stated sleep window is ${round2(sleep)} h; check the times were heard right`); }
  return { label, score, peak_window: `${formatClock(peakStart)}–${formatClock(peakStart + 3)}`,
    wake_window: `${formatClock(natural_wake - 0.5)}–${formatClock(natural_wake + 0.5)}`, sleep_window: `${formatClock(natural_bed)}–${formatClock(natural_wake)}`,
    natural_wake: formatClock(natural_wake), natural_bed: formatClock(natural_bed), agreement_score, clock_score,
    confidence: round2(confidence), answered, total: bank.items.length, notes };
}

// ---------- Schwartz values (portrait style, 1-6) ----------
export type ValueKey = "self_direction" | "stimulation" | "hedonism" | "achievement" | "power" | "security" | "conformity" | "tradition" | "benevolence" | "universalism";
export type HigherOrder = "openness_to_change" | "self_enhancement" | "conservation" | "self_transcendence";
export interface ValuesItem { id: string; value: ValueKey; text: string; skip_if_confident?: boolean }
export interface ValuesBank { items: ValuesItem[]; values: Record<ValueKey, { name: string; higher_order: HigherOrder }>; higher_order: Record<HigherOrder, ValueKey[]> }
export interface ValuesResult { centered: Record<ValueKey, number>; raw: Record<ValueKey, number | null>; top: ValueKey[]; bottom: ValueKey[];
  higher_order: Record<HigherOrder, number>; mrat: number; confidence: number; answered: number; total: number; notes: string[] }

export function score_values(answers: Answers, bank: ValuesBank): ValuesResult {
  const keys = Object.keys(bank.values) as ValueKey[];
  const acc = Object.fromEntries(keys.map(k => [k, { s: 0, n: 0 }])) as Record<ValueKey, { s: number; n: number }>;
  let all = 0, answered = 0;
  for (const it of bank.items) {
    const a = num(answers[it.id]); if (a === null) continue; answered++;
    const v = clamp(a, 1, 6); acc[it.value].s += v; acc[it.value].n++; all += v;
  }
  const mrat = answered ? round2(all / answered) : 3.5;
  const raw = {} as Record<ValueKey, number | null>, centered = {} as Record<ValueKey, number>;
  const notes: string[] = [];
  for (const k of keys) { raw[k] = acc[k].n ? round2(acc[k].s / acc[k].n) : null; centered[k] = raw[k] === null ? 0 : round2(raw[k] - mrat); if (raw[k] === null) notes.push(`${k}: no answers, centered at 0`); }
  const ranked = [...keys].sort((a, b) => centered[b] - centered[a] || keys.indexOf(a) - keys.indexOf(b));
  const higher_order = {} as Record<HigherOrder, number>;
  for (const [ho, vs] of Object.entries(bank.higher_order) as Array<[HigherOrder, ValueKey[]]>) higher_order[ho] = round2(vs.reduce((s, k) => s + centered[k], 0) / vs.length);
  const sd = Math.sqrt(keys.reduce((s, k) => s + centered[k] ** 2, 0) / keys.length);
  const coverage = answered / bank.items.length;
  const confidence = round2(clamp(sd / 0.8, 0, 1) * (0.6 + 0.4 * coverage));
  if (answered && sd < 0.4) notes.push("flat profile: most values rated about the same, so the ranking is weak");
  if (answered && mrat > 5.2) notes.push("nearly everything rated 'like me'; the centered scores still rank, but ask what they'd give up first");
  if (answered && mrat < 2) notes.push("nearly everything rated 'not like me'; ask what they'd keep");
  return { centered, raw, top: ranked.slice(0, 3), bottom: ranked.slice(-3).reverse(), higher_order, mrat, confidence, answered, total: bank.items.length, notes };
}

// ---------- Voice parsing for the new scales (mirrors voice_answer_parser.json) ----------
const ENERGY_WORDS: Array<[number, string[]]> = [
  [5, ["really energizes me", "love it", "love that", "lights me up", "come alive", "i thrive", "best part", "favorite", "favourite", "so energizing", "fully energizes"]],
  [4, ["energizing", "energizes me", "gives me energy", "like it", "like that", "enjoy", "fun", "good one", "i'm into that", "nice"]],
  [3, ["neutral", "neither", "fine", "okay", "ok", "indifferent", "doesn't matter", "no strong feeling", "depends", "in between", "take it or leave it"]],
  [2, ["a bit draining", "slightly draining", "tires me", "tiring", "not my favorite", "not my favourite", "meh", "a little draining", "bit of a slog", "not really"]],
  [1, ["drains me", "draining", "drains", "exhausting", "hate it", "hate that", "dread", "sucks the life", "kills me", "the worst", "not at all", "no"]],
];
const SIMILARITY_WORDS: Array<[number, string[]]> = [
  [6, ["very much like me", "exactly me", "exactly like me", "completely", "totally", "absolutely", "hundred percent", "100 percent", "that's so me", "so me", "very much"]],
  [5, ["like me", "that's me", "yes", "yeah", "yep", "mostly", "pretty much", "quite like me", "definitely"]],
  [4, ["somewhat like me", "somewhat", "kind of", "kinda", "sort of", "sorta", "partly", "fairly", "in some ways"]],
  [3, ["a little like me", "a little", "slightly", "a bit", "a tiny bit", "not much"]],
  [2, ["not like me", "not really me", "not really", "no", "nope", "not so much", "not me"]],
  [1, ["not like me at all", "nothing like me", "the opposite of me", "the opposite", "not at all", "no way", "definitely not", "absolutely not"]],
];
const normalize = (text: string) => " " + text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
function longestPhrase(t: string, table: Array<[number, string[]]>): { value: number; matched: string } | null {
  let best: { value: number; matched: string; len: number; pos: number } | null = null;
  for (const [value, phrases] of table) for (const p of phrases) {
    const idx = t.lastIndexOf(" " + p + " "); if (idx < 0) continue;
    if (!best || p.length > best.len || (p.length === best.len && idx > best.pos)) best = { value, matched: p, len: p.length, pos: idx };
  }
  return best ? { value: best.value, matched: best.matched } : null;
}

/** Energy scale (1 drains me .. 5 really energizes me). Numbers win, then energy phrases, then the agreement words as a fallback ("yeah" -> 4, "not at all" -> 1). */
export function parseEnergyAnswer(text: string): { value: Answer15 | null; matched: string | null } {
  const t = normalize(text);
  const m = t.match(/ (?:a |like a |maybe a |probably a |say a )?([1-5]|one|two|three|four|five) /);
  if (m && !/ (half|fifty|ten) /.test(t)) return { value: NUM_WORDS[m[1]] as Answer15, matched: m[1] };
  const hit = longestPhrase(t, ENERGY_WORDS);
  if (hit) return { value: hit.value as Answer15, matched: hit.matched };
  return parseScaleAnswer(text);
}

/** Similarity scale 1-6 (not like me at all .. very much like me). Numbers 1-6 win; "x out of 10" -> ceil(x * 6 / 10). */
export function parseSimilarityAnswer(text: string): { value: 1 | 2 | 3 | 4 | 5 | 6 | null; matched: string | null } {
  type V6 = 1 | 2 | 3 | 4 | 5 | 6;
  const t = normalize(text);
  let m = t.match(/ (\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten) (?:out of|over|on|of) (6|six|10|ten) /);
  if (m) { const x = CLOCK_WORDS[m[1]] ?? parseFloat(m[1]); const base = /10|ten/.test(m[2]) ? 10 : 6; return { value: clamp(Math.ceil(x * 6 / base), 1, 6) as V6, matched: m[0].trim() }; }
  m = t.match(/ (?:a |like a |maybe a |probably a |say a )?([1-6]|one|two|three|four|five|six) /);
  if (m && !/ (half|fifty) /.test(t)) return { value: (CLOCK_WORDS[m[1]] ?? parseInt(m[1])) as V6, matched: m[1] };
  const hit = longestPhrase(t, SIMILARITY_WORDS);
  return hit ? { value: hit.value as V6, matched: hit.matched } : { value: null, matched: null };
}

// ---------- Drucker: the five questions of 'Managing Oneself' ----------
export interface DruckerBank { items: { id: string; dimension: string; question?: string; group?: string; options: { key: string; text: string; value: string }[] }[] }
export interface DruckerLearning {
  value: string; text: string; // the way that showed up most across the remembered moments
  count: number; of: number; // how many of the moments it showed up in
  moments: string[]; // every remembered way, in order
  tie: boolean; // two ways showed up equally often; the first one remembered is reported
  slow: string | null; // how it was coming when learning didn't stick
}
export interface DruckerResult {
  choices: Record<string, { value: string; text: string; question?: string }>;
  learning: DruckerLearning | null;
  answered: number; total: number; confidence: number;
}

/** Each answer is the person's own pick, recorded by dimension with its plain-words text and the Drucker question it answers.
 *  Grouped items (how a person learns) are remembered moments, not self-guesses: the way that shows up most is the result. */
export function score_drucker(answers: Answers, bank: DruckerBank): DruckerResult {
  const choices: DruckerResult["choices"] = {};
  const groups: Record<string, { value: string; text: string }[]> = {};
  for (const it of bank.items) {
    const a = answers[it.id];
    const o = it.options.find((x) => x.key === String(a ?? "").toLowerCase());
    if (!o) continue;
    choices[it.dimension] = { value: o.value, text: o.text, ...(it.question ? { question: it.question } : {}) };
    if (it.group) (groups[it.group] ??= []).push({ value: o.value, text: o.text });
  }
  let learning: DruckerLearning | null = null;
  const m = groups.learning;
  if (m?.length) {
    const n: Record<string, number> = {};
    for (const x of m) n[x.value] = (n[x.value] ?? 0) + 1;
    const best = Math.max(...Object.values(n));
    const top = m.find((x) => n[x.value] === best)!; // first remembered among the most frequent
    learning = { value: top.value, text: top.text, count: best, of: m.length, moments: m.map((x) => x.value),
      tie: Object.values(n).filter((c) => c === best).length > 1, slow: choices.learning_slow?.value ?? null };
    choices.learning = { value: top.value, text: top.text, question: "learn" };
  }
  const answered = bank.items.filter((it) => it.options.some((x) => x.key === String(answers[it.id] ?? "").toLowerCase())).length;
  return { choices, learning, answered, total: bank.items.length, confidence: round2(answered / bank.items.length) };
}

// ---------- Wealth Dynamics: how a person naturally creates value ----------
export type Energy = "dynamo" | "blaze" | "tempo" | "steel";
export interface WealthBank { items: { id: string; options: { key: string; text: string; value: Energy }[] }[] }
export interface WealthResult {
  energies: Record<Energy, number>; // share of answers, 0-100
  primary: Energy; secondary: Energy;
  profile: string; // Creator, Star, Supporter, Deal Maker, Trader, Accumulator, Lord, Mechanic
  answered: number; total: number; confidence: number;
}
/** Neighbours on the Wealth Dynamics wheel; a profile between two energies exists only for neighbours. */
const WD_PAIR: Record<string, string> = { "blaze+dynamo": "Star", "blaze+tempo": "Deal Maker", "steel+tempo": "Accumulator", "dynamo+steel": "Mechanic" };
const WD_PURE: Record<Energy, string> = { dynamo: "Creator", blaze: "Supporter", tempo: "Trader", steel: "Lord" };

/** Each pick adds to one energy. A clear lead (3+ picks) or a non-neighbouring runner-up gives the pure profile; otherwise the pair between the top two. */
export function score_wealth_dynamics(answers: Answers, bank: WealthBank): WealthResult {
  const count: Record<Energy, number> = { dynamo: 0, blaze: 0, tempo: 0, steel: 0 };
  let answered = 0;
  for (const it of bank.items) {
    const o = it.options.find((x) => x.key === String(answers[it.id] ?? "").toLowerCase());
    if (o) { count[o.value]++; answered++; }
  }
  const order = (Object.keys(count) as Energy[]).sort((x, y) => count[y] - count[x]);
  const [primary, secondary] = order;
  const pair = WD_PAIR[[primary, secondary].sort().join("+")];
  const profile = count[primary] - count[secondary] >= 3 || !pair ? WD_PURE[primary] : pair;
  const energies = Object.fromEntries(order.map((e) => [e, answered ? Math.round((100 * count[e]) / answered) : 0])) as Record<Energy, number>;
  return { energies, primary, secondary, profile, answered, total: bank.items.length, confidence: round2(answered / bank.items.length) };
}
