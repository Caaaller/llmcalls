# Telnyx Cross-App Media Stream Fork Delivers Garbage Audio

> Internal tracker: **Known Issue #D** in [`CHANGES-LOG.md`](../CHANGES-LOG.md).
>
> Status: open with Telnyx (this doc is the support-ticket source).
> Workaround in repo: human-detection pipeline test bypasses Telnyx audio
> (`humanDetectionPipeline.test.ts`, commit `16367c3`). A second, more
> realistic workaround using the Telnyx recording API is prototyped in
> `selfCallRecordingPipeline.test.ts` (this PR).

## TL;DR

When a Telnyx DID belonging to Call Control Application **A**
(`llmcalls`) calls a Telnyx DID belonging to Call Control Application
**B** (`llmcalls-simulator`) on the **same Telnyx account**, our
WebSocket media stream fork (started via `calls.actions.startStreaming`
on the outbound leg) delivers **constant-energy uniform noise** rather
than real audio. The recording for the same call (Telnyx → S3 MP3 →
download → Deepgram HTTP) decodes correctly. The bug therefore lives in
Telnyx's media-stream fork pipeline on cross-app bridged calls, not in
our Deepgram integration or our application code.

The same `startStreaming` configuration works perfectly in production
when the destination is **any third-party PSTN endpoint**. The failure
is specific to the cross-app bridged self-call topology.

## Reproduction recipe

### Topology

```
            ┌─────────────────────────────┐
            │ Telnyx account              │
            │                             │
   App A ───┤ Call Control App "llmcalls" │
   DID 1    │ connection_id = ...017219034│
            │                             │
            │ Outbound dial to DID 2      │
            │ + startStreaming(stream_url=│
            │   wss://our-app/voice/stream)│
            │                             │
            │ Cross-app SIP bridge        │
            │           │                 │
            │           ▼                 │
            │ Call Control App            │
            │ "llmcalls-simulator"        │
   App B ───┤ connection_id = different   │
   DID 2    │                             │
            │ Inbound webhook → /voice    │
            │ Auto-answers, plays scripted│
            │ TTS greeting + confirmation │
            └─────────────────────────────┘
```

Both DIDs belong to the same Telnyx account but are attached to
different Call Control Applications. Each has its own webhook URL
pointing at the same backend service. The outbound leg places a normal
PSTN-style call to the simulator DID; Telnyx routes that internally
through a cross-app SIP bridge to the inbound leg.

### Steps

1. Provision two Telnyx DIDs on the same account.
2. Attach DID 1 to Call Control App **A**, DID 2 to Call Control App
   **B**. Each has its own webhook URL.
3. From DID 1's owner application, `POST /v2/calls` with
   `to=<DID 2>`, `record="record-from-answer"`,
   `record_channels="dual"`, `record_format="mp3"`.
4. On `call.answered`, call `POST
/v2/calls/{call_control_id}/actions/start_streaming` with
   `stream_url=wss://example.app/voice/stream`,
   `stream_track="both_tracks"`, `stream_codec="PCMU"`,
   `stream_bidirectional_mode="rtp"`.
5. The inbound webhook on App **B** auto-answers the call and plays
   ~3-5s of TTS speech (via `actions/speak`), pauses, then plays
   another ~3s clip, then hangs up.
6. The WebSocket fork on the outbound leg receives `media` frames
   throughout the ~9s call. Decode the base64 PCMU payload (G.711
   µ-law → 16-bit PCM) and run `ffmpeg`/`sox` stats on it.

### Expected vs actual

|                                    | Expected                                                               | Actual                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Stream-fork audio dynamics         | Speech segments (RMS ~1000-3000) interleaved with silence (RMS ~0-100) | **Constant-energy uniform noise**, RMS 3647-4705 across the full 9s, no silences |
| Stream-fork Deepgram result        | Recognizable transcript at confidence > 0.8                            | **Empty transcript**, confidence 0.0                                             |
| Recording (`call.recording.saved`) | Speech segments alternating with silence                               | **Correct** — RMS 1 in pauses, 1179-2309 during speech                           |
| Recording Deepgram result          | Transcript at confidence > 0.8                                         | **Correct** — confidence 1.0, full agent script transcribed verbatim             |

The recording is captured by Telnyx's media platform on the same call
and saved to S3 — and it is fine. It is only the **stream fork** that
delivers garbage on the cross-app topology.

## Evidence

### Audio stats — same call, two pipelines

- **Stream-fork dump** (decoded PCMU from `media` frames over 9s):
  RMS uniform between 3647 and 4705 across the full duration.
  No segment with RMS below ~3000. No silence floor.
- **Recording MP3** (Telnyx S3, downloaded via
  `GET /v2/recordings/{id}` → `download_urls.mp3`):
  RMS 1 in the inter-utterance pauses, 1179-2309 during the
  agent's TTS speech segments.

The "constant-energy uniform" pattern in the stream fork is consistent
with one of:

- **Wrong codec interpretation upstream of the fork** — e.g. the
  fork is being fed a non-PCMU payload but tagged as PCMU, or a
  pre-µ-law encoding byte stream is being decoded as already-decoded
  µ-law samples.
- **RTCP frames decoded as RTP payload** — RTCP packets at low
  intervals on a non-speech stream can yield a uniform-noise floor
  when re-interpreted as audio samples.
- **The fork is bridging the wrong leg of the cross-app SIP bridge**
  — possibly capturing comfort-noise / silence-suppression frames
  from the bridge midpoint rather than the actual audio path.

We can't distinguish between these from the application side. The fact
that the recording (presumably tapped from a different point in the
media path) is clean strongly suggests the issue is in the
stream-fork tap point, not in the upstream audio.

### Recording vs stream — Deepgram results

Recording → Deepgram REST `nova-3` model:

> "Hi, thanks for calling customer service, this is Jamie speaking,
> how can I help you today? ... Yes, I'm a real person, how can I
> help?" (confidence 1.0)

Stream-fork PCMU dump → same Deepgram model:

> _empty_ (confidence 0.0)

## Permutations already tried (no fix found)

We tried six full code-side permutations on our end. None changed the
stream-fork garbage-audio behavior — strongly indicating it isn't an
application-side configuration issue.

| Commit    | Change                                                                                          | Result on stream fork |
| --------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| `f791b1c` | Filter webhook events by `connection_id` so simulator firing is unambiguous                     | No change             |
| `9655083` | Skip the AI caller pipeline on the inbound simulator leg's `call.answered`                      | No change             |
| `3008d8f` | Extend pauses + relax `stream_track` filter (broaden which frames we accept)                    | No change             |
| `0c6bb6e` | `stream_track: "both_tracks"` → `"inbound_track"` (filter to inbound side only)                 | No change             |
| `8f0eabf` | Switch sim-side TTS to AWS Polly Neural (last-known-good config in prod for STT)                | No change             |
| `82e7e67` | Diagnostic: download recording via Telnyx API + Deepgram HTTP — confirmed bug is upstream of us | Diagnosis only        |

(There were additional intermediate revert commits — `dd391f9`, `664eb3a`,
`d63a2ca`, `720468e`, `67000503`, `0f94c9f` — testing each permutation
in isolation. Same null result.)

Voices tried (sim side): AWS Polly Neural (Joanna, Matthew, Ruth,
Stephen) and Telnyx Kokoro (am_michael, af_bella). All four
permutations of `stream_track`: `inbound_track`, `outbound_track`,
`both_tracks`, omitted. Greeting-length tuning from 1-utterance
greetings to longer 2-clause greetings (to give Deepgram more time to
lock onto an `is_final`).

## Single-app vs cross-app behavior difference

In **production** — outbound calls from `llmcalls` to arbitrary PSTN
endpoints (Walmart customer service, Hulu, T-Mobile, DirecTV, etc.) —
the **identical `startStreaming` configuration** works correctly. Live
agent and IVR audio is captured cleanly, transcribed by Deepgram in
real time at confidence > 0.85, and feeds our state machine without
issue. We have hundreds of recorded production fixtures showing this.

The bug only reproduces on the **cross-app bridged self-call**
topology described above. We have not been able to test the
single-app self-call equivalent (i.e. both DIDs on Call Control App
A) because of provisioning constraints — see "Workaround A" below.

This single-app vs cross-app behavior difference is the strongest
signal that the failure is in Telnyx's cross-app media-bridge
implementation, not in any per-call config we control.

## Asks for Telnyx

1. **Confirm cross-app media-stream fork behavior.** When DID A
   (Call Control App A) calls DID B (Call Control App B) on the same
   account, what does the documented expected media-stream fork
   audio look like for the outbound leg's `startStreaming` request?
   Are stream forks supposed to function across the SIP bridge, or
   is this an unsupported topology?
2. **Expected vs actual.** Given an outbound `start_streaming` with
   `stream_track="both_tracks"`, `stream_codec="PCMU"`,
   `stream_bidirectional_mode="rtp"`, are the `media` frames meant
   to carry the bridged remote-leg audio, or only the local leg's
   own RTP? On a cross-app bridge, is "remote leg" interpreted as
   "the other Call Control App's leg" — and if so does the bridge
   tap pre- or post-codec-translation?
3. **Known bug.** Is there a known issue tracking this on the
   Telnyx side? Constant-RMS uniform noise on cross-app stream
   forks while the Telnyx recording on the same call is clean.
4. **Workaround guidance.** Is the supported pattern to (a)
   consolidate both DIDs on the same Call Control App, or (b) use
   the recording API + post-call transcription only? Are there
   other supported topologies for self-call testing?

## Workaround A: single-app consolidation — feasibility analysis

**Goal:** put both the outbound caller and the inbound simulator on
the same Call Control Application (App **A**, `llmcalls`). If the
cross-app SIP bridge is what corrupts the stream fork, single-app
should sidestep it.

**What our code expects.** `voiceRoutes.ts/isSimulatorInboundCall`
distinguishes the two legs by `connection_id`:

```ts
function isSimulatorInboundCall(payload) {
  if (payload.to !== process.env.TELNYX_SIMULATOR_NUMBER) return false;
  if (
    process.env.TELNYX_SIMULATOR_CONNECTION_ID &&
    payload.connection_id !== process.env.TELNYX_SIMULATOR_CONNECTION_ID
  )
    return false;
  return payload.direction === 'incoming';
}
```

The check is `connection_id`-keyed, which is what makes the cross-app
topology readable. On a single-app topology, both legs would share
the same `connection_id`, so this guard collapses to "any inbound
call to the simulator number." That is still safe in practice —
the outbound leg has `direction: 'outgoing'`, not `'incoming'`, so
the `direction === 'incoming'` clause already filters correctly even
without the connection_id check.

**Outbound caller pipeline.** `voiceRoutes.ts:166-180` separately
guards `call.answered` against the simulator connection ID:

```ts
const simConnectionId = process.env.TELNYX_SIMULATOR_CONNECTION_ID;
if (payload.connection_id === simConnectionId) {
  // skip AI caller pipeline for simulator-leg call.answered
  return;
}
```

On a single-app topology, both legs share `connection_id`, so this
guard would also collapse. We'd need a different discriminator —
`payload.direction === 'incoming'` is again sufficient: only the
inbound simulator leg has incoming direction. Or we can key off
`payload.to` matching `TELNYX_SIMULATOR_NUMBER`.

**Webhook URL.** Today both Call Control Apps point at the same
backend service. Single-app trivially satisfies that — only one
webhook URL exists.

**Conclusion: feasible with small refactor.** The required code
changes are:

- Drop the `TELNYX_SIMULATOR_CONNECTION_ID` env var and its two
  call sites in `voiceRoutes.ts`.
- Replace the `connection_id` discriminator with `direction` +
  `to` checks (which the code already uses as primary filters).
- On the Telnyx side: detach DID 2 from `llmcalls-simulator`,
  attach to `llmcalls`. (Free, instant, reversible.)
- Update `docs/SELF-CALL-TEST-SETUP.md` to remove the mention of
  the simulator connection.

**Risk.** If Telnyx's cross-app bug is in fact a single-app bug too
(masked because we never tested single-app), the consolidation
won't help. We'd burn ~30 min of refactor + a live call to find out.
Worth doing as the simplest test of the cross-app hypothesis.

**Recommendation.** Try Workaround A first. It's the cheapest test
of the cross-app hypothesis and, if it works, gives us back the
real-time stream fork (which is what production uses anyway).

## Workaround C: recording API + post-call Deepgram HTTP — prototyped

This PR includes a prototype (`selfCallRecordingPipelineService.ts` +
`selfCallRecordingPipeline.test.ts`) that:

1. On `call.recording.saved` for a simulator-flagged call, fetches
   the MP3 via `GET /v2/recordings/{id}` (already the production
   pattern — see `apiRoutes.ts:192` and `evaluateTimestamps.ts:65`).
2. Sends the MP3 to Deepgram REST `nova-3` for transcription.
3. Splits the resulting word-stream by Deepgram speaker turns OR by
   a heuristic ~500ms gap, mapping each chunk back through
   `processSpeech` as if it had arrived live.
4. Asserts the state machine emits `maybe_human` on the greeting
   chunk and `human_detected` (or `transfer`) on the confirmation
   chunk.

**Tradeoff.** Human detection happens **after the call ends** — it
is **useless for production transfers**, where we need the AI to
fire `human_detected` while the live agent is still on the line.
The point of the prototype is to verify that, given clean audio
from the same Telnyx account, our state machine is correct and
ready for the day a real-time path becomes available.

**Reuses existing fixtures.** The prototype runs against any of the
~150 production recordings already in
`packages/backend/src/services/__tests__/fixtures/recordings/` —
those are PCMU-encoded MP3s captured by the same Telnyx recording
pipeline this workaround relies on. The unit test uses one of those
fixtures (no live call needed) to exercise the flow.

**Gating.** The new path is gated entirely behind
`ENABLE_SELF_CALL_SIMULATOR=1`, matching the existing simulator
fixture. The production stream-fork path is unchanged.

## Files

- [`docs/SELF-CALL-TEST-SETUP.md`](./SELF-CALL-TEST-SETUP.md) — DID
  provisioning + env wiring.
- [`packages/backend/src/services/simulatorAgentService.ts`](../packages/backend/src/services/simulatorAgentService.ts) — sim-side scripted agent flow.
- [`packages/backend/src/routes/voiceRoutes.ts`](../packages/backend/src/routes/voiceRoutes.ts) (`isSimulatorInboundCall`, `call.answered` simulator-skip guard) — connection_id-keyed routing.
- [`packages/backend/src/services/__tests__/humanDetectionPipeline.test.ts`](../packages/backend/src/services/__tests__/humanDetectionPipeline.test.ts) — synthetic-transcript bypass test.
- [`packages/backend/src/services/selfCallRecordingPipelineService.ts`](../packages/backend/src/services/selfCallRecordingPipelineService.ts) — recording-API workaround service (this PR).
- [`packages/backend/src/services/__tests__/selfCallRecordingPipeline.test.ts`](../packages/backend/src/services/__tests__/selfCallRecordingPipeline.test.ts) — recording-API workaround test (this PR).
- [`CHANGES-LOG.md`](../CHANGES-LOG.md#known-issue-d) — internal log
  entry.
