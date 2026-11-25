import { NextResponse } from "next/server";
import { readState } from "@/lib/state";
import { liveFromState, scoreAll } from "@/lib/score";
import { progress } from "@/lib/engine";
import { profileIdFrom } from "@/lib/profile";
import type { Live } from "@/components/SoulMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the map screens draw: /api/live plus the four newer lenses (Big Five, chronotype, values,
 * Working Genius), the enabled lens list and whether the birth time is approximate. A superset of /api/live
 * so the UI has one call; built here so lib/score.ts stays the engine team's.
 */
export async function GET(req: Request) {
  const s = await readState(profileIdFrom(req));
  const base = liveFromState(s);
  const sc = scoreAll(s);
  const pct = (n: number, t: number) => Math.min(1, t ? n / t : 0);
  const bf = sc.bigfive as { scores: Record<string, number>; levels: Record<string, string>; confidence: number } | null;
  const ch = sc.chronotype as { label: string; score: number; peak_window: string; natural_wake?: string; natural_bed?: string; confidence: number } | null;
  const va = sc.values as { centered: Record<string, number>; top: string[]; confidence: number } | null;
  const wg = sc.working_genius as { ranking: { genius: string; name?: string; band: string; energy: number }[]; confidence: number } | null;
  const live: Live = {
    ...base,
    progress: {
      ...base.progress,
      bigfive: pct(sc.answered.bigfive, sc.totals.bigfive),
      chronotype: pct(sc.answered.chronotype, sc.totals.chronotype),
      values: pct(sc.answered.values, sc.totals.values),
      working_genius: pct(sc.answered.working_genius, sc.totals.working_genius),
    },
    bigfive: bf ? { scores: bf.scores, levels: bf.levels, confidence: bf.confidence } : null,
    chronotype: ch ? { label: ch.label, score: ch.score, peak_window: ch.peak_window, natural_wake: ch.natural_wake, natural_bed: ch.natural_bed, confidence: ch.confidence } : null,
    values: va ? { centered: va.centered, top: va.top, confidence: va.confidence } : null,
    drucker: sc.drucker ? { choices: sc.drucker.choices, learning: sc.drucker.learning } : null,
    wealth_dynamics: sc.wealth_dynamics ? { profile: sc.wealth_dynamics.profile, primary: sc.wealth_dynamics.primary, secondary: sc.wealth_dynamics.secondary, energies: sc.wealth_dynamics.energies } : null,
    working_genius: wg ? { ranking: wg.ranking, confidence: wg.confidence } : null,
    enabled: s.profile.enabled_lenses,
    approx: !!s.chart && (s.birth?.time_confidence === "unknown" || s.birth?.time_confidence === "approx" || s.profile.birth_time_known === false),
  };
  return NextResponse.json(
    { ...live, answered: s.answers.length, status: s.status, turns: s.turns, profile: s.profile, interview: progress(s), has_chart: !!s.chart },
    { headers: { "cache-control": "no-store" } },
  );
}
