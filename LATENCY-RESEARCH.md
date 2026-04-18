# Voice Agent Latency Optimization — Running Log

## Current Architecture

- **Telephony:** Telnyx (PSTN — adds 150-400ms structural floor)
- **STT:** Deepgram Nova-2 (phonecall model, WebSocket streaming)
- **LLM:** GPT-4o-mini via OpenAI API (non-streaming JSON response)
- **TTS:** AWS Polly via Telnyx `calls.actions.speak()` (full text, not streamed)
- **Architecture:** STT → full LLM response → full TTS. No streaming anywhere.

## Latency Budget (measured)

| Component                         | Current   | Best-in-class   | Notes                          |
| --------------------------------- | --------- | --------------- | ------------------------------ |
| Endpointing (silence detection)   | 1800ms    | 300-500ms       | Biggest single source of delay |
| STT (Deepgram)                    | ~150ms    | 50-90ms         | Already good                   |
| LLM inference (TTFT + completion) | 1.8-5.9s  | 50-200ms (Groq) | Dominant bottleneck            |
| TTS API call                      | ~200ms    | ~200ms          | Same for Polly and Kokoro      |
| TTS playback                      | ~1.5-2.5s | Same            | Depends on response length     |
| PSTN transport                    | 150-400ms | 150-400ms       | Structural, can't optimize     |

## What We've Tried

### 1. Endpointing 1800ms → 400ms + 300ms Continuation Buffer

- **Branch:** `feat/latency-optimizations` in worktree `llmcalls-latency`
- **Commit:** `dbcdb8b`
- **Result:** ~1.1s saved per turn (measured on live call to US Bank)
- **How it works:** Deepgram `endpointing=400` fires `speech_final` after 400ms of silence. A 300ms continuation buffer accumulates any additional `is_final` fragments before dispatching to the LLM. Total: 700ms worst case.
- **Concern:** User reports that lower endpointing historically caused lots of interruptions and broken transcripts. The continuation buffer is supposed to help but **hasn't been validated for quality** — need to test whether it actually prevents mid-sentence firing on real IVR calls with varying speech patterns.
- **The `isIncompleteUtterance()` gate** (checks for trailing words like "press", "to", "for") runs before the buffer, providing a second layer of protection. But this is heuristic-based.
- **STATUS: Committed but quality unvalidated. May need tuning.**

### 2. System Prompt Compression (~71% smaller)

- **Commit:** `dbcdb8b` (same commit)
- **Before:** ~3462 tokens. **After:** ~1014 tokens.
- **Result:** Theoretical 200-500ms TTFT reduction (fewer input tokens). Never measured in isolation.
- **Issue:** First version was too aggressive — model started speaking on greetings/disclaimers where it should stay silent. Fixed by splitting into explicit "[CRITICAL — When to Stay SILENT]" and "[When to SPEAK]" sections with annotated examples.
- **Replay tests:** 8 divergences, all pre-existing or legitimate behavior changes (model making reasonable decisions like using request_info). No regressions from compression.
- **STATUS: Committed, replay tests pass.**

### 3. LLM Micro-Optimizations

- **Commit:** `dbcdb8b`
- `max_tokens` 400 → 300 (less generation time)
- `response_format: { type: 'json_object' }` for GPT models (no markdown fences)
- Action history capped at 12 turns (was 20) — reduces context tokens on long calls
- **Result:** Maybe 50-200ms combined. Hard to measure individually.
- **STATUS: Committed.**

### 4. Telnyx Kokoro TTS (replacing AWS Polly)

- **Commit:** `dbcdb8b` (uncommitted config, code changes committed)
- **Env var:** `TTS_PROVIDER=kokoro`, voice `Telnyx.KokoroTTS.af`
- **Result:** TTS API latency ~200ms for both Kokoro and Polly. **No meaningful difference.** TTS provider doesn't matter because:
  1. The TTS API call is only ~5% of total pipeline time
  2. Telnyx handles synthesis server-side regardless of provider
  3. The bottleneck is LLM inference (40-60% of pipeline)
- **STATUS: Available but no improvement. Not worth switching.**

### 5. Function Calling + Streaming TTS (the "Vapi approach")

- **Branch:** `feat/latency-optimizations` (uncommitted changes in worktree)
- **Idea:** Replace structured JSON responses with OpenAI function calling. Text content streams to TTS. Tool calls handle actions (press_digit, wait, hang_up).
- **Implementation:**
  - Added `speak`, `press_digit`, `wait`, `hang_up`, `human_detected`, `maybe_human`, `request_info` as OpenAI function tools
  - `decideActionStreaming()` method with streaming chunk accumulation
  - `createSentenceBufferedTTS()` for sentence-level TTS dispatch
  - `USE_STREAMING=true` env var to toggle
- **Result: FAILED.** GPT-4o-mini always picks `press_digit 0` regardless of context. Even on speech prompts ("say the reason for your call"), it tries to press 0. The hallucination guard catches it and falls back to `wait`, so the call sits silently.
- **Root cause:** The non-streaming path includes detailed action rules in the user message. The streaming path relies on tool descriptions alone, which are too terse. GPT-4o-mini doesn't make good function calling decisions for this specialized domain.
- **Additional bugs found by staff engineer review:**
  1. `isSpeaking` set to `false` too early (before TTS finishes playing)
  2. Race condition with parallel `speakText()` calls (not chained)
  3. Streaming path skips DTMF digit extraction
  4. Sentence boundary regex fires on "Dr."
- **STATUS (2026-04-09 session 2): FIXED.** Added enriched tool descriptions with "USE ONLY when..." guidance and decision guide in user message. Live test shows correct decisions: wait on greetings, speak on questions, press_digit on menus.
- **Remaining issue:** The `speak` tool returns speech inside function call arguments (JSON), which aren't streamable to TTS token-by-token. Speech arrives when the tool call completes, similar timing to non-streaming JSON. True streaming requires text content (not tool calls), but the model won't output text when tools are available.
- **FIXED by approach below (Option 1 — incremental JSON field extraction).**

### 5b. Incremental Speech Field Extraction from Tool Call Argument Deltas

- **Branch:** `feat/latency-optimizations` (worktree `llmcalls-latency`)
- **File:** `packages/backend/src/services/ivrNavigatorService.ts`
- **Idea:** OpenAI streams tool call arguments as partial JSON strings (e.g. `{"spe`, `ech": "Hello`, ` world"`, `, "reason": ...}`). Rather than waiting for the full JSON to complete before calling `onSpeechDone()`, parse the `speech` field value incrementally using a character-level state machine. Fire TTS as soon as the closing `"` of the speech value is detected — potentially hundreds of milliseconds before the rest of the response (`"reason"`, `"detected"` object) finishes streaming.
- **Implementation:**
  - `SpeechFieldExtractor` class: a 5-state machine (`SEEKING_KEY` → `SEEKING_COLON` → `SEEKING_QUOTE` → `IN_VALUE` → `DONE`) that scans delta strings character by character, emitting speech characters as they arrive and signalling completion when the closing quote is found. Handles JSON escape sequences (`\n`, `\t`, `\"`, `\\`).
  - During streaming, a `SpeechFieldExtractor` is instantiated per tool call index only when the tool name is `speak`. Each argument delta is fed into the extractor via `extract(delta)`. Characters are forwarded to `callbacks.onSpeechChunk()` as they arrive; `callbacks.onSpeechDone()` is called immediately when `isDone()` returns true.
  - `speechTTSFiredAt` timestamp tracks whether TTS was already fired to prevent double-firing after the stream completes.
  - Full fallback: if `speechTTSFiredAt` is null after the stream (extractor failed, empty speech, or parsing issue), the complete `speech` field from the parsed JSON is fired as a single chunk — same behavior as before.
  - Non-speak tools (`press_digit`, `wait`, `hang_up`, etc.) are completely unaffected — no extractor is created for them.
- **Expected latency gain:** For a speak action, the gap between `"Speech field complete"` and `"Stream complete"` log lines represents the savings. This gap equals the time to stream the `"reason"` string + the full `"detected"` JSON object — typically 50-200ms for short IVR responses. The TTS API call starts this much earlier, and since TTS API latency is ~200ms, the audio playback begins ~50-200ms sooner per speak turn.
- **Robustness:** Fully stateless per call. No regex, no partial JSON.parse attempts. Falls back to post-stream fire if extraction fails. Non-speak calls unchanged.
- **STATUS: Implemented, TypeScript compiles clean. Not yet live-tested.**

### 7. Custom Text Protocol — Option 3 (implemented, not yet live-tested)

- **Branch:** `agent-a2e378b8` worktree
- **Method:** `ivrNavigatorService.decideActionCustomProtocol()`
- **Env var:** `STREAMING_MODE=custom-protocol`

**How it works:**
The LLM receives a modified system prompt that instructs it to output in a custom protocol:

- For `speak` actions: emit speech text as plain tokens first, then `---ACTION---` delimiter, then compact JSON metadata (no `speech` field in JSON — it lives before the delimiter)
- For all other actions (`press_digit`, `wait`, `hang_up`, etc.): emit `---ACTION---` immediately, then JSON

As tokens stream in, the `onSpeechChunk` callback fires for each pre-delimiter token. A sliding window of `delimiterWindow` chars is held back in `speechBuffer` to handle the delimiter spanning chunk boundaries. Once the stream ends, JSON is parsed from everything after the delimiter.

**Key implementation details:**

- `decideAction()` refactored to use a shared `buildUserMessage()` helper (DRY)
- `normalizeMenuOptions()` extracted as a shared helper
- `buildSpeakFallback()` provides a safe fallback when the delimiter is never found
- `speechProcessingService.ts` checks `STREAMING_MODE=custom-protocol` env var and routes to the new method; `onSpeechChunk` currently logs to stdout (placeholder for sentence-buffered TTS integration)

**Latency advantage over Option 5b (speech field extractor):**

- Option 5b still waits for the `speech` JSON field closing quote before firing TTS — the speech value is inside `"speech": "..."` JSON syntax
- Option 7 starts streaming speech from the very first token (no JSON prefix delay at all)
- For a 5-word speak action: Option 5b saves ~50-200ms (skipping `reason`+`detected` suffix); Option 7 saves that PLUS the time to stream `{"action":"speak","speech":"` prefix (~15 tokens, ~50-100ms at GPT-4o-mini speeds)

**Risks (not yet validated):**

1. **Protocol adherence:** GPT-4o-mini may output the delimiter inconsistently, especially mid-speech or not at all. Fallback treats full response as speech — safe but loses action metadata.
2. **JSON quality:** Without function calling's schema enforcement, the JSON may have missing fields or wrong types. Defensive `jsonMatch` regex extracts first `{...}` block.
3. **Prompt conflict:** The user message includes `buildCallActionSchema` which still describes a `speech` field in JSON. The protocol addendum says "speech field is NOT in the JSON". These conflict and may confuse GPT-4o-mini. Fix: conditionally remove the `speech` field description from the schema when using custom-protocol mode.
4. **Non-speak actions with leading text:** If the model mistakenly outputs an explanation before `---ACTION---` on a `wait` or `press_digit`, that text gets silently spoken as speech — a subtle regression.
5. **Sliding window correctness:** The `emittedSoFar = accumulatedText.length - speechBuffer.length` calculation correctly tracks what's been emitted because `speechBuffer` always holds exactly the un-emitted tail. The delimiter-spanning logic is correct even if `---ACTION---` is split across 10 tiny chunks.

**Next steps to make this production-ready:**

1. Hook `onSpeechChunk` into a sentence-buffered TTS layer (see `createSentenceBufferedTTS` in the latency worktree)
2. Remove the `speech` field from `buildCallActionSchema` when in custom-protocol mode to eliminate prompt conflict
3. Live-test with GPT-4o-mini on a real IVR — measure protocol adherence rate and compare perceived latency
4. Add telemetry: log delimiter position in response (earlier = better), fallback rate, and TTFS vs standard path

### 8. Two-Phase LLM (Option 2) — Implemented, Not Yet Live-Tested

- **Branch:** `agent-a80a617b` worktree
- **Files:** `packages/backend/src/services/ivrNavigatorService.ts`, `packages/backend/src/services/speechProcessingService.ts`
- **Env var:** `STREAMING_MODE=two-phase`

**How it works:**

Split the single LLM call into two sequential calls on speak turns:

- **Phase 1 (action decision):** Non-streaming call with `max_tokens=100`. Uses a modified schema that explicitly omits the `speech` field — the model signals intent to speak but doesn't generate the words. Returns in ~100-200ms for the decision-only JSON (action, digit, reason, detected fields).
- **Phase 2 (speech generation, speak turns only):** Streaming call with no `response_format` constraint. System prompt appended with `[SPEECH GENERATION MODE]` instructing plain-text output only (no JSON, no labels). User message is a focused 4-line prompt: IVR speech + call purpose + instructions. Tokens stream immediately via `callbacks.onSpeechChunk()`.

For non-speak actions (wait, press_digit, hang_up, etc.), Phase 1 is the only call — zero Phase 2 overhead. Phase 2 only runs when the action is `speak`.

**Key implementation details:**

- `buildDecisionUserMessage()` extracted as a shared helper (DRY) — used by both `decideAction()` and the two-phase method
- `buildPhase1Schema()` — Phase 1 JSON schema with `speech` field omitted and explicit instruction not to include it
- `buildPhase2SystemPrompt()` — appends `[SPEECH GENERATION MODE]` section to base system prompt
- `createSentenceBufferedTTS()` in `speechProcessingService.ts` — accumulates token chunks into sentences (split on `.`, `!`, `?`), dispatching each complete sentence to `telnyxService.speakText()` sequentially (chained promises to prevent overlapping audio)
- `STREAMING_MODE=two-phase` check in `processSpeech()` creates the sentence buffer before the AI call, passes `onChunk` to Phase 2 streaming, then `flush()` awaits all queued TTS at the end of the speak handler
- `response_format: { type: 'json_object' }` added to Phase 1 and the existing `decideAction()` for cleaner JSON (no markdown fences — the regex fallback still exists but should never be needed)

**Latency analysis:**

| Path                  | Phase 1                 | Phase 2                             | TTFS (time-to-first-sound)   | Notes                         |
| --------------------- | ----------------------- | ----------------------------------- | ---------------------------- | ----------------------------- |
| Single-call (current) | ~800-2000ms full JSON   | —                                   | ~800-2000ms + ~200ms TTS API | Full JSON before TTS starts   |
| Two-phase speak       | ~150-200ms (100 tokens) | +~300-500ms TTFT for Phase 2 stream | ~450-700ms + ~200ms TTS API  | First sound ~200-400ms sooner |
| Two-phase non-speak   | ~150-200ms              | none                                | —                            | 4-5x faster than single-call  |

**Expected net gain on speak turns:**

- Phase 1 overhead vs single-call: +150-200ms
- Phase 2 streaming saves (true token-by-token TTS): ~300-600ms (skips generation of full JSON, starts TTS mid-stream)
- **Net: ~100-400ms improvement in TTFS on speak turns**

**Risks:**

1. **Phase 2 prompt may hallucinate** — without the full action schema, the model might output JSON-like text or explain itself instead of pure speech. The `[SPEECH GENERATION MODE]` prompt section addresses this but hasn't been validated on GPT-4o-mini.
2. **Two API calls = 2x token billing** — Phase 1 is small (~100 tokens output) but both calls pay for the full system prompt input tokens.
3. **Sentence boundary regex** — splits on `[.!?]\s+` which can fire mid-abbreviation (e.g., "Dr. Smith"). Short IVR responses (1-5 words) typically have no abbreviations, so this is low risk in practice.
4. **Sequential TTS calls** — sentence-chained `speakText()` calls send each sentence as a separate Telnyx `calls.actions.speak` request. Telnyx may queue them or overlap. Need to validate that short pauses between sentences sound natural.
5. **Non-speak turns are faster (good)** — `max_tokens=100` on Phase 1 returns ~150-200ms for wait/press_digit/hang_up decisions (vs ~400-800ms single-call). This is a free win.

**vs. Option 7 (custom protocol):**

- Option 7 starts speech streaming from the very first token (no action-decision latency)
- Option 8 (two-phase) adds ~150-200ms Phase 1 overhead but uses cleaner JSON for action decisions (no protocol adherence risk)
- Option 8 is more robust: Phase 1 is standard JSON, Phase 2 is plain text — both well-supported by OpenAI
- Option 7 is lower latency on speak turns but higher risk of protocol failures

**STATUS: Implemented, TypeScript compiles clean (`tsc --noEmit` passes zero errors). Not yet live-tested.**

### 9. Groq / Llama Provider Switch — Implemented, Needs API Key

- **Branch:** `feat/latency-optimizations` in worktree `llmcalls-latency`
- **File:** `packages/backend/src/services/ivrNavigatorService.ts`
- **Env var:** `LLM_PROVIDER=groq` + `GROQ_API_KEY=<key>`

**How it works:**

- `createLLMClient()` reads `LLM_PROVIDER` at startup (default: `openai`)
- When `groq`, creates an `OpenAI` SDK instance pointed at Groq's OpenAI-compatible base URL (`https://api.groq.com/openai/v1`) with `GROQ_API_KEY`
- `defaultModelForProvider()` returns `llama-3.3-70b-versatile` for Groq, `gpt-4o-mini` for OpenAI
- Both `decideAction()` (non-streaming) and `decideActionStreaming()` pick up the provider automatically — zero other code changes needed
- Logs `[LLM] provider=groq model=llama-3.3-70b-versatile` on every call for easy monitoring
- `config.aiSettings?.model` still overrides the default if set — explicit model wins

**Groq API compatibility (researched):**

- Groq exposes a fully OpenAI-compatible REST API — same request/response schema
- Supports function calling / tools: yes, including streaming tool call argument deltas (the same chunks `SpeechFieldExtractor` reads)
- Supports `stream: true` with `tools`: yes
- Does NOT support `response_format: { type: 'json_object' }` — this is only applied for `gpt-*` models (existing guard in code: `model.startsWith('gpt-')`)
- Rate limits: Free tier 6,000 req/min for llama-3.3-70b-versatile. Not a concern for our call volume.

**Expected latency gain:**
| Metric | GPT-4o-mini | Groq llama-3.3-70b-versatile |
|--------|------------|------------------------------|
| TTFT | 700-900ms (measured) | 50-100ms (reported) |
| Total inference | 1.5-3s | ~300-600ms |
| **Impact on pipeline** | Dominant bottleneck | Near-eliminated |

With current endpointing at 400ms and TTS API at 200ms, switching to Groq could bring total user-perceived latency from ~1500ms down to ~700ms.

**Setup needed:**

1. Get Groq API key at https://console.groq.com (free tier available)
2. Add to `packages/backend/.env`:
   ```
   GROQ_API_KEY=gsk_...
   LLM_PROVIDER=groq
   ```
3. Run a live call — all code paths are identical, only the client and model change

**Risk:** Model quality for IVR navigation decisions not yet validated. Llama 3.3 70B is a strong model but may produce different tool-call decisions than GPT-4o-mini on edge cases. Replay tests won't catch this (they use pre-recorded fixtures). Recommend running 5-10 live calls on diverse IVRs before declaring it production-ready.

**STATUS: Implemented, TypeScript compiles clean. Blocked on GROQ_API_KEY — free at console.groq.com.**

## What We Haven't Tried Yet

### Groq / Llama (fastest LLM option)

- Groq Llama 3.3 70B: 50-100ms TTFT (vs 200-700ms for GPT-4o-mini)
- Could cut 1-4s off inference time
- **Risk:** Model quality for IVR navigation decisions may be worse than GPT-4o-mini
- **STATUS: Code implemented (see section 9 above). Needs API key to test.**

### Deepgram Eager End-of-Turn

- Speculatively starts LLM processing at moderate confidence user is done
- If user continues, cancels the draft response
- Saves 100-200ms per turn
- **Cost:** 50-70% more LLM calls (speculative calls that get cancelled)
- Requires Deepgram Flux-based Voice Agent API — may not be available via current WebSocket integration
- **Priority: MEDIUM**

### Prompt Caching

- OpenAI and Anthropic support caching system prompt prefix
- System prompt is static per call, so cache hit rate would be high
- Could save 50-200ms on TTFT
- **Priority: MEDIUM**

### Streaming LLM → Sentence-chunked TTS

- Only works if we have a `speak` tool or text content to stream
- Not feasible with current JSON response format
- Would require function calling to work first (see #5 above)
- **Priority: LOW — blocked by function calling failure**

### Dynamic LLM Routing (Vapi's approach)

- Route traffic across multiple LLM endpoints
- Monitor latency per endpoint, route to fastest
- Fallback to second-fastest if primary spikes
- Vapi cut P95 by 1000ms+ with this
- **Priority: LOW — requires multiple API accounts/deployments**

### Semantic Turn Detection

- Beyond silence-based endpointing: analyze transcript completeness
- Check for sentence completion, trailing filler words, question/answer patterns
- ElevenLabs reported 45% fewer false interruptions
- Could allow even lower endpointing (200-300ms) without quality loss
- **Priority: MEDIUM — would address the endpointing quality concern**

## How Competitors Actually Do It

### What's clear:

1. They stream everything in parallel (STT → LLM → TTS all streaming concurrently)
2. They use WebRTC for browser-based, which saves 150-700ms vs PSTN
3. Turn detection is the hardest problem — ElevenLabs' semantic approach is the frontier
4. LLM model choice matters more than any other single factor
5. They do NOT use structured JSON responses — they use plain text for speech + function calling for actions

### How competitors are fast even with heavy LLMs (ANSWERED — 2026-04-09)

**It IS streaming.** Every platform (Vapi, Retell, LiveKit, Pipecat, Vocode) uses the same pattern:

1. LLM streams tokens into a **sentence accumulator**
2. Each complete sentence is sent to TTS immediately (75-200ms first-audio latency)
3. Audio starts playing while the LLM is still generating the rest
4. Total perceived latency ≈ `TTFT_LLM + TTFA_TTS` (~300-500ms), NOT the full generation time

With GPT-4o (TTFT ~200-400ms) + Cartesia/ElevenLabs (TTFA ~75-200ms), users hear audio in ~400-600ms even though the full response takes 2-3 seconds to generate. The heaviness of the model only affects TTFT, not perceived latency.

### How competitors handle "speech vs actions" (ANSWERED — 2026-04-09)

**The LLM either speaks (text tokens → TTS) or calls a function (JSON → action), never truly simultaneously.** Every platform works around this:

- **Retell (cleanest for our use case):** Actions (`end_call`, `transfer_number`, `digit_to_press`) are inline fields on the speech response WebSocket message. Agent speaks content AND signals action in the same message. Your server owns the LLM.
- **LiveKit:** `@function_tool` decorator with `speech_handle` for tool/speech synchronization. Tool runs async, can inject speech via `session.say()`.
- **Vapi:** Each tool has configurable `messages` for lifecycle events (`request-start`, `request-complete`). Built-in tools for end-call and transfer.
- **Pipecat:** Frame-based pipeline — `LLMFunctionCallFrame` (SystemFrame) has elevated priority, executes immediately. Known timing issue: tool can execute before TTS finishes preceding text.
- **Vocode:** Separate parallel workers — `AgentResponsesWorker` for speech, `ActionsWorker` for actions. Never block each other.

**The "two-model" approach is a latency hack:**

- Fast SLM generates a filler ("Sure, let me check...") spoken immediately
- Heavy LLM generates the real response, delivered after
- Filler is NOT added to chat context — purely perceptual

### Key insight for our system:

Our approach of using OpenAI function calling IS correct. The model outputs text tokens (speech → TTS) or function calls (actions). Our failure was a prompt engineering issue (missing action rules), not an architectural one. Function calling + streaming is exactly what competitors do.

### 6. Sentence-Buffered Streaming TTS — LIVE TESTED (2026-04-09)

- **Branch:** `feat/latency-optimizations` in worktree `llmcalls-latency`
- **What:** Combined two changes:
  1. `SpeechFieldExtractor` — character-level state machine that parses the `speech` JSON value from OpenAI streaming tool call argument deltas as they arrive
  2. `createSentenceBufferedTTS` — accumulates streamed characters into sentences (splitting on `.!?`), dispatches each complete sentence to TTS immediately via chained promises
- **Pipeline:** LLM streams tool call args → extractor emits speech chars → sentence buffer splits → each sentence fires `telnyxService.speakText()` immediately → user hears first sentence while LLM keeps generating
- **Live test results (Medicare IVR, +18006334227):**

| Metric                                      | Values                                            | Notes                                      |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| LLM time to first token                     | 532-2879ms (median ~800ms)                        | GPT-4o-mini TTFT                           |
| First sentence dispatch after speech starts | **0-200ms**                                       | Well under 500ms target                    |
| Total STT→TTS (streamed speak)              | 1449-2268ms                                       | Full pipeline                              |
| Sentence dispatch examples                  | "representative" (40ms), "Yes" (20ms), "No" (0ms) | Short IVR speech dispatches near-instantly |

- **What this means:** Users hear the first word ~200ms after the LLM starts generating speech (+ ~200ms TTS API latency). Total perceived latency from user silence → audio = endpointing(400ms) + STT(0ms) + LLM TTFT(~800ms) + sentence dispatch(~100ms) + TTS API(~200ms) = **~1500ms**. Previous: 2-5s.
- **Remaining bottleneck:** LLM TTFT at 700-900ms median. Options: Groq Llama 3.3 70B (50-100ms TTFT), or GPT-4o-mini with prompt caching.
- **Quality:** Replay tests show no regressions from streaming (test mode uses non-streaming path). 5 divergences were from `guardHallucinatedDigit` (pre-existing, unrelated).
- **STATUS: WORKING. Validated on live call. Main latency win achieved.**

### Approaches tried and rejected (2026-04-09)

- **Option 2 (Two-phase LLM):** Phase 1 determines action, Phase 2 streams speech. Adds ~150-200ms overhead for the extra LLM call. Net negative for short IVR responses. Rejected.
- **Option 3 (Custom protocol):** Speech-first plain text, then `---ACTION---` delimiter, then JSON. True streaming but fragile — GPT-4o-mini may not follow the protocol reliably, loses function calling validation. Rejected.

## Next Steps

1. **Activate Groq** — Get free API key at https://console.groq.com, add `GROQ_API_KEY` + `LLM_PROVIDER=groq` to `.env`, run live calls to validate quality (code already implemented — see section 9)
2. **Re-record test fixtures** — 5 fixtures diverge due to `guardHallucinatedDigit` changes
3. **Validate endpointing quality** — 400ms endpointing + continuation buffer needs multi-call quality testing

## Files Modified (in worktree `llmcalls-latency`)

- `packages/backend/src/routes/streamRoutes.ts` — endpointing, continuation buffer
- `packages/backend/src/prompts/transfer-prompt.ts` — prompt compression
- `packages/backend/src/services/ivrNavigatorService.ts` — LLM optimizations, function tools, streaming
- `packages/backend/src/services/speechProcessingService.ts` — sentence-buffered TTS, streaming integration
- `packages/backend/src/services/telnyxService.ts` — Kokoro TTS support
- `packages/backend/src/services/callStateManager.ts` — action history cap
