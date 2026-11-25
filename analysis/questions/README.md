# Soul Map question banks

Seven voice-delivered self-assessments for the Retell agent, plus pure-TypeScript scoring. 175 items total (88 in the original three banks, 87 in the four added in v0.2), about an hour read aloud, about 47 minutes with the adaptive skips.

| File | What |
|---|---|
| `enneagram.json` | 48 items: 4 per type (3 forward, 1 reversed), 6 look-alike disambiguators (3/7, 1/6, 2/9, 5/9, 4/6, 8/3), 6 instinct items (sp/so/sx). 1-5 agreement scale. |
| `attachment.json` | 16 items: Anxiety x8, Avoidance x8, mixed polarity, half framed for close relationships and half for team collaboration. 1-5 scale. |
| `kolbe_proxy.json` | 24 scenario items, 6 per Action Mode, each with three options tagged counteract / respond / initiate. Also carries the label vocabulary, sequence verbs and Conables-style do/don't lists per label. |
| `bigfive.json` | 30 IPIP items (public domain, lightly adapted), 6 per domain, 3 forward and 3 reversed. Two facets tagged on the items: orderliness (4 items in C) and assertiveness (3 items in E). 1-5 scale. Ids `FO1`..`FS6`. |
| `working_genius.json` | 24 original items: 18 energy items (3 per kind of work: Wonder, Invention, Discernment, Galvanizing, Enablement, Tenacity) on a 1-5 'drains me .. really energizes me' scale, plus 6 competency items on the 1-5 agreement scale. |
| `chronotype.json` | 12 original Morningness-Eveningness style items: two free-day clock questions (wake, bed) and 10 agreement items, 5 morning-keyed and 5 evening-keyed. |
| `values.json` | 21 original portrait items ("Someone who ... how much like you?") on a 1-6 similarity scale, 2 per Schwartz value and 3 for universalism. |
| `scoring.ts` | `score_enneagram`, `score_attachment`, `score_kolbe_proxy`, `score_bigfive`, `score_working_genius`, `score_chronotype`, `score_values`, plus `parseScaleAnswer` / `parseOptionAnswer` / `parseEnergyAnswer` / `parseSimilarityAnswer` / `parseClockAnswer` for spoken answers. No dependencies. Every scorer returns `{ ..., confidence, answered, total }`. |
| `interview_plan.json` | One conversational flow: section intros the agent says verbatim, all 175 items in asking order with the Kolbe options inlined, `skip_if_confident` flags, `ask_if_contending` pairs, and seven checkpoints telling the agent when to run a scorer and what to skip. |
| `voice_answer_parser.json` | Keyword tables (phrase -> 1-5, position words -> A/B/C, energy phrases -> 1-5, similarity phrases -> 1-6, clock-time rules) and the rules for ambiguity and negation. Embed it in the agent prompt. |
| `test_run.ts` | Fictional persona answering everything, output below. `node test_run.ts` (Node 22.18+) or `npx tsx test_run.ts`. |

## Constructs modeled

**Enneagram.** Nine types scored independently; the type is the highest 0-100 score (50 = neutral), the wing is the stronger adjacent type, the instinct stack orders self-preservation / social / sexual. Disambiguation items load +1 on one type and -1 on its common look-alike so a single answer pushes the pair apart. Confidence = margin between the top two (20 points = full) times a coverage factor, so a checkpoint on 27 items can still clear the skip threshold.

**Attachment.** Two continuous dimensions in the Brennan / Clark / Shaver tradition (attachment anxiety, attachment avoidance), cut at the scale midpoint into Bartholomew's four styles: secure, anxious (preoccupied), avoidant (dismissing), fearful-avoidant. The result also reports each dimension split by context (close vs work) so the report can say, for example, "secure at home, avoidant on the team".

**Kolbe proxy.** Four conative Action Modes, each on 1-10 in three zones, following the public structure of a Kolbe A result: Fact Finder (Simplify / Explain / Specify), Follow Thru (Adapt / Maintain / Systematize), Quick Start (Stabilize / Modify / Innovate), Implementor (Imagine / Restore / Build). Output mirrors the shape of a real Kolbe A report: MO string ("2-3-9-6"), a strength label per mode, an energy split that sums to 100%, a problem-solving sequence ordered by score, and do / don't tips per label. Scoring: net = (initiate - counteract) / answered, score = round(5.5 + 4.5 x net). All-initiate is 10, all-counteract is 1, balanced or all-respond is 6.

**Big Five.** Five domains in the IPIP Big-Five Factor Markers tradition (Goldberg), with Neuroticism scored in its positive direction as Emotional Stability. Each domain is the mean of 6 items after reversal, mapped to 0-100 (50 = neutral); levels are low (< 35), average, high (> 65). Two work-relevant facets are read off tagged items with the same formula: orderliness (C1, C3, C4, C5) and assertiveness (E2, E5, E6). Domain confidence = agreement between the forward and reversed halves times coverage, so an acquiescent "yes to everything" run shows up as low confidence and a note, not as a profile.

**Working Genius proxy.** Six kinds of work, each scored on *energy* (mean of 3 items, 0-100) and *competency* (1 item, 0-100). The six are ranked by energy (competency breaks ties): ranks 1-2 are the person's geniuses, 3-4 competencies, 5-6 frustrations. Confidence is the smaller of the two gaps that draw those lines (10 points = full) times coverage. Notes flag "skilled but drained" (competency >= 75, energy <= 40: the burnout spot) and "energized but unskilled" (worth developing). This is a proxy inspired by the model, not the licensed assessment; see Sources.

**Chronotype.** Morningness 0-100 in the Horne-Ostberg tradition. 10 agreement items give 70% of the score, the two free-day clock answers 30% (wake 05:00 -> 100 to 10:00 -> 0; bed 21:00 -> 100 to 02:00 -> 0). The MEQ cuts (30/41/58/69 on 16-86) are rescaled to 20/36/60/76 and give the five labels. Windows: natural wake and bed are the clock answers when given, else derived from the score (wake = 10:00 minus 5 h x score/100, bed = wake minus 8 h); the peak window starts 2 h after waking plus up to 5 h later for evening types and lasts 3 h. Confidence = distance from the nearest cut (8 points = full) times coverage, halved when the stated times and the agreement items disagree by more than 35 points (usually a schedule the person is stuck with, not their clock).

**Schwartz values.** Ten basic values, each the mean of its portrait items on 1-6, then *centered* by subtracting the person's mean over all 21 items (MRAT), the standard ipsatization that removes scale-use differences. Top-3 and bottom-3 are by centered score. Four higher-order dimensions are means of their values' centered scores: openness to change (self-direction, stimulation, hedonism), self-enhancement (achievement, power), conservation (security, conformity, tradition), self-transcendence (benevolence, universalism). Hedonism sits with openness to change, its usual home; the raw scores are returned so a report can move it. Confidence = spread of the centered scores (SD 0.8 = full) times coverage, so a flat "everything is like me" profile reads as low confidence with a note.

## Sources (public descriptions only)

- Enneagram: the Enneagram Institute's public type descriptions (Riso / Hudson), Naranjo's subtype (sp/so/sx) framework, and the commonly listed mistyping pairs. No RHETI items were used.
- Attachment: Brennan, Clark & Shaver (1998) two-dimension model; Fraley, Waller & Brennan (2000) ECR-R dimensions; Bartholomew & Horowitz (1991) four-category model. No ECR / ECR-R items were used.
- Kolbe: kolbe.com's public description of the four Action Modes and the three zones, and the structure of one real Kolbe A result (used only as a format reference). No Kolbe A items were used.
- Big Five: International Personality Item Pool (ipip.ori.org), public domain. Items are from the IPIP Big-Five Factor Markers and IPIP-NEO facet scales, lightly adapted to first-person spoken English. Facet assignments follow the IPIP-NEO Orderliness (C2) and Assertiveness (E3) scales.
- Working Genius: the public description of the six kinds of work in Patrick Lencioni's *The 6 Types of Working Genius* (Wonder, Invention, Discernment, Galvanizing, Enablement, Tenacity) and the genius / competency / frustration banding. **This bank is a proxy inspired by the model, not the licensed Working Genius assessment; no items from the instrument were used, and the energy-vs-competency split and all wording are original.**
- Chronotype: the construct and category cuts of the Horne & Ostberg (1976) Morningness-Eveningness Questionnaire and the Adan & Almirall (1991) reduced MEQ. No MEQ or rMEQ items were used.
- Values: Schwartz (1992) ten basic values and the four higher-order dimensions; the portrait format follows the public description of the Portrait Values Questionnaire (Schwartz et al., 2001) and the 21-item ESS layout (2 per value, 3 for universalism). No PVQ or ESS items were used.

## Limitations

- These are proxies written from public construct descriptions, not the licensed RHETI, ECR-R or Kolbe A. No norming sample, no reliability data. Treat results as a strong prior to confirm in conversation, not a diagnosis.
- Four items per Enneagram type is thin; the disambiguators and the checkpoint logic compensate but a 1-wing-vs-type confusion can survive. The `contenders` list says who is still in the race.
- Self-report by voice is noisy: the parser maps "yeah" to 4 and "kind of" to 3, which is coarse. The agent should confirm whenever `parseScaleAnswer` returns null or `parseOptionAnswer` returns `uncertain`.
- The Kolbe proxy is cognitive self-report of conative behavior, which the real instrument avoids by using forced-choice ranking. Real MOs usually sum to 18-22; the scorer flags sums outside 16-24 in `notes`.
- Attachment items for work are an extension of the construct, not a validated workplace scale.
- Big Five with 6 items per domain is a short form; facets with 3-4 items are indicative only. Emotional stability is reported in the positive direction, so a "high" there means low neuroticism.
- The Working Genius proxy ranks on self-reported energy, which the licensed instrument triangulates with more items and a different format. With 3 items per kind, two types often tie; competency breaks the tie and the scorer says so in `notes`. Bands are relative (always 2 / 2 / 2) even when all six energies are close; read `confidence` before reading the bands.
- Chronotype peak and sleep windows are formulas, not measurements; they are a starting point to confirm against how the person actually sleeps. The clock parser handles plain times, "half past", a.m./p.m., "midnight"; anything else returns null and the agent should re-ask.
- Values are ipsatized, so the scores say which values matter more *for this person*, not how they compare with other people. A high MRAT (everything "like me") is flagged, not corrected.

## Test run

Persona "Nadia", a restless founder: expected 7w8 sx-first, avoidant attachment, Kolbe around Simplify / Adapt / Innovate / Restore, Big Five high openness and extraversion with low conscientiousness, Invention + Galvanizing genius with Enablement + Tenacity frustration, a moderate evening type, and stimulation / self-direction on top with tradition / conformity at the bottom. Full answers are in `test_run.ts`.

```
$ node test_run.ts
```

```
== enneagram ==
type 7, wing 8 ("7w8"), instinct sx, stack [sx, so, sp]
confidence 1, runner_up 8, contenders [7]
scores_by_type { 1: 30, 2: 50, 3: 50, 4: 30, 5: 45, 6: 29.17, 7: 95, 8: 75, 9: 12.5 }
instinct_scores { sp: 37.5, so: 50, sx: 100 }   answered 48/48

== attachment ==
style avoidant, anxiety 1.88, avoidance 4.25, confidence 1
by_context { close: { anxiety 1.75, avoidance 4.5 }, work: { anxiety 2, avoidance 4 } }   answered 16/16

== kolbe_proxy ==
mo_string "2-2-10-6"
strengths { fact_finder: Simplify, follow_thru: Adapt, quick_start: Innovate, implementor: Restore }
energy_pct { fact_finder: 10, follow_thru: 10, quick_start: 50, implementor: 30 }   sum 20
problem_solving_sequence: Innovate (brainstorm and experiment) -> Restore (check the materials and fix what's there)
  -> Simplify (summarize and clarify the bottom line) -> Adapt (look for shortcuts)
confidence 0.92, mode_confidence { fact_finder: 0.83, follow_thru: 0.83, quick_start: 1, implementor: 1 }
conables.quick_start: do [Experiment, Race the clock, Promote alternatives, Take on challenges]
                      dont [Stick to the script, Hesitate, Second-guess yourself, Fear failing]

== enneagram checkpoint after 27 items ==
type 7, runner_up 8, confidence 0.62, contenders [7, 8]
-> clears the 0.6 threshold: the nine reversed items are skipped; no disambiguator pair is fully inside {7, 8}, so none are asked.

== parseScaleAnswer ==
"yeah pretty much" 4 | "not at all" 1 | "hmm, kind of, sometimes" 3 | "four" 4 | "I'd say 8 out of 10" 4
"not completely" 2 | "absolutely" 5 | "honestly no" 1 | "it depends on the day" 3 | "banana" null (re-ask)

== parseOptionAnswer (FF1) ==
"b" -> b | "the first one" -> a | "I'd probably dig into the data and the history" -> c
"I just get the gist and go" -> a | "uh, neither" -> null, uncertain (confirm A/B/C)
```

```
== bigfive ==
scores { openness 87.5, conscientiousness 29.17, extraversion 95.83, agreeableness 58.33, emotional_stability 66.67 }
levels { openness high, conscientiousness low, extraversion high, agreeableness average, emotional_stability high }
facets { orderliness 25, assertiveness 100 }
domain_confidence { openness 0.92, conscientiousness 0.92, extraversion 0.92, agreeableness 1, emotional_stability 1 }
confidence 0.95   answered 30/30   notes []

== working_genius ==
ranking: Invention (genius, energy 100, competency 100) -> Galvanizing (genius, 91.67, 75)
  -> Wonder (competency, 66.67, 75) -> Discernment (competency, 66.67, 75)
  -> Enablement (frustration, 16.67, 50) -> Tenacity (frustration, 8.33, 25)
genius [invention, galvanizing]  competency [wonder, discernment]  frustration [enablement, tenacity]
confidence 1   answered 24/24   notes []

== chronotype ==
label moderate_evening, score 23.25 (agreement 22.5, clock 25)
peak_window "14:15–17:15", wake_window "08:00–09:00", sleep_window "01:00–08:30", natural_wake "08:30", natural_bed "01:00"
confidence 0.41 (3 points from the definite-evening cut)   answered 12/12   notes []

== values ==
centered { self_direction 2.24, stimulation 2.24, achievement 1.24, hedonism 0.74, benevolence 0.24, universalism -0.09,
           power -0.26, security -1.76, conformity -2.26, tradition -2.26 }   mrat 3.76
top [self_direction, stimulation, achievement]   bottom [tradition, conformity, security]
higher_order { openness_to_change 1.74, self_enhancement 0.49, conservation -2.09, self_transcendence 0.08 }
confidence 1   answered 21/21   notes []

== bigfive checkpoint after 25 items ==
domain_confidence { openness 0.78, conscientiousness 0.93, extraversion 0.86, agreeableness 0.89, emotional_stability 0.86 }
-> every domain clears 0.7: all five skip_if_confident items are skipped.

== working_genius checkpoint after 12 energy items ==
genius [invention, galvanizing], frustration [enablement, tenacity], confidence 0.8
-> clears 0.6: the six third energy items are skipped; the six competency items are still asked.

== chronotype checkpoint after 10 items ==
label moderate_evening, score 22.82, confidence 0.33
-> below 0.6 (close to the definite-evening cut), so K9 and K10 are asked.

== parseEnergyAnswer ==
"that drains me" 1 | "love it" 5 | "neutral" 3 | "a bit draining" 2 | "yeah, energizing" 4 | "honestly, meh" 2 | "two" 2 | "it kills me" 1 | "not at all" 1

== parseSimilarityAnswer ==
"very much like me" 6 | "not like me at all" 1 | "a little like me" 3 | "that's me" 5 | "not really" 2 | "somewhat" 4 | "six" 6 | "8 out of 10" 5 | "banana" null (re-ask)

== parseClockAnswer ==
"6:30" (wake) 6.5 | "half past seven" (wake) 7.5 | "around 9" (wake) 9 | "11" (bed) 23 | "eleven thirty pm" (bed) 23.5
"1 am" (bed) 1 | "midnight" (bed) 0 | "23:45" (bed) 23.75 | "whenever" (bed) null (re-ask)
```

Both `node test_run.ts` and `npx tsx test_run.ts` were run and produce the same output.

## Using it from the app

```ts
import { score_enneagram, score_attachment, score_kolbe_proxy, score_bigfive, score_working_genius, score_chronotype, score_values } from "./scoring.ts";
const e = score_enneagram(answers, enneagramBank);   // answers: { E1a: 4, E1b: 2, ... }
const a = score_attachment(answers, attachmentBank);  // { A1: 2, V1: 5, ... }
const k = score_kolbe_proxy(answers, kolbeBank);      // { FF1: "a", FT1: "c", ... } (option key or zone name)
const b = score_bigfive(answers, bigfiveBank);         // { FO1: 5, FC1: 2, ... }
const g = score_working_genius(answers, geniusBank);   // { W1: 4, ..., WC: 4, ... } energy and competency items share one object
const c = score_chronotype(answers, chronotypeBank);   // { K_wake: "8:30", K_bed: "1 am", K1: 2, ... } clock answers as spoken
const v = score_values(answers, valuesBank);           // { SD1: 6, ST1: 6, ... } on 1-6
```

`interview_plan.json` item ids are the bank ids, so answers can be keyed straight from the plan; ids are unique across all seven banks (the Big Five bank is prefixed `F` so it never collides with the attachment `A` items). Clock answers (`K_wake`, `K_bed`) go in as the spoken string; `parseClockAnswer` runs inside `score_chronotype`. Energy and similarity answers go in as numbers after `parseEnergyAnswer` / `parseSimilarityAnswer`. If you reorder the plan, keep the checkpoints after the last non-skippable item of each section.
