"""Scorer: windows a person's turns, sends each window to the chosen model with a fixed codebook,
and aggregates per source. Only numbers and scrubbed paraphrases leave this module.

SOUL_ENGINE=claude scores with Claude (SOUL_CLAUDE_MODEL, default claude-haiku-5-5) on ANTHROPIC_API_KEY;
anything else uses the local Ollama model (SOUL_LOCAL_MODEL at OLLAMA_URL)."""
from __future__ import annotations

import json
import os
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter

from .importers import Turn
from .scrub import clean_observation

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
ENGINE = os.environ.get("SOUL_ENGINE", "local")
MODEL = os.environ.get("SOUL_CLAUDE_MODEL", "claude-haiku-5-5") if ENGINE == "claude" else os.environ.get("SOUL_LOCAL_MODEL", "qwen3:8b")
LOCAL_MODEL = os.environ.get("SOUL_LOCAL_MODEL", "qwen3:8b")
# Messages and email are scored on this Mac's local model unless the person allowed Claude for them.
PERSONAL_ENGINE = os.environ.get("SOUL_PERSONAL_ENGINE", "local")


def _local_ready() -> bool:
    try:
        with urllib.request.urlopen(OLLAMA_URL.replace("/api/chat", "/api/tags"), timeout=3) as r:
            return r.status == 200
    except Exception:
        return False
WINDOW_TURNS = 40
WINDOW_CHARS = 6000
TURN_CHARS = 1500  # each turn is truncated to this in the prompt, so windows are sized by it

CODEBOOK = {
    "detail_level": "0 = wants only the headline, 100 = wants every detail and the raw artifact",
    "directness": "0 = hedged, indirect, polite framing; 100 = blunt, says exactly what is wanted",
    "warmth": "0 = purely transactional; 100 = frequent appreciation, care, personal tone",
    "brevity_demand": "0 = tolerates long replies; 100 = repeatedly demands short, simple answers",
    "autonomy_granted": "0 = micromanages each step; 100 = delegates the whole outcome, trusts judgment",
    "pace_pressure": "0 = no time pressure expressed; 100 = constant urgency, deadlines, impatience",
    "structure_tolerance": "0 = rejects process and structure; 100 = asks for plans, checklists, phases",
    "question_vs_statement": "0 = almost only commands and statements; 100 = mostly asks questions",
    "repair_after_friction": "0 = escalates or disengages after a mistake; 100 = resets calmly, re-anchors",
    "vision_vs_execution": "0 = talks only about concrete next steps; 100 = talks mostly about end state and why",
    "energy_markers": "0 = flat, dutiful tone throughout; 100 = visible excitement and animated language",
}
DIMENSIONS = tuple(CODEBOOK)

SYSTEM = (
    "You rate how one person communicates, from a batch of messages they wrote. "
    "Return strict JSON only, shaped as {\"scores\": {<dimension>: integer 0-100, ...}, "
    "\"observations\": [up to 3 strings]}. Score every dimension in the codebook. "
    "Observations are short paraphrases (max 140 characters each) of a recurring behavior, "
    "written in the third person. Never include names of people or companies, email addresses, "
    "or quotes longer than 8 words. Do not describe the topics discussed; describe how the person communicates.\n\n"
    "Codebook:\n" + "\n".join(f"- {k}: {v}" for k, v in CODEBOOK.items())
)


def windows(turns: list[Turn], max_windows: int | None = None) -> list[list[Turn]]:
    """Split into windows of <=40 turns / <=6k chars. With max_windows, sample evenly across the span."""
    out, cur, size = [], [], 0
    for t in turns:
        n = min(len(t.text), TURN_CHARS)
        if cur and (len(cur) >= WINDOW_TURNS or size + n > WINDOW_CHARS):
            out.append(cur)
            cur, size = [], 0
        cur.append(t)
        size += n
    if cur:
        out.append(cur)
    if max_windows and len(out) > max_windows:
        step = len(out) / max_windows
        out = [out[int(i * step)] for i in range(max_windows)]
    return out


def _ollama(messages: list[dict], model: str) -> dict:
    body = {
        "model": model,
        "messages": messages,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_ctx": 12288},
    }
    if model.startswith("qwen3"):
        body["think"] = False
    req = urllib.request.Request(OLLAMA_URL, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            content = json.loads(resp.read())["message"]["content"]
    except urllib.error.URLError as e:
        raise SystemExit(f"Ollama not reachable at {OLLAMA_URL} ({e}). Start it with `ollama serve`.")
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {}


def _claude(messages: list[dict], model: str) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    try:
        msg = client.messages.create(
            model=model,
            max_tokens=2048,
            output_config={"effort": "low"},
            system=messages[0]["content"],
            messages=messages[1:],
        )
    except anthropic.AuthenticationError:
        raise SystemExit("Anthropic did not accept the API key. Update it in the Soul Map settings.")
    except anthropic.APIConnectionError as e:
        raise SystemExit(f"Could not reach Anthropic ({e}).")
    if msg.stop_reason == "refusal":
        return {}
    content = "".join(b.text for b in msg.content if b.type == "text")
    try:
        return json.loads(content[content.find("{"): content.rfind("}") + 1])
    except json.JSONDecodeError:
        return {}


def score_window(win: list[Turn], model: str, engine: str = ENGINE) -> dict:
    text = "\n\n".join(f"[{t.ts or 'no time'}]\n{t.text[:TURN_CHARS]}" for t in win)
    user = f"{len(win)} messages written by the person follow. Rate them.\n\n{text}"
    ask = _claude if engine == "claude" else _ollama
    raw = ask([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], model)
    scores = raw.get("scores") if isinstance(raw.get("scores"), dict) else raw
    clean = {}
    for d in DIMENSIONS:
        v = scores.get(d) if isinstance(scores, dict) else None
        if isinstance(v, (int, float)):
            clean[d] = max(0, min(100, int(round(v))))
    obs = raw.get("observations") if isinstance(raw.get("observations"), list) else []
    return {"scores": clean, "observations": obs[:3]}


def score_source(source: str, turns: list[Turn], tokens: set[str], max_windows: int | None,
                 model: str = MODEL, log=print) -> dict:
    from . import PERSONAL
    engine = ENGINE
    if source in PERSONAL and PERSONAL_ENGINE != "claude":
        engine, model = "local", LOCAL_MODEL
        if not _local_ready():
            log(f"  {source}: kept on this Mac, but the local model is not running; not scored. Install it in Settings, or allow Claude for messages and email.")
            return {"windows": 0, "turns_scored": 0, "model": None, "dimensions": {d: {"mean": None, "stdev": 0.0, "n": 0} for d in DIMENSIONS},
                    "observations": [], "caveats": ["personal source not scored: the local model is not running on this Mac"]}
    wins = windows(turns, max_windows)
    per_dim = {d: [] for d in DIMENSIONS}
    obs_counter: Counter[str] = Counter()
    obs_first: dict[str, str] = {}
    failed = 0
    for i, w in enumerate(wins, 1):
        t0 = time.time()
        res = score_window(w, model, engine)
        if not res["scores"]:
            failed += 1
        for d, v in res["scores"].items():
            per_dim[d].append(v)
        for o in res["observations"]:
            c = clean_observation(o, tokens)
            if c:
                key = "".join(ch for ch in c.lower() if ch.isalnum() or ch == " ")
                obs_counter[key] += 1
                obs_first.setdefault(key, c)
        log(f"  window {i}/{len(wins)}: {len(w)} turns, {time.time() - t0:.0f}s, {len(res['scores'])} dims")
    dims = {}
    for d, vals in per_dim.items():
        dims[d] = {
            "mean": round(statistics.fmean(vals), 1) if vals else None,
            "stdev": round(statistics.stdev(vals), 1) if len(vals) > 1 else 0.0,
            "n": len(vals),
        }
    caveats = []
    span = [t.ts for t in turns if t.ts]
    if span:
        caveats.append(f"turns span {min(span)[:10]} to {max(span)[:10]}")
    if max_windows and len(turns) > sum(len(w) for w in wins):
        caveats.append(f"sampled {len(wins)} windows evenly from {len(turns)} turns; not every turn was read")
    if failed:
        caveats.append(f"{failed} window(s) returned no usable scores from the model")
    if len(wins) < 3:
        caveats.append("fewer than 3 windows; treat stdev and means as rough")
    return {
        "windows": len(wins),
        "turns_scored": sum(len(w) for w in wins),
        "model": model,
        "dimensions": dims,
        "observations": [obs_first[k] for k, _ in obs_counter.most_common(3)],
        "caveats": caveats,
    }
