# Analysis Log — Running Record of Substantive Q&A

Durable record of analytical/diagnostic responses from this project's
conversations. Append to this file anytime an analysis spans more than
a few sentences and might be lost to session history later. The point
is to not re-do the same investigation twice.

Do NOT add quick factual answers ("what's this file do?") — use this
for: latency analyses, architectural diagnoses, post-mortems, and
decision trade-offs.

---

## 2026-04-23 — Does AI get slower as conversations get longer?

**No — not meaningfully.** Pulled 135 `turn_timing` events from all
streaming-era multi-turn calls, bucketed by turn index within the call:

| Turn idx | n   | Median (ms) | Mean | p90  |
| -------- | --- | ----------- | ---- | ---- |
| 0        | 16  | 2007        | 2228 | 2925 |
| 1        | 16  | 2138        | 2262 | 3041 |
| 2        | 13  | 1919        | 2384 | 3624 |
| 3        | 13  | 2009        | 2237 | 2793 |
| 4        | 11  | 2156        | 2185 | 2641 |
| 5        | 11  | 2225        | 2267 | 2838 |
| 6        | 8   | 2083        | 2073 | 2575 |
| 7        | 6   | 2159        | 2591 | 4457 |
| 8        | 3   | 2462        | 2604 | 3067 |

- **Pearson r = 0.067** (basically zero correlation between turn index and latency)
- **Linear-fit slope: +6ms per additional turn** — negligible

Medians hover 1919-2462ms across all turn positions. `actionHistory`
is capped at 12 turns so prompt size stops growing.

**Why perception might say otherwise:** p90 creeps up on later turns
(2925 → 3067ms), so long calls occasionally have a slow turn that
stands out. Median stays flat.

---

## 2026-04-23 — Why does AI say "press zero" on Best Buy voicebot?

**Diagnosis only — not yet fixed.** Best Buy voice bot shows no DTMF
menu. AI tried escalating with the literal phrase "press zero", which
a voice bot hears as speech and can't act on.

Root cause: prompt has a digit-name-speak fallback for when DTMF
attempts have been rejected. That fallback misfires on voice bots
where DTMF never applies at all.

**Fix plan (MVP, not shipped):**

- **Prompt rule:** "NEVER say 'press [digit]' in a `speak` action. Use
  'representative', 'operator', or 'agent' instead."
- **Regex safety net:** before `telnyxService.speakText`, rewrite
  `/press (zero|one|two|…|\d)/i` to `"representative"` as a fallback
  in case the LLM slips.

Tracked as Known Issue #A in `CHANGES-LOG.md`.

---

## 2026-04-23 — Parallel LLM agent for loop detection: cost?

**Verdict: a deterministic loop detector is better and cheaper than a parallel LLM.**

**LLM watcher cost estimate:** small prompt (~500 input, ~20 output tokens) per turn with Haiku → ≈ $0.0006/turn → ~$0.006 per 10-turn call → ~15% increase over the main call cost.

**Deterministic alternative (zero-cost, more reliable):**

1. Track the last 2-3 normalized IVR transcripts per call.
2. On new `speech_final`, normalize (lowercase, strip punctuation, collapse whitespace).
3. If ≥85% similar (Jaccard or Levenshtein) to a previous one, set `loopDetected=true` at the backend level (OR'd with the LLM's own flag).
4. Our existing `a01d3b6` loop-override then forces a press.

Why deterministic wins: zero cost, faster (~1ms vs ~300ms API roundtrip), unit-testable, catches cases the LLM misses (today's Costco failure).

**Recommended:** deterministic check, not parallel LLM. Not yet shipped.

---

## 2026-04-23 — Is USPS a "wait for human" special test?

**Yes.** USPS fixture (`usps-failed-pickup` in `packages/backend/src/services/liveCallTestCases.ts:128`) has:

- `shouldReachHuman: true`
- `requireConfirmedTransfer: true` ← forces the runner to WAIT for an actual transfer event; early exit on hold is ignored
- `maxDurationSeconds: 600` (10 min)

Fixture description: _"USPS is tricky — the IVR plays a post-call
survey notice ('stay on line at the end of this call') that has
historically false-flagged as hold. `requireConfirmedTransfer` forces
the runner to wait for an actual transfer event rather than exiting
on the first (possibly false) hold signal."_

So USPS timeouts in daytime tests are expected when a human isn't
reached in the 10-min window. Not a regression.

---
