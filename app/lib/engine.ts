/**
 * The local interview engine: pure functions over a SoulState and the plan.
 * Nothing here touches disk or the network; routes and lib/interview.ts do.
 *
 * Order of asking, per enabled section, in plan order:
 *   1. items never skipped, minus those the section checkpoint lets us skip;
 *   2. the skip queue: items skipped once, asked one more time; a second skip is final.
 * "Back" reopens the previous answered item in the current section, pre-selected.
 */
import type { SoulState, Answer, InterviewState } from "./state";
import { scoreAll, normalizeSection } from "./score";
import { parseScaleAnswer, parseSimilarityAnswer, parseEnergyAnswer, parseClockAnswer, parseOptionAnswer } from "./questions/scoring";
import planJson from "./questions/interview_plan.json";
import bigfiveBank from "./questions/bigfive.json";
import kolbeBank from "./questions/kolbe_proxy.json";

// ---------- plan types ----------
export type AnswerKind = "1-5" | "1-6" | "clock" | "A/B/C" | "energy";
export type PlanItem = {
  id: string;
  bank: string;
  say: string;
  answer: AnswerKind;
  options?: { key: string; text: string }[]; // A/B/C items that carry their own choices (Drucker)
  skip_if_confident?: boolean;
  ask_if_contending?: number[];
};
export type PlanSection = { key: string; intro: string; scale?: string; checkpoint?: { after_item: string; rule: string } };
export type Plan = { version: string; items: PlanItem[]; sections: PlanSection[] };

export const PLAN = planJson as unknown as Plan;

/** Which lens a plan section belongs to; sections not listed (welcome, close) carry no items. */
const SECTION_LENS: Record<string, string> = { enneagram: "enneagram", attachment: "attachment", bigfive: "bigfive", chronotype: "chronotype", values: "values", drucker: "drucker", wealth_dynamics: "wealth_dynamics", kolbe: "kolbe", kolbe_proxy: "kolbe", working_genius: "working_genius" };
const BIRTH_LENSES = ["human_design", "gene_keys"];

const SCALE_LABELS: Record<AnswerKind, Record<number, string> | null> = {
  "1-5": { 1: "not at all", 2: "a little", 3: "somewhat", 4: "mostly", 5: "completely" },
  "1-6": { 1: "not like me at all", 2: "not like me", 3: "a little like me", 4: "somewhat like me", 5: "like me", 6: "very much like me" },
  energy: { 1: "drains me", 2: "a bit draining", 3: "neutral", 4: "energizing", 5: "really energizes me" },
  clock: null,
  "A/B/C": null,
};

type KolbeOption = { key: string; text: string; zone: string };
const KOLBE_OPTIONS: Record<string, KolbeOption[]> = Object.fromEntries(((kolbeBank as { items: { id: string; options: KolbeOption[] }[] }).items).map((i) => [i.id, i.options]));
const BIGFIVE_DOMAIN: Record<string, string> = Object.fromEntries(((bigfiveBank as { items: { id: string; domain: string }[] }).items).map((i) => [i.id, i.domain]));

/** An A/B/C item's choices: its own (Drucker, Wealth Dynamics), else the Kolbe bank's. */
export function optionsFor(item: PlanItem): { key: string; text: string }[] {
  return (item.options ?? KOLBE_OPTIONS[item.id] ?? []).map(({ key, text }) => ({ key, text }));
}

const ITEM_BY_ID: Record<string, PlanItem> = Object.fromEntries(PLAN.items.map((i) => [i.id, i]));
const ITEMS_BY_SECTION: Record<string, PlanItem[]> = {};
for (const it of PLAN.items) (ITEMS_BY_SECTION[normalizeSection(it.bank)] ??= []).push(it);

/** What the UI needs to render one question. */
export type AskedItem = {
  id: string;
  section: string;
  lens: string;
  say: string;
  answer: AnswerKind;
  scale: string | null; // the section's spoken scale cue
  labels: Record<number, string> | null; // pill labels for 1-5 / 1-6 / energy
  options: { key: string; text: string }[] | null; // A/B/C items
  index: number; // 1-based position among the items of this section that will be asked
  of: number;
  previous_value?: number | string; // set when the item was reopened with "back"
  reasked?: boolean; // true on the second (and last) ask after a skip
};

export function itemById(id: string): PlanItem | undefined { return ITEM_BY_ID[id]; }
export function sectionOf(item: PlanItem): string { return normalizeSection(item.bank); }
export function lensOf(section: string): string { return SECTION_LENS[section] ?? section; }

/** Sections with items, in plan order, filtered to the person's enabled lenses. */
export function enabledSections(state: SoulState): PlanSection[] {
  const enabled = new Set(state.profile?.enabled_lenses ?? []);
  return PLAN.sections.filter((s) => ITEMS_BY_SECTION[s.key]?.length && enabled.has(lensOf(s.key)));
}

function answerMap(state: SoulState): Map<string, Answer> {
  const m = new Map<string, Answer>();
  for (const a of state.answers) m.set(a.item_id, a);
  return m;
}

// ---------- checkpoints ----------
type Scores = ReturnType<typeof scoreAll>;
const thresholdOf = (rule: string | undefined, fallback: number) => {
  const m = rule?.match(/confidence\s*>=\s*(\d(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : fallback;
};

/** The checkpoint has run once its anchor item is behind us (answered, or skipped at least once). */
function checkpointArmed(section: PlanSection, answered: Map<string, Answer>, skips: Record<string, number>): boolean {
  const anchor = section.checkpoint?.after_item;
  if (!anchor) return false;
  return answered.has(anchor) || (skips[anchor] ?? 0) > 0;
}

/**
 * True when the section checkpoint says this item can be left out.
 * Encodes the plan's checkpoint rules: enneagram (skip_if_confident off at >= 0.6, disambiguation only for
 * contending pairs), attachment (>= 0.5), bigfive (per-domain >= 0.7), chronotype (>= 0.6), values (never).
 */
function skippedByCheckpoint(item: PlanItem, section: PlanSection, scores: Scores): boolean {
  const rule = section.checkpoint?.rule;
  switch (section.key) {
    case "enneagram": {
      const en = scores.enneagram;
      if (!en) return false;
      const confident = en.confidence >= thresholdOf(rule, 0.6);
      if (item.skip_if_confident) return confident;
      if (item.ask_if_contending) return confident && !item.ask_if_contending.every((t) => en.contenders.includes(t));
      return false;
    }
    case "attachment":
      return !!item.skip_if_confident && !!scores.attachment && scores.attachment.confidence >= thresholdOf(rule, 0.5);
    case "bigfive": {
      if (!item.skip_if_confident || !scores.bigfive) return false;
      const d = BIGFIVE_DOMAIN[item.id] as keyof typeof scores.bigfive.domain_confidence | undefined;
      return !!d && (scores.bigfive.domain_confidence[d] ?? 0) >= thresholdOf(rule, 0.7);
    }
    case "chronotype":
      return !!item.skip_if_confident && !!scores.chronotype && scores.chronotype.confidence >= thresholdOf(rule, 0.6);
    default:
      return false; // values and any paid lens: ask everything
  }
}

// ---------- walking the plan ----------
type Walk = {
  section: PlanSection;
  first: PlanItem[]; // still to ask on the first pass
  queue: PlanItem[]; // skipped once, to re-ask at the end of the section
  askedCount: number; // answered + finally skipped + currently pending, i.e. the denominator shown to the person
  answered: number;
  finalSkipped: number;
  droppedByCheckpoint: number;
};

function walkSection(state: SoulState, section: PlanSection, answered: Map<string, Answer>, scores: Scores): Walk {
  const skips = state.interview?.skips ?? {};
  const armed = checkpointArmed(section, answered, skips);
  const w: Walk = { section, first: [], queue: [], askedCount: 0, answered: 0, finalSkipped: 0, droppedByCheckpoint: 0 };
  for (const item of ITEMS_BY_SECTION[section.key] ?? []) {
    const n = skips[item.id] ?? 0;
    if (answered.has(item.id)) { w.answered++; w.askedCount++; continue; }
    if (n >= 2) { w.finalSkipped++; w.askedCount++; continue; }
    if (armed && skippedByCheckpoint(item, section, scores)) { w.droppedByCheckpoint++; continue; }
    w.askedCount++;
    (n === 1 ? w.queue : w.first).push(item);
  }
  return w;
}

function toAsked(item: PlanItem, w: Walk, extra: Partial<AskedItem> = {}): AskedItem {
  const section = w.section.key;
  const done = w.answered + w.finalSkipped;
  return {
    id: item.id, section, lens: lensOf(section), say: item.say, answer: item.answer,
    scale: w.section.scale ?? null,
    labels: SCALE_LABELS[item.answer] ?? null,
    options: item.answer === "A/B/C" ? optionsFor(item) : null,
    index: Math.min(done + 1, w.askedCount), of: w.askedCount,
    ...extra,
  };
}

/** The next question to ask, or null when the interview is complete. */
export function nextItem(state: SoulState): AskedItem | null {
  const answered = answerMap(state);
  const scores = scoreAll(state);
  const sections = enabledSections(state);
  const reopened = state.interview?.reopened;
  if (reopened && !answered.has(reopened.item_id)) {
    const item = ITEM_BY_ID[reopened.item_id];
    const section = sections.find((s) => s.key === sectionOf(item));
    if (item && section) {
      const w = walkSection(state, section, answered, scores);
      return toAsked(item, w, { previous_value: reopened.previous?.value });
    }
  }
  for (const section of sections) {
    const w = walkSection(state, section, answered, scores);
    if (w.first.length) return toAsked(w.first[0], w);
    if (w.queue.length) return toAsked(w.queue[0], w, { reasked: true });
  }
  return null;
}

export function isComplete(state: SoulState): boolean {
  return enabledSections(state).length > 0 && nextItem(state) === null;
}

/** Section the person is in: the next item's, else the last answered one. */
export function currentSection(state: SoulState): string | null {
  const next = nextItem(state);
  if (next) return next.section;
  const last = state.answers[state.answers.length - 1];
  return last ? last.section : null;
}

// ---------- intros ----------
const personalize = (text: string, state: SoulState) => text.replace(/\{\{name\}\}/g, state.profile?.name || "there").replace(/\bMax\b/g, state.profile?.name || "there");

/**
 * The intro to say before the next item, the first time its section starts. The welcome text is prepended
 * the very first time. Returns null when nothing new needs saying. Callers mark it shown with markIntroShown().
 */
export function sectionIntro(state: SoulState): { keys: string[]; text: string } | null {
  const shown = new Set(state.interview?.intros_shown ?? []);
  const next = nextItem(state);
  const keys: string[] = [];
  const parts: string[] = [];
  const welcome = PLAN.sections.find((s) => s.key === "welcome");
  if (welcome && !shown.has("welcome") && next) { keys.push("welcome"); parts.push(personalize(welcome.intro, state)); }
  if (next) {
    const section = PLAN.sections.find((s) => s.key === next.section);
    if (section?.intro && !shown.has(section.key)) { keys.push(section.key); parts.push(personalize(section.intro, state)); }
  } else if (isComplete(state)) {
    const close = PLAN.sections.find((s) => s.key === "close");
    if (close && !shown.has("close")) { keys.push("close"); parts.push(personalize(close.intro, state)); }
  }
  return keys.length ? { keys, text: parts.join("\n\n") } : null;
}

export function markIntroShown(state: SoulState, keys: string[]): SoulState {
  const shown = new Set(state.interview.intros_shown);
  for (const k of keys) shown.add(k);
  return { ...state, interview: { ...state.interview, intros_shown: [...shown] } };
}

// ---------- progress ----------
export type LensProgress = { lens: string; answered: number; skipped: number; total: number; percent: number; started: boolean; complete: boolean; from: "items" | "birth" };
export type Progress = {
  /** `skipped` counts every item skipped and not (yet) answered: queued for a re-ask or finally skipped. `remaining` is what is still to ask. */
  overall: { answered: number; skipped: number; remaining: number; total: number; percent: number };
  lenses: LensProgress[];
  current: string | null; // lens key of the next item
  lens_index: number; // 1-based position of the current lens among the drawn lenses (birth lenses included), 0 when done
  lens_count: number;
  part_index: number; // 1-based position of the current part among the interview parts (item sections only), 0 when done
  part_count: number; // "Five parts" in the intro
  lenses_done: number; // lenses complete, birth lenses included: the ring's "k/7"
  minutes_left: number; // about 20 seconds an item
  done: boolean;
};

export function progress(state: SoulState): Progress {
  const answered = answerMap(state);
  const scores = scoreAll(state);
  const enabled = state.profile?.enabled_lenses ?? [];
  const lenses: LensProgress[] = [];
  for (const lens of BIRTH_LENSES) if (enabled.includes(lens)) {
    const has = state.chart ? 1 : 0;
    lenses.push({ lens, answered: has, skipped: 0, total: 1, percent: has * 100, started: !!has, complete: !!has, from: "birth" });
  }
  let sumA = 0, sumS = 0, sumT = 0, remaining = 0;
  const parts: string[] = [];
  for (const section of enabledSections(state)) {
    const w = walkSection(state, section, answered, scores);
    const done = w.answered + w.finalSkipped;
    const skipped = w.finalSkipped + w.queue.length;
    sumA += w.answered; sumS += skipped; sumT += w.askedCount; remaining += w.first.length + w.queue.length;
    parts.push(lensOf(section.key));
    lenses.push({ lens: lensOf(section.key), answered: w.answered, skipped, total: w.askedCount,
      percent: w.askedCount ? Math.round((done / w.askedCount) * 100) : 0, started: done > 0 || skipped > 0, complete: w.askedCount > 0 && done === w.askedCount, from: "items" });
  }
  const next = nextItem(state);
  const current = next ? next.lens : null;
  return {
    overall: { answered: sumA, skipped: sumS, remaining, total: sumT, percent: sumT ? Math.round(((sumT - remaining) / sumT) * 100) : 0 },
    lenses, current,
    lens_index: current ? lenses.findIndex((l) => l.lens === current) + 1 : 0,
    lens_count: lenses.length,
    part_index: current ? parts.indexOf(current) + 1 : 0,
    part_count: parts.length,
    lenses_done: lenses.filter((l) => l.complete).length,
    minutes_left: Math.round((remaining * 20) / 60),
    done: next === null && enabledSections(state).length > 0,
  };
}

// ---------- answering ----------
export type Parsed = { value: number | string; matched: string | null };
export type ApplyResult =
  | { ok: true; state: SoulState; parsed: Parsed; item: PlanItem }
  | { ok: false; needs_clarification: true; prompt: string; item: PlanItem; state: SoulState }
  | { ok: false; needs_clarification?: false; error: string; state: SoulState };

/** What the agent says when it could not map the words to the item's scale. */
export function clarificationPrompt(item: PlanItem): string {
  switch (item.answer) {
    case "1-6": return "Could you give me a number 1 to 6? 1 is not like me at all, 6 is very much like me.";
    case "clock": return "Could you give me a time? Something like 'six thirty' or 'eleven p.m.'";
    case "A/B/C": {
      const keys = optionsFor(item).map((o) => o.key.toUpperCase());
      return keys.length > 1 ? `Which is closest: ${keys.slice(0, -1).join(", ")}, or ${keys[keys.length - 1]}?` : "Which is closest?";
    }
    case "energy": return "Could you give me a number 1 to 5? 1 drains you, 5 really energizes you.";
    default: return "Could you give me a number 1 to 5? 1 is not at all, 5 is completely.";
  }
}

/**
 * A clock answer must be a real clock reading: "7:30", "7.30", "six thirty", "11 pm", "half past six", "noon".
 * A bare number ("3", "4") is ambiguous (a scale reply? three o'clock?) and is rejected so it is never stored as 03:00.
 */
export function isClockText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/^\d{1,2}$/.test(t)) return false;
  if (/^\d{1,2}[:.]\d{2}$/.test(t)) return true;
  return /(\d{1,2}[:.]\d{2})|\b(am|pm|a\.m|p\.m|o'?clock|morning|evening|night|afternoon|noon|midday|midnight|half|quarter|thirty|fifteen|forty|past|to|before|after)\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.test(t);
}

/** Map free text onto the item's scale with the built-in parsers. Null when nothing matched. */
export function parseForItem(item: PlanItem, text: string): Parsed | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  switch (item.answer) {
    case "1-5": { const r = parseScaleAnswer(t); return r.value === null ? null : { value: r.value, matched: r.matched }; }
    case "1-6": { const r = parseSimilarityAnswer(t); return r.value === null ? null : { value: r.value, matched: r.matched }; }
    case "energy": { const r = parseEnergyAnswer(t); return r.value === null ? null : { value: r.value, matched: r.matched }; }
    case "clock": {
      if (!isClockText(t)) return null;
      const assume = /bed|sleep/i.test(item.id) ? "bed" : "wake";
      const h = parseClockAnswer(t, assume);
      return h === null || h < 0 || h >= 24 ? null : { value: Math.round(h * 100) / 100, matched: t };
    }
    case "A/B/C": {
      const opts = optionsFor(item);
      const r = parseOptionAnswer(t, opts);
      return r.key === null || r.uncertain ? null : { value: r.key, matched: r.key };
    }
    default: return null;
  }
}

/** A value already on the item's scale (a tapped pill, or the local model's output). Null when out of range. */
export function coerceValue(item: PlanItem, value: unknown): number | string | null {
  if (value === null || value === undefined || value === "") return null;
  if (item.answer === "A/B/C") { const k = String(value).trim().toLowerCase(); return ["a", "b", "c"].includes(k) ? k : null; }
  if (item.answer === "clock") {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value < 24 ? value : null;
    if (!isClockText(String(value))) return null;
    const h = parseClockAnswer(String(value), /bed|sleep/i.test(item.id) ? "bed" : "wake");
    return h === null || h < 0 || h >= 24 ? null : Math.round(h * 100) / 100;
  }
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  const max = item.answer === "1-6" ? 6 : 5;
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

/**
 * Record an answer. Parses `rawText` with the built-in parsers unless `value` is supplied (a tapped pill or a
 * model-mapped value). On parse failure returns needs_clarification with the prompt to say; the state is unchanged
 * except for the clarification count.
 */
export function applyAnswer(state: SoulState, itemId: string, rawText: string, value?: number | string | null): ApplyResult {
  const item = ITEM_BY_ID[itemId];
  if (!item) return { ok: false, error: `unknown item ${itemId}`, state };
  const section = sectionOf(item);
  if (!(state.profile?.enabled_lenses ?? []).includes(lensOf(section))) return { ok: false, error: `lens ${lensOf(section)} is not enabled for this profile`, state };
  let parsed: Parsed | null = null;
  if (value !== undefined && value !== null) { const v = coerceValue(item, value); if (v !== null) parsed = { value: v, matched: String(value) }; }
  if (!parsed) parsed = parseForItem(item, rawText);
  if (!parsed) {
    const clarifications = { ...state.interview.clarifications, [itemId]: (state.interview.clarifications[itemId] ?? 0) + 1 };
    return { ok: false, needs_clarification: true, prompt: clarificationPrompt(item), item, state: { ...state, interview: { ...state.interview, clarifications } } };
  }
  const answer: Answer = { item_id: itemId, section: section as Answer["section"], value: parsed.value, raw: rawText ?? "", at: new Date().toISOString() };
  const answers = [...state.answers.filter((a) => a.item_id !== itemId), answer];
  const interview: InterviewState = {
    ...state.interview,
    reopened: state.interview.reopened?.item_id === itemId ? null : state.interview.reopened,
    clarifications: Object.fromEntries(Object.entries(state.interview.clarifications).filter(([k]) => k !== itemId)),
  };
  return { ok: true, state: { ...state, answers, interview }, parsed, item };
}

/** Skip the item: once queues it for the end of its section, twice is final. */
export function skipItem(state: SoulState, itemId: string): SoulState {
  if (!ITEM_BY_ID[itemId]) return state;
  const skips = { ...state.interview.skips, [itemId]: Math.min(2, (state.interview.skips[itemId] ?? 0) + 1) };
  const answers = state.answers.filter((a) => a.item_id !== itemId);
  const reopened = state.interview.reopened?.item_id === itemId ? null : state.interview.reopened;
  return { ...state, answers, interview: { ...state.interview, skips, reopened } };
}

/**
 * Reopen the previously answered item in the current section, with its answer pre-selected. Its answer is lifted
 * out of `answers` so the checkpoint re-runs on the new value. Stays inside the section; null when there is
 * nothing to go back to.
 */
export function goBack(state: SoulState): { state: SoulState; item: AskedItem } | null {
  const section = currentSection(state);
  if (!section) return null;
  const candidates = state.answers.filter((a) => a.section === section && a.item_id !== state.interview.reopened?.item_id);
  const previous = candidates[candidates.length - 1];
  if (!previous) return null;
  // if an item was already reopened and not re-answered, restore its old answer before stepping back again
  let answers = state.answers.filter((a) => a.item_id !== previous.item_id);
  const open = state.interview.reopened;
  if (open?.previous && !answers.some((a) => a.item_id === open.item_id)) answers = [...answers, open.previous];
  const next: SoulState = { ...state, answers, interview: { ...state.interview, reopened: { item_id: previous.item_id, previous } } };
  const item = nextItem(next);
  return item ? { state: next, item } : null;
}

/** Order-preserving list of answered items by section (handy for the UI's per-lens sheet and for tests). */
export function answeredIds(state: SoulState, section?: string): string[] {
  return state.answers.filter((a) => !section || a.section === section).map((a) => a.item_id);
}
