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

**Latest measurement (2026-04-23, Haiku 4.5 + cache_control, 49 turns / 9 live calls):**

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

| #   | What                                                                                           | Commit / date                                | Measured effect                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fire on Deepgram `speech_final` (vs waiting for `UtteranceEnd`)                                | `220990b` 2026-04-07                         | "~2.5-4.4s AI decisions (down from 4-13s)" — measurement pre-dates current instrumentation                                                                        |
| 2   | System prompt trim 5800 → 3100 tokens                                                          | `827a0e0` 2026-04-07                         | Component of the big 2026-04-07 drop                                                                                                                              |
| 3   | Anthropic prompt caching (system prompt cached)                                                | 2026-04-02                                   | Input tokens 6700 → ~1000; latency gain "modest" (~2.5-3.5s still)                                                                                                |
| 4   | Fast-retry cache (skip AI on repeated IVR prompt)                                              | 2026-04-02                                   | "Coverage question replayed instantly (skipped 3s AI call)"                                                                                                       |
| 5   | Endpointing raised back 400ms → 1800ms (revert of earlier experiment)                          | `7c5650f` 2026-04-09                         | Reverted because 400ms caused mid-sentence cutoffs                                                                                                                |
| 6   | `max_tokens` capped at 400                                                                     | 2026-04-07                                   | Part of Phase 1 cluster; net ~+45ms A/B on 628 turns — noise                                                                                                      |
| 7   | Sentence-buffered streaming TTS (flag-gated, default OFF)                                      | `ce0f090` / `3873427` / `d7010a8` 2026-04-22 | First-audio ~500ms faster on multi-sentence responses; zero effect on single-word IVR-nav responses                                                               |
| 8   | Per-turn latency instrumentation (`turn_timing` events in MongoDB)                             | `38ef072` 2026-04-22                         | Observability only; zero perf effect                                                                                                                              |
| 9   | Deepgram endpointing 1800 → 500ms + semantic turn detection (expanded filler/connective lists) | `d80074f` 2026-04-22                         | **Flat.** UtteranceEnd at 1800ms still dominates for continuous IVR speech. Replay 7/9 pass.                                                                      |
| 10  | Fixture re-records after Phase 2 behavior change                                               | same as #9                                   | N/A                                                                                                                                                               |
| 11  | Claude Haiku 4.5 for IVR nav (env-gated via `IVR_LLM_PROVIDER=anthropic` default)              | `b092206` 2026-04-23                         | Replay 7/10 (3 behavioral divergences, all plausibly correct alt paths). No cache: **+82ms median regression**.                                                   |
| 12  | Anthropic prompt caching (`cache_control: ephemeral` on system message)                        | `6c9dccb` 2026-04-23                         | Cache hits confirmed (5458 cached tokens/call). **-30ms median vs Phase 2 anchor** (4464ms vs 4494ms). Marginal win. Mean 4616ms (-150ms). Not the 1000ms target. |

## ❌ Tried & Reverted / Inconclusive

| #   | What                                                           | Date                     | Why it didn't stick                                                                                                                                                                                       |
| --- | -------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Endpointing 1800 → 400ms + 300ms continuation buffer           | 2026-04-09               | "~1.1s saved per turn" on one live call, but historically "caused lots of interruptions." Lives on stale `feat/latency-optimizations`, not merged. Replaced by #9 above.                                  |
| 2   | Aggressive system-prompt compression 3462 → 1014 tokens (~71%) | 2026-04-09/10            | First version made AI silent on greetings/disclaimers. Fix ported, then **fully reverted** on main: "Best Buy 'product or appointment?' now gets answered correctly" after restoring uncompressed prompt. |
| 3   | Streaming TTS enabled by default (`USE_STREAMING=true`)        | 2026-04-22               | Subjectively slower on single-word responses; `await flush()` added per-turn backend overhead. Kept behind flag, default off.                                                                             |
| 4   | Custom `---ACTION---` plain-text protocol (Option 3)           | 2026-04-09               | Fragile — GPT-4o-mini doesn't follow the protocol reliably, loses function-calling validation.                                                                                                            |
| 5   | Two-phase LLM (Phase 1 picks action, Phase 2 speaks)           | 2026-04-09               | Adds ~150-200ms overhead per call. Net negative for short IVR responses.                                                                                                                                  |
| 6   | OpenAI function-calling streaming path (first attempt)         | 2026-04-09               | GPT-4o-mini always picked `press_digit 0` regardless of context. Fixed with enriched tool descriptions, but whole branch stayed unmerged.                                                                 |
| 7   | Claude Haiku 3 for IVR nav                                     | 2026-04-03               | 40% faster (820ms vs 1219ms) but **paraphrases instead of exact words** → quality regression.                                                                                                             |
| 8   | Groq Llama 3.3 70B                                             | 2026-04-03/06            | 1600ms TTFT — marginal. Code wired behind `LLM_PROVIDER=groq` but blocked on API key, never live-tested end-to-end.                                                                                       |
| 9   | Groq Llama 3.3 8B                                              | 2026-04-03/06            | 400ms TTFT — fast, but chose "coverage question" instead of "other insurance" → quality regression.                                                                                                       |
| 10  | Kokoro TTS (vs AWS Polly) — CONFLICTING DATA                   | 2026-04-09 vs 2026-04-22 | One measurement "no difference (~200ms)"; another "60% faster (185-240ms vs 400-700ms)". Currently using Kokoro on main. Needs clean re-measurement.                                                      |
| 11  | Phase 1 A/B test on 628 turns                                  | 2026-04-07               | Mean diff +45ms CI [-203, +293]. "Pure noise. Phase 1 is actually slightly _slower_."                                                                                                                     |

## 🔬 Researched but NOT tried

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
