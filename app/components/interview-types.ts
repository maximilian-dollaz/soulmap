/**
 * The interview contract as the UI consumes it. The engine (lib/interview.ts) and the brief describe
 * slightly different shapes; everything is normalised here so the screens see one thing.
 */

export type Kind = "scale5" | "scale6" | "abc" | "clock" | "text";

export type Item = {
  id: string;
  bank: string;
  lens: string;
  say: string;
  kind: Kind;
  rawAnswer: string;
  labels: Record<number, string> | null;
  options: { key: string; text: string }[];
  scale: string | null;
  index: number;
  of: number;
  previous?: number | string;
  reasked?: boolean;
};

export type LensProgress = { lens: string; answered: number; skipped: number; total: number; percent: number; started: boolean; complete: boolean; from: "items" | "birth" };
export type Progress = {
  percent: number; // 0..100 overall
  answered: number;
  skipped: number;
  remaining: number;
  total: number;
  lenses: LensProgress[];
  current: string | null;
  lens_index: number;
  lens_count: number;
  part_index: number; // the interview part (item sections only), 1-based; 0 when done
  part_count: number;
  lenses_done: number; // birth lenses included: the ring's "k/7"
  minutes_left: number;
};

export type Next = { item: Item | null; intro?: string; progress: Progress; done: boolean; status?: string; compact: boolean };
export type Command = "skip" | "back" | "faster" | "slower" | "pause";
export type AnswerResult = { ok: boolean; parsed?: { value: number | string }; needs_clarification?: boolean; prompt?: string; error?: string; command?: Command; paused?: boolean; next: Next };

export const LENS_NAMES: Record<string, string> = {
  human_design: "Human Design",
  gene_keys: "Gene Keys",
  enneagram: "Enneagram",
  attachment: "Attachment",
  bigfive: "Big Five",
  chronotype: "Chronotype",
  values: "Values",
  drucker: "How you work best",
  wealth_dynamics: "How you create value",
  kolbe: "Kolbe A",
  working_genius: "Working Genius",
};
export const lensName = (k: string) => LENS_NAMES[k] ?? k.replace(/_/g, " ");

const LABELS_5: Record<number, string> = { 1: "not at all", 2: "a little", 3: "somewhat", 4: "mostly", 5: "completely" };
const LABELS_ENERGY: Record<number, string> = { 1: "drains me", 2: "a bit draining", 3: "neutral", 4: "some energy", 5: "energises me" };
const LABELS_6: Record<number, string> = { 1: "not like me at all", 2: "not like me", 3: "a little like me", 4: "somewhat like me", 5: "like me", 6: "very much like me" };

function kindOf(answer: string | undefined, options?: unknown): Kind {
  const a = (answer ?? "").toLowerCase();
  if (a === "1-6") return "scale6";
  if (a === "1-5" || a === "energy") return "scale5";
  if (a === "clock" || a === "time") return "clock";
  if (a === "a/b/c" || a === "a|b|c" || a === "abc" || (Array.isArray(options) && options.length)) return "abc";
  if (a === "text" || a === "story" || a === "free") return "text";
  return "scale5";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normItem(raw: any): Item | null {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const kind = kindOf(raw.answer, raw.options);
  const a = String(raw.answer ?? "").toLowerCase();
  const labels = raw.labels ?? (kind === "scale6" ? LABELS_6 : kind === "scale5" ? (a === "energy" ? LABELS_ENERGY : LABELS_5) : null);
  return {
    id: String(raw.id),
    bank: String(raw.bank ?? raw.section ?? ""),
    lens: String(raw.lens ?? raw.section ?? raw.bank ?? ""),
    say: String(raw.say ?? raw.text ?? ""),
    kind,
    rawAnswer: String(raw.answer ?? ""),
    labels,
    options: Array.isArray(raw.options) ? raw.options.map((o: { key: string; text: string }) => ({ key: String(o.key), text: String(o.text) })) : [],
    scale: raw.scale ?? null,
    index: Number(raw.index ?? 0),
    of: Number(raw.of ?? 0),
    previous: raw.previous_value,
    reasked: !!raw.reasked,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normProgress(raw: any): Progress {
  const empty: Progress = { percent: 0, answered: 0, skipped: 0, remaining: 0, total: 0, lenses: [], current: null, lens_index: 0, lens_count: 0, part_index: 0, part_count: 0, lenses_done: 0, minutes_left: 0 };
  if (!raw || typeof raw !== "object") return empty;
  let lenses: LensProgress[] = [];
  if (Array.isArray(raw.lenses)) {
    lenses = raw.lenses.map((l: Partial<LensProgress>) => {
      const answered = Number(l.answered ?? 0), total = Number(l.total ?? 0), skipped = Number(l.skipped ?? 0);
      const pct = typeof l.percent === "number" ? l.percent : total ? Math.round((answered / total) * 100) : 0;
      return { lens: String(l.lens), answered, skipped, total, percent: pct, started: l.started ?? answered > 0, complete: l.complete ?? (total > 0 && answered >= total), from: l.from ?? "items" };
    });
  } else if (raw.lenses && typeof raw.lenses === "object") {
    lenses = Object.entries(raw.lenses as Record<string, { answered?: number; total?: number }>).map(([lens, v]) => {
      const answered = Number(v?.answered ?? 0), total = Number(v?.total ?? 0);
      return { lens, answered, skipped: 0, total, percent: total ? Math.round((answered / total) * 100) : 0, started: answered > 0, complete: total > 0 && answered >= total, from: lens === "human_design" || lens === "gene_keys" ? "birth" : "items" };
    });
  }
  let percent = 0, answered = 0, skipped = 0, total = 0, remaining: number | null = null;
  if (typeof raw.overall === "number") { percent = raw.overall <= 1 ? Math.round(raw.overall * 100) : Math.round(raw.overall); }
  else if (raw.overall && typeof raw.overall === "object") {
    answered = Number(raw.overall.answered ?? 0); skipped = Number(raw.overall.skipped ?? 0); total = Number(raw.overall.total ?? 0);
    if (typeof raw.overall.remaining === "number") remaining = raw.overall.remaining;
    percent = typeof raw.overall.percent === "number" ? raw.overall.percent : total ? Math.round(((answered + skipped) / total) * 100) : 0;
  }
  if (!total) { total = lenses.filter((l) => l.from === "items").reduce((s, l) => s + l.total, 0); answered = lenses.filter((l) => l.from === "items").reduce((s, l) => s + l.answered, 0); }
  if (remaining === null) remaining = Math.max(0, total - answered - skipped);
  const current = raw.current ?? null;
  const parts = lenses.filter((l) => l.from === "items");
  return {
    percent, answered, skipped, remaining, total, lenses, current,
    lens_index: typeof raw.lens_index === "number" ? raw.lens_index : current ? lenses.findIndex((l) => l.lens === current) + 1 : 0,
    lens_count: typeof raw.lens_count === "number" ? raw.lens_count : lenses.length,
    part_index: typeof raw.part_index === "number" ? raw.part_index : current ? parts.findIndex((l) => l.lens === current) + 1 : 0,
    part_count: typeof raw.part_count === "number" ? raw.part_count : parts.length,
    lenses_done: typeof raw.lenses_done === "number" ? raw.lenses_done : lenses.filter((l) => l.complete).length,
    minutes_left: typeof raw.minutes_left === "number" ? raw.minutes_left : Math.round((remaining * 20) / 60),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normNext(raw: any): Next {
  const r = raw ?? {};
  return { item: normItem(r.item), intro: typeof r.intro === "string" && r.intro.trim() ? r.intro : undefined, progress: normProgress(r.progress), done: !!r.done, status: r.status, compact: !!r.compact };
}

/** About 20 seconds per item, the plan's own estimate; the engine's number, one source of truth. */
export function minutesLeft(p: Progress): number {
  return Math.max(0, p.minutes_left);
}
