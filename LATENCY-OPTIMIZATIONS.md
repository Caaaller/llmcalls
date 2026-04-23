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
