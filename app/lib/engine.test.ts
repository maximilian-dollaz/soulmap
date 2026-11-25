/**
 * Scripted-persona test for the local interview engine. Run: `npx tsx lib/engine.test.ts`
 * Uses the same functions the /api/interview routes call (no HTTP), against a scratch data dir.
 * The local model is off here so the run is deterministic; set SOUL_TEST_LOCAL=1 to also probe Ollama.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const scratch = mkdtempSync(path.join(tmpdir(), "soul-map-test-"));
process.env.SOUL_DATA_DIR = scratch;
process.env.SOUL_LOCAL_MODEL = process.env.SOUL_TEST_LOCAL ? (process.env.SOUL_LOCAL_MODEL ?? "qwen3:8b") : "off";

async function main() {
  const { interviewNext, interviewAnswer, interviewSkip, interviewBack } = await import("./interview");
  type NextPayload = import("./interview").NextPayload;
  const { readState, updateState } = await import("./state");
  const { nextItem, progress, isComplete, applyAnswer, PLAN, itemById, clarificationPrompt } = await import("./engine");
  const { scoreAll } = await import("./score");
  const { parseLocal, localModel } = await import("./parse-local");

  let passed = 0;
  const ok = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

  /** A clear Enneagram 5 (sp-first), secure, high-openness / high-conscientiousness, strong morning type. Answers in words, not numbers. */
  function persona(id: string, say: string): string {
    const yes = ["completely", "yes definitely", "for sure"], mostly = ["mostly", "yeah pretty much", "usually"], no = ["not at all", "nope", "never"], little = ["a little", "not really"];
    const pick = (xs: string[]) => xs[(say.length + id.length) % xs.length];
    if (id === "K_wake") return "around six";
    if (id === "K_bed") return "ten thirty";
    if (/^E5[abc]$/.test(id) || id === "I_sp1" || id === "I_sp2") return pick(yes);
    if (/^E[1-9][abc]$/.test(id)) return pick(no);
    if (/^E5d$/.test(id)) return pick(no); // reversed 5 item, if ever asked
    if (/^E[1-9]d$/.test(id)) return pick(mostly);
    // Drucker learning: three remembered moments (two by doing, one by talking it through) and one that didn't stick (reading)
    if (id === "DRL1") return "I just did it, tried and adjusted";
    if (id === "DRL2") return "the fourth one";
    if (id === "DRL3") return "f";
    if (id === "DRL4") return "the first one";
    if (/^DR[A-Z]?\d$/.test(id)) return "the first one";
    if (/^WD\d+$/.test(id)) return ["a", "b", "c", "d"][Number(id.slice(2)) % 4 === 0 ? 1 : 0];
    if (/^D/.test(id)) return pick(mostly);
    if (/^I_/.test(id)) return pick(little);
    if (/^A\d$/.test(id)) return ["A3", "A7"].includes(id) ? pick(yes) : pick(no); // low anxiety (A3/A7 are reversed)
    if (/^V\d$/.test(id)) return ["V3", "V7"].includes(id) ? pick(yes) : pick(no); // low avoidance (V3/V7 reversed)
    if (/^F[OC][123]$/.test(id)) return pick(yes);
    if (/^F[OC][456]$/.test(id)) return pick(no);
    if (/^F[EAS][123]$/.test(id)) return pick(mostly);
    if (/^F[EAS][456]$/.test(id)) return pick(little);
    if (/^K(1|3|5|7|9)$/.test(id)) return pick(yes); // morning items
    if (/^K(2|4|6|8|10)$/.test(id)) return pick(no);
    if (/^(SD|UN|BE)\d$/.test(id)) return "very much like me";
    if (/^(PO|TR)\d$/.test(id)) return "not like me at all";
    return "somewhat like me";
  }

  const P = "test-persona";
  console.log(`scratch data dir: ${scratch}`);
  console.log(`plan v${PLAN.version}: ${PLAN.items.length} items, sections ${PLAN.sections.map((s) => s.key).join(" > ")}`);

  // ---------- 1. first call: welcome + section intro, first item, turns recorded ----------
  console.log("\n1. start");
  let n = await interviewNext(P);
  ok("first item is the first enneagram item", () => { assert.equal(n.item?.id, "E5a"); assert.equal(n.item?.section, "enneagram"); assert.equal(n.item?.answer, "1-5"); });
  ok("welcome and enneagram intros come once, personalised", () => { assert.match(n.intro ?? "", /^Hey Test persona\./); assert.match(n.intro ?? "", /Part one: what drives you/); });
  n = await interviewNext(P);
  ok("polling /next again repeats neither intro nor the agent turn", () => assert.equal(n.intro, undefined));
  let s = await readState(P);
  ok("thread holds exactly one agent turn per prompt (mode chat)", () => {
    const agent = s.turns.filter((t) => t.role === "agent");
    assert.equal(agent.length, 2, "intro + item");
    assert.ok(agent.every((t) => t.mode === "chat" && t.session_id === "local-chat"));
    assert.equal(s.status, "in_chat");
  });
  ok("profile defaults: nine always-on lenses, no paid ones", () => { assert.deepEqual(s.profile.enabled_lenses, ["human_design", "gene_keys", "enneagram", "attachment", "bigfive", "chronotype", "values", "drucker", "wealth_dynamics"]); assert.equal(s.profile.id, P); });

  // ---------- 2. parsing paths ----------
  console.log("\n2. parsing");
  let a = await interviewAnswer(P, "E5a", "I dunno, it's complicated honestly");
  ok("story with no scale words and the model off asks to clarify, records nothing", () => {
    assert.equal(a.ok, false); assert.equal(a.needs_clarification, true); assert.match(a.prompt ?? "", /number 1 to 5/);
    assert.equal(a.next.item?.id, "E5a");
  });
  s = await readState(P);
  ok("the user's words and the clarification both land in the thread", () => {
    const last2 = s.turns.slice(-2);
    assert.equal(last2[0].role, "user"); assert.match(last2[0].content, /complicated/);
    assert.equal(last2[1].role, "agent"); assert.match(last2[1].content, /number 1 to 5/);
  });
  a = await interviewAnswer(P, "E5a", "yeah... actually not really");
  ok("self-correction maps to 2 (last phrase wins)", () => { assert.equal(a.ok, true); assert.equal(a.parsed?.value, 2); assert.equal(a.parsed?.via, "parser"); assert.equal(a.next.item?.id, "E2a"); });
  a = await interviewAnswer(P, "E5a", "", 5);
  ok("a tapped pill (value) overrides the earlier answer for the same item", () => { assert.equal(a.ok, true); assert.equal(a.parsed?.value, 5); assert.equal(a.parsed?.via, "value"); });
  s = await readState(P);
  assert.equal(s.answers.filter((x) => x.item_id === "E5a").length, 1, "one answer per item");
  ok("pure applyAnswer rejects an out-of-range pill and an unknown item", () => {
    const r = applyAnswer(s, "SD1", "", 7); assert.equal(r.ok, false); assert.equal((r as { needs_clarification?: boolean }).needs_clarification, true);
    const u = applyAnswer(s, "NOPE", "3"); assert.equal(u.ok, false); assert.equal((u as { error?: string }).error?.startsWith("unknown"), true);
  });

  // ---------- 3. skip queue: once re-asks at the end of the section, twice is final ----------
  console.log("\n3. skip and back");
  n = await interviewNext(P);
  assert.equal(n.item?.id, "E2a");
  n = await interviewSkip(P, "E2a");
  ok("skip moves on to the next first-pass item", () => assert.equal(n.item?.id, "E8a"));
  a = await interviewAnswer(P, "E8a", persona("E8a", ""));
  a = await interviewAnswer(P, "E4a", persona("E4a", ""));
  const back = await interviewBack(P);
  ok("back reopens the previous item in the section with its value pre-selected", () => {
    assert.equal(back.reopened, true); assert.equal(back.item?.id, "E4a"); assert.equal(back.item?.previous_value, 1);
  });
  s = await readState(P);
  assert.equal(s.answers.some((x) => x.item_id === "E4a"), false, "reopened answer lifted out until re-answered");
  a = await interviewAnswer(P, "E4a", "somewhat");
  ok("re-answering the reopened item records the new value and continues forward", () => { assert.equal(a.parsed?.value, 3); assert.equal(a.next.item?.id, "E9a"); });

  // answer the rest of the enneagram section with the persona and watch for the E2a re-ask
  let reaskedSeen: { id: string; index: number; of: number } | null = null;
  let guard = 0;
  let handoff: NextPayload | null = null; // the payload that first showed the attachment section
  while ((n = await interviewNext(P)).item && n.item.section === "enneagram" && guard++ < 200) {
    if (n.item.id === "E2a") { reaskedSeen = { id: n.item.id, index: n.item.index, of: n.item.of }; assert.equal(n.item.reasked, true); handoff = await interviewSkip(P, "E2a"); continue; }
    handoff = (await interviewAnswer(P, n.item.id, persona(n.item.id, n.item.say))).next;
  }
  s = await readState(P);
  ok("the skipped item came back once, at the end of its section, and a second skip is final", () => {
    assert.ok(reaskedSeen, "E2a was re-asked");
    assert.equal(reaskedSeen!.index, reaskedSeen!.of, "re-asked as the last item of the section");
    assert.equal(s.interview.skips["E2a"], 2);
    assert.equal(s.answers.some((x) => x.item_id === "E2a"), false);
  });
  const en = scoreAll(s).enneagram!;
  const askedEnn = new Set(s.answers.filter((x) => x.section === "enneagram").map((x) => x.item_id));
  ok("checkpoint: confident type 5 skipped the nine skip_if_confident items", () => {
    assert.equal(en.type, 5, `type ${en.type}, confidence ${en.confidence}`);
    assert.ok(en.confidence >= 0.6, `confidence ${en.confidence}`);
    const dItems = PLAN.items.filter((i) => i.bank === "enneagram" && i.skip_if_confident).map((i) => i.id);
    assert.equal(dItems.length, 9);
    for (const id of dItems) assert.equal(askedEnn.has(id), false, `${id} should have been skipped`);
  });
  ok("checkpoint: disambiguation items asked only when both types are contenders; instinct items always", () => {
    for (const it of PLAN.items.filter((i) => i.ask_if_contending)) {
      const both = it.ask_if_contending!.every((t) => en.contenders.includes(t));
      assert.equal(askedEnn.has(it.id), both, `${it.id} pair ${it.ask_if_contending} contenders ${en.contenders}`);
    }
    for (const id of ["I_sp1", "I_sp2", "I_so1", "I_so2", "I_sx1", "I_sx2"]) assert.ok(askedEnn.has(id), `${id} asked`);
  });
  ok("the next section intro arrives with the first item of the new section, and only there", () => {
    assert.equal(handoff?.item?.section, "attachment"); assert.match(handoff?.intro ?? "", /^Part two/);
    assert.equal(n.item?.section, "attachment"); assert.equal(n.intro, undefined);
  });

  // ---------- 4. run the remaining sections ----------
  console.log("\n4. remaining sections");
  guard = 0;
  const intros: string[] = [];
  let last: NextPayload = n;
  while ((n = await interviewNext(P)).item && guard++ < 400) {
    const r = await interviewAnswer(P, n.item.id, persona(n.item.id, n.item.say));
    assert.equal(r.ok, true, `${n.item.id} "${persona(n.item.id, n.item.say)}" -> ${JSON.stringify(r)}`);
    last = r.next;
    if (last.intro && last.item) intros.push(last.item.section);
  }
  s = await readState(P);
  const sc = scoreAll(s);
  ok("interview completes: no next item, status complete, close line said once", () => {
    assert.equal(n.item, null); assert.equal(n.done, true); assert.equal(isComplete(s), true); assert.equal(s.status, "complete");
    assert.match(last.intro ?? "", /That's everything\./); assert.equal(last.done, true);
    assert.deepEqual(s.interview.intros_shown, ["welcome", "enneagram", "attachment", "bigfive", "chronotype", "values", "drucker", "wealth_dynamics", "close"]);
  });
  ok("section intros each came once, in plan order", () => assert.deepEqual(intros, ["bigfive", "chronotype", "values", "drucker", "wealth_dynamics"]));
  ok("checkpoints in the other sections behaved", () => {
    const asked = new Set(s.answers.map((x) => x.item_id));
    assert.ok(sc.attachment!.confidence >= 0.5, `attachment confidence ${sc.attachment!.confidence}`);
    for (const id of ["A4", "V4", "A8", "V8"]) assert.equal(asked.has(id), false, `${id} skipped`);
    for (const d of ["openness", "conscientiousness", "extraversion", "agreeableness", "emotional_stability"] as const) {
      const skipItem = { openness: "FO6", conscientiousness: "FC6", extraversion: "FE6", agreeableness: "FA6", emotional_stability: "FS6" }[d];
      assert.equal(asked.has(skipItem), sc.bigfive!.domain_confidence[d] < 0.7, `${skipItem}: domain_confidence ${sc.bigfive!.domain_confidence[d]}`);
    }
    assert.ok(sc.chronotype!.confidence >= 0.6, `chronotype confidence ${sc.chronotype!.confidence}`);
    for (const id of ["K9", "K10"]) assert.equal(asked.has(id), false, `${id} skipped`);
    for (const it of PLAN.items.filter((i) => i.bank === "values")) assert.ok(asked.has(it.id), `${it.id} asked (values never skip)`);
  });
  ok("scoring works on the result", () => {
    assert.equal(sc.enneagram!.type, 5); assert.equal(sc.enneagram!.instinct, "sp");
    assert.equal(sc.attachment!.style, "secure");
    assert.equal(sc.bigfive!.levels.openness, "high"); assert.equal(sc.bigfive!.levels.conscientiousness, "high");
    assert.ok(/morning/.test(sc.chronotype!.label), sc.chronotype!.label);
    assert.equal(sc.chronotype!.natural_wake, "06:00"); assert.equal(sc.chronotype!.natural_bed, "22:30");
    assert.ok(sc.values!.top.includes("self_direction") && sc.values!.top.includes("universalism"), sc.values!.top.join(","));
    assert.ok(sc.values!.bottom.includes("power"), sc.values!.bottom.join(","));
    assert.equal(sc.drucker!.answered, 16); assert.equal(sc.drucker!.choices.learning_slow.value, "reading");
    assert.deepEqual(sc.drucker!.learning, { value: "doing", text: "I just did it, tried and adjusted", count: 2, of: 3, moments: ["doing", "doing", "talking"], tie: false, slow: "reading" });
    assert.equal(sc.drucker!.choices.learning.value, "doing"); assert.equal(sc.drucker!.choices.mirror.question, "values"); assert.equal(sc.drucker!.choices.result.question, "contribute");
    assert.equal(sc.wealth_dynamics!.answered, 12); assert.ok(["Creator", "Star", "Supporter", "Deal Maker", "Trader", "Accumulator", "Lord", "Mechanic"].includes(sc.wealth_dynamics!.profile), sc.wealth_dynamics!.profile);
    assert.equal(sc.kolbe_proxy, null, "no Kolbe proxy"); assert.equal(sc.working_genius, null, "no Working Genius proxy");
  });
  const pr = progress(s);
  ok("progress: items lenses at 100%, birth lenses at 0 (no chart), overall counts add up", () => {
    for (const l of pr.lenses) if (l.from === "items") assert.equal(l.percent, 100, `${l.lens} ${l.percent}%`); else assert.equal(l.percent, 0);
    assert.equal(pr.lens_count, 9); assert.equal(pr.done, true);
    assert.equal(pr.overall.answered, s.answers.length); assert.equal(pr.overall.skipped, 1); assert.equal(pr.overall.total, s.answers.length + 1); assert.equal(pr.overall.percent, 100);
  });
  ok("every exchange is in the one thread", () => {
    const users = s.turns.filter((t) => t.role === "user").length, agents = s.turns.filter((t) => t.role === "agent").length;
    assert.ok(users >= s.answers.length, `${users} user turns for ${s.answers.length} answers`);
    assert.ok(agents >= s.answers.length, `${agents} agent turns`);
    assert.ok(s.transcript.includes("Test persona:"));
  });
  console.log(`   answered ${s.answers.length}, skipped-final 1, dropped by checkpoints ${PLAN.items.length - s.answers.length - 1}; enneagram ${en.type}w${en.wing} ${en.instinct} conf ${en.confidence}; attachment ${sc.attachment!.style}; chronotype ${sc.chronotype!.label}; values top ${sc.values!.top.join("/")}`);

  // ---------- 5. a flat persona: low confidence means everything is asked ----------
  console.log("\n5. flat persona (no checkpoint skips)");
  const F = "flat";
  guard = 0;
  while ((n = await interviewNext(F)).item && guard++ < 400) await interviewAnswer(F, n.item.id, n.item.answer === "clock" ? "eight" : "3");
  const fs_ = await readState(F);
  ok("undecided answers keep enneagram, attachment and chronotype below threshold, so every item of theirs is asked", () => {
    const asked = new Set(fs_.answers.map((x) => x.item_id));
    const fsc = scoreAll(fs_);
    assert.ok(fsc.enneagram!.confidence < 0.6 && fsc.attachment!.confidence < 0.5 && fsc.chronotype!.confidence < 0.6, JSON.stringify([fsc.enneagram!.confidence, fsc.attachment!.confidence, fsc.chronotype!.confidence]));
    for (const it of PLAN.items.filter((i) => ["enneagram", "attachment", "chronotype", "values"].includes(i.bank))) assert.ok(asked.has(it.id), `${it.id} asked`);
    // Big Five confidence is consistency (forward vs reversed items agree), which all-3s satisfies, so its five skip items are dropped: 127 - 5
    assert.equal(fs_.answers.length, PLAN.items.length - 5);
    assert.equal(isComplete(fs_), true);
  });

  // ---------- 6. profiles are isolated and lenses gate sections ----------
  console.log("\n6. profiles");
  ok("two profiles never share answers or files", () => {
    assert.notEqual(s.answers.length, fs_.answers.length);
    assert.ok(existsSync(path.join(scratch, "profiles", P, "state.json")) && existsSync(path.join(scratch, "profiles", F, "state.json")));
    assert.equal(existsSync(path.join(scratch, "state.json")), false);
  });
  // Someone who finished before Drucker's five questions: an old self-guessed DR2 answer, none of the new items, report written.
  const NEW_DR = /^DR[LVBC]\d$/;
  await updateState((st) => {
    st.answers = [...s.answers.filter((x) => !NEW_DR.test(x.item_id)), { item_id: "DR2", section: "drucker", value: "b", raw: "b", at: new Date().toISOString() }];
    st.interview.skips = { ...s.interview.skips }; st.interview.intros_shown = [...s.interview.intros_shown];
    st.status = "reported";
  }, "returning");
  const rt = await interviewNext("returning");
  const rst = await readState("returning");
  const rs = scoreAll(rst);
  ok("a finished profile gets the new Drucker questions, starting with the first learning moment", () => {
    assert.equal(rt.item?.id, "DRL1"); assert.equal(rt.item?.options?.length, 6); assert.equal(rt.item?.of, 16);
  });
  ok("the retired self-guessed DR2 answer is neither scored nor counted", () => {
    assert.equal(rs.drucker!.answered, 7); assert.equal(rs.answered.drucker, 7); assert.equal(rs.drucker!.learning, null); assert.equal(rs.drucker!.choices.learning, undefined);
  });
  ok("six-option items take E and F by letter and position, and the clarification lists every letter", () => {
    const r1 = applyAnswer(rst, "DRL1", "option e"); assert.equal(r1.ok, true); assert.equal((r1 as { parsed: { value: string } }).parsed.value, "e");
    const r2 = applyAnswer(rst, "DRL1", "the sixth one"); assert.equal(r2.ok, true); assert.equal((r2 as { parsed: { value: string } }).parsed.value, "f");
    assert.equal(clarificationPrompt(itemById("DRL1")!), "Which is closest: A, B, C, D, E, or F?");
  });
  await updateState((st) => { st.profile.enabled_lenses = ["human_design", "gene_keys", "chronotype"]; }, "chrono-only");
  const c1 = await interviewNext("chrono-only");
  ok("a profile with only chronotype enabled starts at K_wake and never sees other banks", () => { assert.equal(c1.item?.id, "K_wake"); assert.equal(c1.progress.lens_count, 3); });
  const cs = await readState("chrono-only");
  ok("answering an item from a disabled lens is refused", () => { const r = applyAnswer(cs, "E5a", "5"); assert.equal(r.ok, false); assert.match((r as { error: string }).error, /not enabled/); });
  ok("clock items parse spoken times and keep the person's words as raw", () => {
    const r = applyAnswer(cs, "K_wake", "half past six"); assert.equal(r.ok, true); assert.equal((r as { parsed: { value: number } }).parsed.value, 6.5);
    const b = applyAnswer(cs, "K_bed", "eleven"); assert.equal(b.ok, true); assert.equal((b as { parsed: { value: number } }).parsed.value, 23);
  });
  ok("A/B/C items are the Drucker and Wealth Dynamics choices, each with its own options; no energy items in the plan", () => {
    assert.equal(itemById("E5a")?.answer, "1-5");
    const abc = PLAN.items.filter((i) => i.answer === "A/B/C");
    assert.deepEqual(abc.map((i) => i.bank), [...Array(16).fill("drucker"), ...Array(12).fill("wealth_dynamics")]);
    assert.ok(abc.every((i) => (i.options?.length ?? 0) >= 3));
    assert.equal(PLAN.items.some((i) => i.answer === "energy"), false);
  });

  // ---------- 7. optional: the local model on real story answers ----------
  if (localModel()) {
    console.log(`\n7. local model (${localModel()})`);
    const probes: Array<[string, string, (v: number | string) => boolean]> = [
      ["E5a", "Honestly if I don't get an evening to myself I start to lose it, so yeah, a lot.", (v) => v === 4 || v === 5],
      ["FC2", "Ha, no, the dishes sit there for days.", (v) => v === 1 || v === 2],
      ["SD1", "That's basically my whole personality.", (v) => v === 5 || v === 6],
      ["K_bed", "I'm usually out by quarter to midnight.", (v) => v === 23.75],
    ];
    for (const [id, words, good] of probes) {
      const t0 = Date.now();
      const r = await parseLocal(itemById(id)!, words);
      console.log(`  ${r && good(r.value) ? "ok " : "??"} ${id} "${words}" -> ${JSON.stringify(r)} (${Date.now() - t0} ms)`);
    }
  } else {
    console.log("\n7. local model: off (set SOUL_TEST_LOCAL=1 to probe Ollama)");
  }

  rmSync(scratch, { recursive: true, force: true });
  console.log(`\n${passed} checks passed`);
}

main().catch((err) => { console.error(err); rmSync(scratch, { recursive: true, force: true }); process.exit(1); });
