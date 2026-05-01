# Voice Agent Latency — Living Optimization Log

**⚠️ READ THIS BEFORE PROPOSING A LATENCY OPTIMIZATION.** This file is the
canonical record of what's been tried, what worked, what failed, and what's
queued. Check here first to avoid repeating work. Detailed measurements and
competitor research live in [`LATENCY-RESEARCH.md`](./LATENCY-RESEARCH.md).

---

## 🎯 Current Anchor & Target

**Methodology:** `turn_timing` events are persisted to `callhistories.events[]`
on every live call (added 2026-04-22, commit `38ef072`). Query with:

```js
Call.find({ startTime: {$gte: <cutoff>} }).lean()
  .then(calls => calls.flatMap(c => c.events.filter(e => e.eventType === 'turn_timing')))
```

Each event includes `perceivedMs` (user-stops-speaking → audio-starts-in-ear),
`endpointingMs`, and raw timestamps. Stdout also emits `⏱️ TURN LATENCY …`
lines per turn.

**Realistic anchor (2026-04-22, Phase 2 code, 42 turns / 9 live calls):**

| Metric               | Value      |
| -------------------- | ---------- |
| Mean perceived       | 4767ms     |
| **Median perceived** | **4494ms** |
| p90                  | 5697ms     |

**🎯 TARGET HIT — confirmed across two runs (streaming architecture ACTUALLY on):**

| Metric               | First run (2026-04-23 02:28, n=42) | Fresh run (2026-04-23 11:10, n=64) | Delta vs anchor (4494ms median) |
| -------------------- | ---------------------------------- | ---------------------------------- | ------------------------------- |
| Mean perceived       | 2222ms                             | 2251ms                             | ~-2500ms                        |
| **Median perceived** | **2007ms**                         | **2063ms**                         | **-2431 to -2487ms**            |
| p90                  | 2925ms                             | 2838ms                             | -2772 to -2859ms                |
| endToDispatch median | 994ms                              | ~1000ms                            | -2200ms                         |

Both measurements are in the 2000-2100ms median band — result is reproducible, not a one-run fluke. Daytime vs after-hours had no meaningful effect on the median.

**Phase breakdown (new `turn_timing` sub-fields from commit `c94beec`):**

- TTFT (speechEnd → first LLM token): 774ms
- speechStream (first token → speech field closes): 224ms
- dispatchDelay (speech field closes → TTS fires): **0ms** ← streaming works
- Stream fallback fired: **0/42 (0%)**
- Telnyx pipeline (dispatch → speakStart): ~1013ms

**Critical context:** All measurements between `f3a377d` (2026-04-23 01:15) and this one were against the NON-streaming path because `.env` had `USE_STREAMING=false` from when we temporarily disabled it after the original flush-blocking issue. Setting `USE_STREAMING=true` is what enabled the architectural refactor. The code was correct the whole time; the config was silently disabling it.

**Success criteria:**

- Latency improvement ≥1000ms median: **✅ HIT — 2487ms (2.5× target)**
- Replay divergences ≤10: **✅ HIT — 4 divergences** (Target, Verizon, Walmart, Wells Fargo — same set as pre-streaming, no new regressions)

**Skeptic independent verification (2026-04-22):** Pulled raw `turn_timing` events from MongoDB directly (n=42, 9 calls since 2026-04-23T06:18:00Z). Recomputed: median `perceivedMs` = **2007ms**, mean = **2222ms**, p90 = **2925ms**, min=1565 max=5019 — matches reported numbers exactly. Streaming confirmed active: 72 "Time to first token (streaming)" log lines in agent stdout. 7 of 9 calls produced turn_timings with ≥4 user turns (healthy multi-turn); the 2 excluded calls (0 turn_timings each) correctly ended on `closed_no_menu` before any AI responses with timing — they did not pollute the sample. Transcript spot-checks (USPS, UMR, Costco): AI responded sensibly, no hallucinations, no loops, reasonable terminal events. Sub-timestamp reconstruction (TTFT + speechStream + dispatchDelay) matches `endToDispatch` within 50ms on all 42 turns. **Caveat:** `streamTailMs` median is −9716ms (impossible). Race between fire-and-forget flush and stream completion: `emitTurnTiming` runs at `ttsSpeakStartedAt` while `cs.streamCompleteAt` still holds the prior turn's value (the current turn's stream hasn't finished yet). This is a reporting-only bug in a diagnostic sub-field; it does NOT touch `perceivedMs`, so the headline number is trustworthy. Recommend: fix `streamTailMs` attribution (e.g. attach streamCompleteAt to a turn ID, or drop the field until a per-turn correlation exists). **Verdict: CONFIRMED WIN.**

### Historical (pre-target-hit, non-streaming Haiku+cache, 49 turns / 9 live calls)

| Metric               | Value      | Delta vs anchor        |
| -------------------- | ---------- | ---------------------- |
| Mean perceived       | 4616ms     | -151ms                 |
| **Median perceived** | **4464ms** | **-30ms**              |
| p90                  | 6127ms     | +430ms (p90 got worse) |

**Breakdown (median case):**

- `end→dispatch` ≈ 3200ms — DOMINATED BY LLM CALL
- `dispatch→speakStart` ≈ 900ms (Telnyx server-side TTS pipeline)

**Target:** ≥1000ms improvement → median < 3500ms.

---

## ⚡ How to use this doc

1. Before any latency code change, skim all four checklists below.
2. Shipped to main → add to "✅ Tried & Shipped".
3. Reverted → add to "❌ Tried & Reverted" with the failure reason.
4. Researched only → "🔬 Researched but NOT tried".
5. New idea → "💡 Ideas queue" with estimated win + risk.
6. ALWAYS cite real MongoDB/log measurements. No estimates.

---

## ✅ Tried & Shipped (currently on main)

| #   | What                                                                                           | Commit / date                                | Measured effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fire on Deepgram `speech_final` (vs waiting for `UtteranceEnd`)                                | `220990b` 2026-04-07                         | "~2.5-4.4s AI decisions (down from 4-13s)" — measurement pre-dates current instrumentation                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | System prompt trim 5800 → 3100 tokens                                                          | `827a0e0` 2026-04-07                         | Component of the big 2026-04-07 drop                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | Anthropic prompt caching (system prompt cached)                                                | 2026-04-02                                   | Input tokens 6700 → ~1000; latency gain "modest" (~2.5-3.5s still)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | Fast-retry cache (skip AI on repeated IVR prompt)                                              | 2026-04-02                                   | "Coverage question replayed instantly (skipped 3s AI call)"                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5   | Endpointing raised back 400ms → 1800ms (revert of earlier experiment)                          | `7c5650f` 2026-04-09                         | Reverted because 400ms caused mid-sentence cutoffs                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6   | `max_tokens` capped at 400                                                                     | 2026-04-07                                   | Part of Phase 1 cluster; net ~+45ms A/B on 628 turns — noise                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | Sentence-buffered streaming TTS (flag-gated, default OFF)                                      | `ce0f090` / `3873427` / `d7010a8` 2026-04-22 | First-audio ~500ms faster on multi-sentence responses; zero effect on single-word IVR-nav responses                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8   | Per-turn latency instrumentation (`turn_timing` events in MongoDB)                             | `38ef072` 2026-04-22                         | Observability only; zero perf effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | Deepgram endpointing 1800 → 500ms + semantic turn detection (expanded filler/connective lists) | `d80074f` 2026-04-22                         | **Flat.** UtteranceEnd at 1800ms still dominates for continuous IVR speech. Replay 7/9 pass.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10  | Fixture re-records after Phase 2 behavior change                                               | same as #9                                   | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | Claude Haiku 4.5 for IVR nav (env-gated via `IVR_LLM_PROVIDER=anthropic` default)              | `b092206` 2026-04-23                         | Replay 7/10 (3 behavioral divergences, all plausibly correct alt paths). No cache: **+82ms median regression**.                                                                                                                                                                                                                                                                                                                                                                                     |
| 12  | Anthropic prompt caching (`cache_control: ephemeral` on system message)                        | `6c9dccb` 2026-04-23                         | Cache hits confirmed (5458 cached tokens/call). **-30ms median vs Phase 2 anchor** (4464ms vs 4494ms). Marginal win. Mean 4616ms (-150ms). Not the 1000ms target.                                                                                                                                                                                                                                                                                                                                   |
| 13  | **Streaming TTS default-on + `speech`-first schema + fire-and-forget flush**                   | `f3a377d` 2026-04-23                         | Replay 5/10 divergences (Target, USPS, Verizon, Walmart, Wells Fargo — all plausible alt paths, no crashes). Live measured n=40 turns, ALL calls multi-turn (3-18 user turns): **median 4381ms (-113ms vs anchor), mean 4397ms (-370ms vs 4767ms anchor), p90 5460ms (-237ms)**. Real improvement but **not the 1000ms target** — backend end→dispatch is still LLM-bound (~3200ms). Architecture now matches competitors structurally; next wall is LLM time itself (Groq, speculative execution). |

## ❌ Tried & Reverted / Inconclusive

| #   | What                                                                                                                         | Date                                              | Why it didn't stick                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Endpointing 1800 → 400ms + 300ms continuation buffer                                                                         | 2026-04-09                                        | "~1.1s saved per turn" on one live call, but historically "caused lots of interruptions." Lives on stale `feat/latency-optimizations`, not merged. Replaced by #9 above.                                                                                                                                                                                              |
| 2   | Aggressive system-prompt compression 3462 → 1014 tokens (~71%)                                                               | 2026-04-09/10                                     | First version made AI silent on greetings/disclaimers. Fix ported, then **fully reverted** on main: "Best Buy 'product or appointment?' now gets answered correctly" after restoring uncompressed prompt.                                                                                                                                                             |
| 3   | Streaming TTS enabled by default (`USE_STREAMING=true`)                                                                      | 2026-04-22                                        | Subjectively slower on single-word responses; `await flush()` added per-turn backend overhead. Kept behind flag, default off.                                                                                                                                                                                                                                         |
| 4   | Custom `---ACTION---` plain-text protocol (Option 3)                                                                         | 2026-04-09                                        | Fragile — GPT-4o-mini doesn't follow the protocol reliably, loses function-calling validation.                                                                                                                                                                                                                                                                        |
| 5   | Two-phase LLM (Phase 1 picks action, Phase 2 speaks)                                                                         | 2026-04-09                                        | Adds ~150-200ms overhead per call. Net negative for short IVR responses.                                                                                                                                                                                                                                                                                              |
| 6   | OpenAI function-calling streaming path (first attempt)                                                                       | 2026-04-09                                        | GPT-4o-mini always picked `press_digit 0` regardless of context. Fixed with enriched tool descriptions, but whole branch stayed unmerged.                                                                                                                                                                                                                             |
| 7   | Claude Haiku 3 for IVR nav                                                                                                   | 2026-04-03                                        | 40% faster (820ms vs 1219ms) but **paraphrases instead of exact words** → quality regression.                                                                                                                                                                                                                                                                         |
| 8   | Groq Llama 3.3 70B                                                                                                           | 2026-04-03/06                                     | 1600ms TTFT — marginal. Code wired behind `LLM_PROVIDER=groq` but blocked on API key, never live-tested end-to-end.                                                                                                                                                                                                                                                   |
| 9   | Groq Llama 3.3 8B                                                                                                            | 2026-04-03/06                                     | 400ms TTFT — fast, but chose "coverage question" instead of "other insurance" → quality regression.                                                                                                                                                                                                                                                                   |
| 10  | Kokoro TTS (vs AWS Polly) — CONFLICTING DATA                                                                                 | 2026-04-09 vs 2026-04-22                          | One measurement "no difference (~200ms)"; another "60% faster (185-240ms vs 400-700ms)". Currently using Kokoro on main. Needs clean re-measurement.                                                                                                                                                                                                                  |
| 11  | Phase 1 A/B test on 628 turns                                                                                                | 2026-04-07                                        | Mean diff +45ms CI [-203, +293]. "Pure noise. Phase 1 is actually slightly _slower_."                                                                                                                                                                                                                                                                                 |
| 12  | Aggressive schema-pruning rules (omit `menuOptions` unless isIVRMenu, omit `terminationReason` unless shouldTerminate, etc.) | 2026-04-23                                        | Instructed LLM to OMIT optional fields. Live test looked like a massive win (-1586ms median → 2908ms) but **all 9 calls died after turn 1**: downstream code expects every `detected.*` field present; undefined menuOptions broke speechProcessingService. The 2908ms was only first-turn latency. Reverted the omit-rules, kept only the `reason ≤10 words` clause. |
| 13  | **FALSE POSITIVE measurement — 2908ms median from n=6 first-turn-only samples**                                              | 2026-04-23                                        | Measurement lesson added to "Gotchas" below: always check `conversation/user` + `conversation/ai` event counts per call before trusting a latency number. First-turn-only samples skew ~1500ms lower because they skip continuation-buffer + longer IVR transcripts + mid-call history loading.                                                                       |
| 14  | Simplified brevity rule (`reason` ≤10 words only, no field omission)                                                         | 2026-04-23 `2271e0c` shipped → `6a5e4f8` reverted | Initial "9/10 pass" was misleading (aggressive rules broke calls after turn 1 so fewer turns evaluated). Full-suite replay with simplified rule: **10 divergences across 5 fixtures** (AT&T, Target, USPS, Verizon, Wells Fargo). Claude genuinely makes different decisions when asked for brevity. Reverted.                                                        |

## 🔬 Researched but NOT tried

### Newer research (2026-04-23, research-lead agent)

**🚨 CRITICAL:** Anthropic deprecated **assistant-message prefilling** on Opus 4.6+ (returns 400 on Opus 4.7). If our code relies on prefill to skip preamble, it will break on future model upgrades. Migrate to `output_config.format` / structured outputs. [source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prefill-claudes-response)

**Top-5 ranked by leverage for our stack (Node + Telnyx + Deepgram + Anthropic):**

| Rank | Technique                                                                                                                                                  | Est. win                                                               | Complexity                                                           | Source                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | **Deepgram Flux `eager_eot_threshold=0.4`** — fire LLM on medium-confidence EOT, cancel on `TurnResumed`                                                   | 150-350ms median, 600ms p95                                            | 4-8h — perfect stack fit, Telnyx already has native Flux integration | [Deepgram](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot) · [Telnyx](https://telnyx.com/release-notes/automatic-eager-end-of-turn-deepgram-flux) |
| 2    | **LLM hedging (Sierra pattern)** — fire 2 identical Anthropic calls, take first response, cancel loser                                                     | 200-500ms tail-latency                                                 | 6h, 2x LLM cost on hedged turns only                                 | [Sierra](https://sierra.ai/blog/voice-latency)                                                                                                                     |
| 3    | **Two-model SLM filler pattern** — micro Haiku prompt streams "one moment" instantly while main Haiku generates real response; filler NOT added to context | ~400ms perceived (user hears audio ~1s faster)                         | 8-12h, no new API key needed                                         | [WebRTC.ventures](https://webrtc.ventures/2025/06/reducing-voice-agent-latency-with-parallel-slms-and-llms/)                                                       |
| 4    | **Pre-cached filler audio** — pre-synth Kokoro WAVs for "one moment", "please hold", "transferring", "okay" and use Telnyx `playback_start`                | 100-200ms + eliminates 900ms `dispatch→speakStart` for matched turns   | 4h, works today on our stack                                         | [Vapi](https://vapi.ai/blog/audio-caching-for-latency-reduction)                                                                                                   |
| 5    | **Extended 1h prompt cache + `output_config.format`** — prevents 5-min cache-miss tax on idle calls; also replaces deprecated prefill                      | Up to 85% latency reduction on cached portion; fixes cache-miss spikes | 2h, only cost is 2x cache-write amortised                            | [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)                                                                                  |

**Combined plausible win if all 5 land:** ~700-1200ms off 4380ms median.

**Recommended order:** Flux → audio cache → extended cache + output_config → SLM filler → hedging.

**Not top-5 but noted:**

- **OpenAI Realtime API (GA Aug 2025, SIP support)** — full stack rewrite + vendor migration, out of scope
- **Cartesia Sonic-3** — 40ms time-to-first-audio, could replace Kokoro, needs new API key
- **Hume EVI 3** — 1.2s end-to-end (worse than our target if Flux + hedging land)
- **XML output format** — 14-80% MORE tokens than JSON. Do NOT switch.
- **Deepgram `vad_events`** — for barge-in, not first-turn latency

## Older research

| #   | What                                                       | Source                         | Estimated win                              | Notes                                                                                                      |
| --- | ---------------------------------------------------------- | ------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | Barge-in cancellation (TTS cancel on new Deepgram partial) | 2026-04-22                     | Perception win, not measured latency       | "Only option that reduces dead space" per recent review                                                    |
| 2   | Two-model filler hack (Vapi-style)                         | competitor research 2026-04-09 | 300-800ms perceived                        | Fast SLM speaks "Sure, let me check…" while heavy LLM generates real response. Filler NOT in chat context. |
| 3   | Semantic turn detection trained on transcripts             | ElevenLabs research 2026-04-09 | Unblocks 200-300ms endpointing (~1.5s win) | Needs labeled dataset — we have 700+ labeled turns                                                         |
| 4   | Deepgram Eager End-of-Turn / Flux                          | 2026-04-22                     | Unknown                                    | Blocked on "may not be available via current WebSocket integration"                                        |
| 5   | WebRTC over PSTN                                           | competitor research 2026-04-09 | 150-700ms                                  | Only applies if browser calling is a product direction                                                     |
| 6   | Dynamic LLM routing (multi-endpoint Vapi-style)            | competitor research 2026-04-09 | 1000ms p95                                 | Requires multiple API accounts                                                                             |
| 7   | Incremental JSON field extraction for non-streaming path   | LATENCY-RESEARCH §5b           | 50-200ms                                   | `SpeechFieldExtractor` exists; currently only wired into streaming path                                    |

## 💡 Ideas queue (prioritized)

| Pri | What                                                                                                          | Estimated win                          | Risk                                                                                  | Notes                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 🔥  | **Claude Haiku 4.5 for IVR nav** (env-flag rollback)                                                          | 800-1500ms                             | Replay may diverge (Haiku 3 paraphrased — 4.5 much more capable, but same risk class) | ⏳ Agent `ac17aa04945a01ec0` in flight as of 2026-04-22 23:35                        |
| 🔥  | **Speculative LLM execution** — fire Claude/OpenAI call on Deepgram interim transcripts before `speech_final` | 500-1500ms                             | Medium — partial-transcript handling, cancellation                                    | Orthogonal to model choice. Leverage `interim_results=true` already on Deepgram URL. |
| 🔥  | **OpenAI Realtime API / WebSocket voice-native**                                                              | Could skip STT + TTS API hops entirely | High — architectural rewrite, multi-speaker handling                                  | Not yet considered. Biggest potential win.                                           |
| MED | **Two-model filler hack** — fast SLM says "One moment…" while Haiku/GPT generates real answer                 | 300-800ms perceived                    | Medium — need prompt for filler generation that doesn't pollute context               | Competitor-proven (Vapi/Retell)                                                      |
| MED | **Parallel TTS warm-up** — fire Telnyx `speak` request as soon as first speech token arrives, stream text     | 200-500ms                              | Medium — Telnyx API might not support incremental text streaming                      |                                                                                      |
| MED | **Per-turn dynamic endpointing** — shorter on menus, longer on confirmations                                  | 200-500ms on relevant turns            | Low — state already tracked                                                           | Discussed 2026-04-22, not built                                                      |
| LOW | **JSON schema field reorder** (`speech` first)                                                                | 200-500ms                              | Low                                                                                   | Only helps streaming path, which is off by default                                   |
| LOW | **`max_tokens` 400 → 250**                                                                                    | 50-150ms tail                          | Low                                                                                   | May clip long speak responses                                                        |
| LOW | **Kokoro vs Polly clean re-measure**                                                                          | 0-200ms if confirmed                   | Low                                                                                   | Resolve the conflicting data from history                                            |

## Session history (summary)

| Date       | Focus                                                                                                                   | Outcome                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-02 | Anthropic prompt caching + fast-retry cache                                                                             | Shipped. Modest gains.                                                                                                             |
| 2026-04-03 | Haiku 3 + Groq benchmarks                                                                                               | Both regressed quality. Shelved.                                                                                                   |
| 2026-04-07 | `speech_final` firing + prompt trim + `max_tokens` cap                                                                  | Shipped. A/B showed Phase 1 was ~noise (+45ms CI).                                                                                 |
| 2026-04-09 | Branch `feat/latency-optimizations`: endpointing 400ms, streaming TTS, 71% prompt compression, Kokoro, function calling | Lots shipped to branch, very little merged. Prompt compression fully reverted.                                                     |
| 2026-04-09 | Competitor research (Vapi/Retell/LiveKit/Vocode/Pipecat)                                                                | Formula `TTFT_LLM + TTFA_TTS ≈ 300-500ms` confirmed as industry standard. Our single-call JSON approach is architecturally slower. |
| 2026-04-10 | Staff review of latency branch                                                                                          | Fixed isSpeaking race, parallel speakText, DTMF extraction, Dr.-period regex.                                                      |
| 2026-04-20 | Review against main                                                                                                     | Confirmed streaming TTS never merged.                                                                                              |
| 2026-04-22 | THIS SESSION: Phase 1 + Phase 2 shipped to main, verified, measured                                                     | Flat vs anchor. Revealed LLM is the real bottleneck. Haiku 4.5 swap in flight.                                                     |

---

## Open questions

- **Does Claude Haiku 4.5 preserve exact-word output?** Haiku 3 paraphrased. 4.5 is much more capable but same model family — needs replay validation.
- **Can we actually use Deepgram interim_results for speculative LLM?** Requires solving "what if the final transcript differs from the interim that fired" — cancel + refire? Or ignore minor diffs?
- **Why does Phase 2 A/B match Phase 1 A/B noise pattern?** The 1800→500ms endpointing change theoretically saves 1300ms per turn, but UtteranceEnd fallback at 1800ms erases most of it for continuous IVR speech. Do we need to drop `utterance_end_ms` too? (Would require semantic turn detection to be rock-solid.)
- **Negative `speechStart→end` values in logs.** Bug in Phase 1 instrumentation state tracking. Worth fixing for clean data.

## Measurement gotchas

- Jest `--forceExit` is required on every live/replay jest script. Without it, the process hangs 10-30 min after tests complete, blocking Claude's completion notifications and making it look like tests are "still running." All jest scripts in `packages/backend/package.json` now include `--forceExit`.
- MongoDB `turn_timing` events only exist for calls made after commit `38ef072` (2026-04-22 22:14) AND only when the backend is restarted to pick up the new code. Earlier calls need to be measured via `conversation/user → conversation/ai` event deltas, which only capture backend time (not the endpointing or audio-playback portions).
- My earlier "2428ms anchor" was cherry-picked from fast turns. Realistic whole-test anchor is **4000-4500ms user-perceived**.
- **First-turn latency is ~1500ms lower than full-call median.** If a prompt/code change silently breaks turn 2+ and all calls die after turn 1, the latency measurement will look like a massive win (2908ms instead of 4464ms) when it's actually a catastrophic regression. ALWAYS spot-check `conversation/user + conversation/ai` event counts per call before trusting the number — healthy calls have ≥5 turns each.
- Pipe-truncation of test output: running `pnpm test 2>&1 | tail -15` to a `run_in_background: true` task will truncate jest's detailed failure output to just the crash stack. For replay tests where divergences matter, run without the pipe and read the full output after.

---

## IVR-LLM Benchmark (2026-04-29) — Haiku 4.5 vs GPT-4o-mini vs Gemini 2.0 Flash

Goal: head-to-head replay-suite comparison of three candidate LLMs for the IVR-navigation task. Quality (does the model reproduce the recorded path?) and speed (decision latency, output tokens, cost).

### Setup

- Suite: `pnpm --filter backend test:replay` (strict mode — no live fallback). 17 fixtures.
- Provider switch: `IVR_LLM_PROVIDER=anthropic|openai|gemini`. Identical prompts and JSON schema across providers — same `buildMessages()` / `buildCallActionSchema()`.
- Gemini wired via direct REST calls (no SDK install) — `generateContent` + `streamGenerateContent?alt=sse` against `gemini-2.0-flash`.
- Each provider ran its own pass; logs at `/tmp/llm-bench/{haiku,gpt4omini}.log`.
- One pre-existing malformed fixture (`regression-qatar-post-hold-silence.json`, events-format not turns-format) was set aside for the run — it was already breaking `treeUtils.convertLinearToTree` in any replay invocation. Restored after the bench.

### Update (2026-04-30): Gemini benchmark added

`GOOGLE_API_KEY` rotated to a fresh AI-Studio key (project `941094625696`). Gemini 2.0 Flash on this project hits `free_tier_input_token_count limit: 0` — switched the default to `gemini-2.5-flash`, which works on the same key.

#### Results — Gemini 2.5 Flash on the same 17-fixture replay suite

- Pass rate: **6/17 (35%)** — same as GPT-4o-mini, one short of Haiku
- Mean decision latency: **~2,788ms** (n=8 turns sampled from backend log)
- p50 / p90: **2,762ms / 3,163ms**
- Mean output tokens: **152**
- Mean input tokens: **8,994** (no Anthropic-style cache; Gemini implicit caching was not configured)
- Wallclock: 82s for the full sweep

#### Three-way summary

| Metric              | Haiku 4.5           | GPT-4o-mini      | Gemini 2.5 Flash      |
| ------------------- | ------------------- | ---------------- | --------------------- |
| Pass rate           | 7/17 (41%)          | 6/17 (35%)       | 6/17 (35%)            |
| Mean latency        | 3,436 ms            | 3,695 ms         | **2,788 ms** ← winner |
| p50 / p90           | 3,352 / 4,568 ms    | 3,293 / 4,530 ms | **2,762 / 3,163 ms**  |
| Mean output tokens  | 260                 | 146              | 152                   |
| Cache               | 97% hit (Anthropic) | none             | none                  |
| Cost / 30-turn call | $0.14               | $0.04            | ~$0.05 (estimate)     |

Gemini 2.5 Flash is **~650ms faster** per decision than Haiku and **~900ms faster** than GPT-4o-mini. Quality ties GPT-4o-mini, slightly under Haiku.

#### Recommendation update

Three viable paths now:

1. **Stay on Haiku** — best quality (7/17), latency neutralized by speculative-DTMF + cache. Conservative.
2. **Switch to Gemini 2.5 Flash** — ~650ms decision-latency win. Lose 1 of 17 fixtures vs Haiku (Best Buy is the most likely to flip). Speculative DTMF would need re-validation against Gemini's SSE stream chunking; the regex parser may need tuning. Cost neutral.
3. **Re-record fixtures first.** ~40% pass rate even on the model fixtures were recorded against (Haiku) suggests fixture drift. A clean comparison needs fresh fixtures before claiming any model is "better."

Path 3 is the prerequisite for confidently picking 1 vs 2. Without fresh fixtures we're partially measuring drift, not model quality.

Groq Llama 3.3 70B: still missing — no `GROQ_API_KEY` in tokens.env.

### Results — Haiku 4.5 vs GPT-4o-mini

Per-fixture pass/fail (PASS = the model reproduced the recorded path; FAIL = diverged from recording, not necessarily a _wrong_ call decision):

| Fixture                       | Haiku 4.5 | GPT-4o-mini |
| ----------------------------- | --------- | ----------- |
| AT&T CS                       | PASS      | PASS        |
| Best Buy CS                   | PASS      | FAIL        |
| Costco Warehouse (loop)       | PASS      | PASS        |
| DirecTV CS                    | PASS      | FAIL        |
| Hulu CS                       | PASS      | FAIL        |
| Optimum CS                    | FAIL      | FAIL        |
| Qatar Airways                 | FAIL      | FAIL        |
| Self-call simulator (confirm) | FAIL      | FAIL        |
| Self-call simulator (hold)    | FAIL      | FAIL        |
| T-Mobile CS                   | FAIL      | FAIL        |
| Target CS                     | FAIL      | FAIL        |
| UMR Insurance                 | PASS      | PASS        |
| USPS                          | FAIL      | PASS        |
| Verizon CS                    | FAIL      | PASS        |
| Walmart CS                    | FAIL      | FAIL        |
| Wells Fargo CS                | FAIL      | FAIL        |
| amazon-cs-long                | PASS      | PASS        |
| **Total pass**                | **7/17**  | **6/17**    |

| Metric                   | Haiku 4.5         | GPT-4o-mini    |
| ------------------------ | ----------------- | -------------- |
| Pass rate                | 7/17 (41%)        | 6/17 (35%)     |
| Mean decision latency    | 3,436 ms          | 3,695 ms       |
| p50 latency              | 3,352 ms          | 3,293 ms       |
| p90 latency              | 4,568 ms          | 4,530 ms       |
| Mean billed input tokens | 3,523             | 8,745          |
| Mean cache_read tokens   | 6,036             | 0              |
| Cache hit rate           | 92/95 calls (97%) | 0 (no caching) |
| Mean output tokens       | 260               | 146            |
| Total wallclock          | 342 s             | 299 s          |
| Total API calls          | 95                | 78             |
| Cost / call (estimate)   | $0.0048           | $0.0014        |
| Cost / 30-turn call      | $0.14             | $0.04          |

Cost basis: Haiku 4.5 $1/M input, $5/M output (cache reads cheaper than non-cached input per Anthropic's 90% caching discount). GPT-4o-mini $0.15/M input, $0.60/M output.

### Findings

1. **Latency is essentially a tie.** Haiku 3,436ms vs GPT 3,695ms — within 8%, both above the 1-2s "snappy" bar. Neither model is the speed unlock the project hoped for. The ~3.4s floor is dominated by long generation (260 / 146 output tokens of JSON), not by network or input-side cost.

2. **Haiku output tokens are 78% higher (260 vs 146)** because the recorded prompt encourages verbose `reason` strings and GPT-4o-mini happens to be terser. Output-token count is a proxy for time-to-final-token in streaming — the streaming path's "speech-field-complete" marker would fire earlier on GPT than Haiku, on average. This is the one place GPT might be measurably faster in production despite the slightly worse mean total latency.

3. **GPT-4o-mini is 3.4× cheaper per call** even without prompt caching, because the GPT input rate ($0.15/M) is so low that it absorbs the full uncached prompt cheaper than Haiku's cached prefix.

4. **Both models are at ~40% replay pass rate.** This is the most surprising finding. Even Haiku — the model the fixtures were recorded against — only reproduces 7/17 paths exactly. This means: (a) the recorded fixtures are stale or were captured with a slightly different prompt; (b) temp=0 isn't fully deterministic; (c) some IVR speech genuinely has multiple valid AI responses and the recorded one isn't always the one a fresh decoding picks. **The replay suite as currently constituted is not a clean LLM-quality benchmark** — it's measuring "how closely does this LLM track this recording" and even the recording's source model fails it 60% of the time.

5. **No model dominates qualitatively.** Both pass on the same 5 "easy" fixtures (AT&T, Costco, UMR, amazon-cs-long, plus one each); they disagree on a handful (GPT-only USPS+Verizon, Haiku-only Best Buy/DirecTV/Hulu); they both fail the same 8 hard fixtures.

### Recommendation

**Stay on Haiku 4.5 (do nothing).**

Reasons:

- Pass rate, latency, and qualitative behavior are roughly equivalent.
- Haiku has 97% prompt-cache hit rate already in production — the speculative-DTMF + cached-prefix architecture is built around this; switching to GPT-4o-mini would lose the cache-warm hit (every call re-processes 6,036 prefix tokens).
- The 3.4× per-call cost win for GPT-4o-mini is real but small in absolute terms (~$0.10/call saved). Doesn't justify the regression risk on the 5 fixtures Haiku passes that GPT fails.
- The latency win of either model is nil. If we want sub-2s decisions, the path forward is **prompt slimming + decoupling streaming TTS from JSON completion**, not a model swap.

**What to revisit:**

- Re-record fixtures against current Haiku 4.5 + current prompt before re-running this benchmark. Without fresh recordings, "pass rate" is unreliable.
- Run the Gemini benchmark once a working `GOOGLE_API_KEY` is in place — Flash family is plausibly faster than both tested models on JSON-mode workloads.
- Add `GROQ_API_KEY` to bench Llama 3.3 70B — Groq's hardware-level latency advantage could finally break the 3-second floor if quality holds.

### Reproducing this bench

```bash
# Each provider runs against the same fixtures:
IVR_LLM_PROVIDER=anthropic pnpm --filter backend test:replay > /tmp/llm-bench/haiku.log 2>&1
IVR_LLM_PROVIDER=openai    pnpm --filter backend test:replay > /tmp/llm-bench/gpt4omini.log 2>&1
IVR_LLM_PROVIDER=gemini    pnpm --filter backend test:replay > /tmp/llm-bench/gemini.log 2>&1  # needs working GOOGLE_API_KEY

# Then aggregate:
node /tmp/llm-bench/parse.js
```

---

## Fresh-Fixture Benchmark (2026-04-30) — Haiku baseline + Gemini blocked

Re-recorded 5 stale fixtures against current Haiku to establish a fresh ground-truth set, then ran replay-mode benchmarks against `IVR_LLM_PROVIDER=anthropic` (Haiku 4.5) and `IVR_LLM_PROVIDER=gemini` (Gemini 2.5 Flash) with parity-tuned configs (temperature=0, maxOutputTokens=800, JSON response mode, separate systemInstruction).

### Setup parity (Haiku vs Gemini)

| Setting                   | Haiku (anthropic)                  | Gemini 2.5 Flash                     | Notes                                                                                                                   |
| ------------------------- | ---------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| temperature               | 0                                  | 0                                    | identical                                                                                                               |
| max output tokens         | 800                                | 800                                  | identical                                                                                                               |
| system prompt placement   | `system` array                     | `systemInstruction`                  | semantically equivalent                                                                                                 |
| response format           | text+JSON parse                    | `responseMimeType: application/json` | Gemini stricter; both emit valid JSON                                                                                   |
| caching                   | explicit `ephemeral` cache_control | implicit (5-min prefix matching)     | Haiku confirmed hitting (cache_read avg 5001 tok). Gemini caching not observable in this bench (zero successful calls). |
| stop / format constraints | none                               | none                                 | identical                                                                                                               |

### Haiku results (n=86 successful API calls across 17 fixtures)

| Metric             | Value          |
| ------------------ | -------------- |
| Replay pass rate   | 5/17 (29%)     |
| Mean latency       | 3279 ms        |
| p50 latency        | 2972 ms        |
| p90 latency        | 4175 ms        |
| Min / max          | 2160 / 6835 ms |
| Mean input tokens  | 3489           |
| Mean output tokens | 256            |
| Mean cache_read    | 5001 tokens    |
| Mean cache_write   | 1233 tokens    |

**Headline:** even with same-day fresh fixtures, Haiku-vs-Haiku replay only reproduces 5/17 paths exactly. Replay divergences are dominated by mid-sentence "wait vs speak" disagreements on incomplete IVR speech ("Monday through-", "5-bit ZIP code for the-") and ambiguous "Are you still there?" line-checks where the model legitimately has two valid options. Pass-rate as a quality signal is noisy on this fixture set.

### Update (2026-04-30, billing enabled + thinking disabled): Gemini 2.5 Flash wins decisively

Billing was enabled on the GCP project tied to `GOOGLE_API_KEY`. Initial Gemini bench showed parse errors on prompt-eval edge cases (3 cases returned truncated JSON). Root caused to **Gemini 2.5 Flash's thinking mode consuming the maxOutputTokens budget** — added `thinkingConfig: { thinkingBudget: 0 }` to both streaming and non-streaming Gemini calls. Reran. Result: parse errors gone AND latency dropped further.

| Metric                   | Haiku 4.5     | Gemini (thinking ON) | **Gemini (thinking OFF) ✅** |
| ------------------------ | ------------- | -------------------- | ---------------------------- |
| Replay p50               | 2,977ms       | 1,954ms              | **1,516ms** (−49% vs Haiku)  |
| Replay mean              | 3,279ms       | 2,240ms              | **1,538ms**                  |
| Replay p90               | 4,340ms       | 3,105ms              | **1,769ms** (−59% vs Haiku)  |
| Replay min/max           | 2,160 / 6,835 | 1,416 / 5,008        | **1,207 / 2,587**            |
| Replay PASS (n=17)       | 5             | 7                    | **7**                        |
| Prompt-eval PASS (n=111) | 104           | 102 (3 parse errors) | **104** (zero parse errors)  |

**Per-call savings:** ~1.5s × ~6 turns = **~9 seconds shaved off time-to-human**.

**"Half a second is significant" — answered:** Gemini-no-thinking is ~1.5s faster than Haiku at p50 (3× the user's significance threshold). The p90 win is even bigger (~2.6s).

**Recommendation:** Switch the production default to `IVR_LLM_PROVIDER=gemini`. One remaining validation step: speculative-DTMF regex was tuned against Haiku's streaming chunking; recommend a short live A/B (3-5 calls) before flipping `.env` default. PR #57 ships the thinking-disabled Gemini provider as a working option without flipping the default.

### Gemini results (initial run) — BLOCKED by free-tier quota

The configured `GOOGLE_API_KEY` is on the **free tier** (`generate_content_free_tier_requests`, limit: 5 RPM, model: gemini-2.5-flash). With 17 fixtures × multiple turns, even with serial replay (`REPLAY_EVAL_CONCURRENCY=1`) and 3-attempt 429-backoff that honors Google's `Please retry in Xs.` directive, every request was 429-rate-limited and exhausted retries. Wallclock burned: 45 min, successful API calls: 0, fixture pass rate: 0/17.

This means we have **no usable Gemini latency, token, or quality data** from this run. The earlier three-way bench in PR #54 captured a few Gemini calls before quota exhaustion, but those were against stale fixtures, mid-roll quota tier, and against the unstreamed Gemini path — not directly comparable to the current Haiku numbers above.

**Code change shipped this branch:** added 429-aware retry with backoff to both `callGeminiNonStreaming` and `streamGemini` (parses Google's `Please retry in Xs.` hint, retries up to 3×, surfaces error after exhaustion). This is good production hygiene regardless of bench outcome — under load Gemini could throttle prod calls and silently fail without it.

### Cost model (per 30-turn call, list rates as of 2026-04)

Using per-turn averages observed for Haiku and conservative estimates for Gemini 2.5 Flash list pricing:

| Provider                 | Input rate $/M | Cached rate $/M | Output rate $/M | Per-turn cost (in/out/cache)                                                                       | 30-turn call cost |
| ------------------------ | -------------- | --------------- | --------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| Haiku 4.5                | 0.80           | 0.08            | 4.00            | (3489-5001 cached)·0.80/M + 5001·0.08/M + 256·4.00/M ≈ $0.0027/turn                                | **~$0.082/call**  |
| Gemini 2.5 Flash (≤200K) | 0.30           | 0.075           | 2.50            | assume similar prompt size, 50% cache hit: 3489·(0.5·0.30+0.5·0.075)/M + 256·2.50/M ≈ $0.0013/turn | **~$0.039/call**  |

Gemini list-rate cost would be roughly **half** Haiku's per call IF a real benchmark confirms parity input/output sizes and cache behavior. Cannot validate without a paid-tier key.

### Recommendation

**STAY ON HAIKU until a paid-tier `GOOGLE_API_KEY` is provisioned.** No quality, latency, or real-world cost claim about Gemini 2.5 Flash for this workload can be defended from this run. Specifically:

1. The user's question "how much worse is Gemini" cannot be answered — we have zero Gemini decisions on the fresh fixtures.
2. The user's question "is Gemini half-a-second faster" cannot be answered — we have zero Gemini latency samples.
3. The user's cost concern is plausibly addressed by Gemini's lower list rates, but only if quality holds.

**To unblock**: enable billing on the GCP project tied to this `GOOGLE_API_KEY` (or provision a fresh paid-tier key). Free tier is unusable for any benchmark of this size. Once unblocked:

```bash
git checkout bench/fresh-fixtures-haiku-vs-gemini
REPLAY_EVAL_CONCURRENCY=1 TEST_MODE=replay IVR_LLM_PROVIDER=gemini \
  pnpm --filter backend exec jest --runInBand --forceExit \
  --testPathPatterns=replayCallEval 2>&1 | tee /tmp/bench-gemini-fresh.log
```

This branch already contains the 429-retry hardening, so a paid key with normal rate limits will replay all 17 fixtures end-to-end without intervention.

### What else changed on this branch

- 5 fixtures re-recorded fresh against current Haiku 4.5: `att-cs`, `bestbuy-cs`, `directv-cs`, `hulu-cs`, `loop-test-720`.
- 12 other fixtures already had fresh recordings from earlier today (kept as-is to conserve cost).
- `callGeminiNonStreaming` and `streamGemini` now retry 3× on 429, honoring Google's `retry in Xs.` hint.

### Cost / wallclock summary

| Step                                                       | Cost                     | Wallclock |
| ---------------------------------------------------------- | ------------------------ | --------- |
| Re-record 5 stale fixtures (Telnyx live calls + Haiku LLM) | ~$0.50                   | 5 min     |
| Haiku replay bench                                         | ~$0.30 LLM               | 1 min     |
| Gemini replay bench (failed at rate limit)                 | $0 (no successful calls) | 50 min    |
| **Total**                                                  | **~$0.80**               | **~1h**   |

Well under the $10 / 4h caps. Stopped early because the Gemini rate-limit blocker is structural — additional retries would not have changed the outcome.
