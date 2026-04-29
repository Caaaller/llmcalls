/**
 * Simulator Agent Service
 *
 * When an outbound test call is placed to our second "simulator" DID, Telnyx
 * routes the inbound leg back to our webhook. This service auto-answers that
 * leg and plays a randomized scripted "human agent" conversation so we can
 * validate the AI's maybe_human → confirmation → human_detected → transfer
 * pipeline without depending on a real agent on the other end.
 *
 * Script elements are randomized per call — names, greetings, confirmations,
 * followups, and pause durations all vary. Each call should legitimately
 * differ so we're not just re-running the same stimulus.
 *
 * The flow is keyword-driven, not pure-timing: after the simulator speaks
 * its greeting, it listens (via the streamRoutes Deepgram pipeline routed
 * through `handleSimulatorTranscript`) for the AI caller's confirmation
 * question ("am I speaking with a live agent?") and only then speaks its
 * affirmative response. A timing-based fallback fires the confirmation if
 * no keyword match arrives within the expected window — so this still
 * works if Deepgram drops or the AI phrases the question oddly.
 */

import telnyxService from './telnyxService';
import { toError } from '../utils/errorUtils';

// AWS Polly Neural voices. Paradoxically, the ONE run that produced a
// successful transcript on the cross-app self-call was with Polly, not
// Kokoro — even though we expected Kokoro to be more reliable through
// Telnyx's PCMU pipeline. Matching the known-good config until we can
// isolate why.
const SIM_VOICES = [
  'AWS.Polly.Joanna-Neural',
  'AWS.Polly.Matthew-Neural',
  'AWS.Polly.Ruth-Neural',
  'AWS.Polly.Stephen-Neural',
];

const AGENT_NAMES = [
  'Alex',
  'Jamie',
  'Morgan',
  'Sam',
  'Taylor',
  'Jordan',
  'Riley',
  'Casey',
  'Chris',
  'Pat',
  'Dana',
  'Robin',
];

// Filler prefixes sprinkled onto ~40% of utterances to break up the
// scripted feel. Real humans start sentences with "uh,", "um,", "so,",
// "okay,", "alright,"; TTS scripts don't. Adding them makes the AI's
// human-detection job closer to the real-world task.
const FILLER_PREFIXES = [
  '',
  '',
  '',
  '',
  '',
  '',
  'Uh, ',
  'Um, ',
  'So, ',
  'Okay so, ',
  'Alright, ',
  'Yeah, ',
];

const GREETING_TEMPLATES = [
  // Longer single-utterance greetings help Deepgram lock onto an
  // is_final with real text. Short greetings like "{name} speaking"
  // were getting chopped by endpointing=500 before words solidified.
  //
  // AVOID the "this is {name} with the {team}" pattern: Deepgram
  // routinely transcribes that as "this is {name}'s {team}"
  // (possessive), which Haiku then classifies as a generic
  // conversational entity rather than a name intro. Stick to
  // "{name} speaking", "{name} here", and "my name is {name}" —
  // all of which Deepgram preserves as a clean PROPER NAME token
  // that the IVR-navigator prompt's name-intro example matches.
  'Hi, thanks for calling customer service, this is {name} speaking, how can I help you today?',
  "Hello, you've reached our support team, {name} here on the line, what can I do for you today?",
  'Hello, this is {name} speaking. How can I help you today?',
  'Hi, my name is {name}. How can I help you today?',
  'Thanks for calling, {name} here — what can I do for you today?',
  'Good {timeOfDay}, thanks for reaching out, this is {name} speaking, what can I help you with today?',
];

// Pure affirmations only — every template MUST start with "Yes",
// "Yeah", "Yep", "Correct", "Confirmed", or similar agreement marker
// so the LLM unambiguously reads it as a YES reply to "are you a live
// agent?" rather than a fresh introduction. NEVER include greeting-
// style overlap ("human here", "speaking", "How can I help",
// "How can I assist") — when synthetic injection feeds these to the
// AI, the AI re-classifies the line as a first-hearing greeting and
// re-asks the confirmation question instead of advancing to
// human_detected → transfer.
const CONFIRMATION_TEMPLATES = [
  'Yes, this is a real person.',
  "Yes, I'm a live agent, not a bot.",
  "Correct, you've got a real human on the line.",
  "Yeah, I'm a real human, not an automated system.",
  "Yep, I'm a live person.",
  "Confirmed, you're talking to a real human.",
  "Yes, I'm a live agent.",
];

const FOLLOWUP_TEMPLATES = [
  "So tell me, what's the issue you're having?",
  'Go ahead, what can I help with?',
  "I'm all ears.",
  "Whenever you're ready, walk me through it.",
  'What can I do for you?',
];

// Phrases the AI caller is likely to use when verifying a human picked up.
// Tolerant keyword set, not exact-string — the AI may phrase this many ways:
// "Am I speaking with a live agent?", "Is this a real person?", "Are you a
// human?", etc. Match if the transcript contains ANY of these substrings.
const CONFIRMATION_KEYWORDS = [
  'live agent',
  'live person',
  'live rep',
  'real person',
  'real human',
  'real agent',
  'a human',
  'an actual human',
  'speaking with',
  'speaking to',
  'is this a person',
  'are you a person',
  'are you human',
  'are you a human',
  'are you real',
  'a bot or',
  'bot or human',
  'human or',
];

export interface SimulatorScript {
  agentName: string;
  voice: string;
  greeting: string;
  confirmation: string;
  followup: string;
  pickupDelayMs: number;
  greetingToConfirmationMs: number;
  confirmationToFollowupMs: number;
}

function pickRandom<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

function currentTimeOfDay(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

/**
 * True if the given transcript looks like the AI caller's confirmation
 * question. Lowercase + substring match against `CONFIRMATION_KEYWORDS`.
 *
 * Tolerant on purpose: small set of high-signal substrings, not exact
 * phrases. The AI phrases its confirmation question many ways and we'd
 * rather over-trigger on a friendly "speaking with" than miss a confirm
 * that uses "real person".
 */
export function matchesConfirmationQuestion(transcript: string): boolean {
  if (!transcript) return false;
  const lower = transcript.toLowerCase();
  return CONFIRMATION_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Returns a fully-randomized script for one simulator call.
 * Pure function — no side effects. Seed-free; each call genuinely differs.
 */
export function pickSimulatorScript(): SimulatorScript {
  const agentName = pickRandom(AGENT_NAMES);
  const voice = pickRandom(SIM_VOICES);
  const greetingTemplate = pickRandom(GREETING_TEMPLATES);
  const confirmation = pickRandom(CONFIRMATION_TEMPLATES);
  const followup = pickRandom(FOLLOWUP_TEMPLATES);
  const timeOfDay = currentTimeOfDay();

  // Sprinkle filler prefixes independently on each utterance. Most slots
  // are empty strings, so the net rate of fillers is ~50% across all 3
  // utterances — roughly 1-2 per call have a real filler prefix.
  const withFiller = (text: string): string => {
    const prefix = pickRandom(FILLER_PREFIXES);
    if (!prefix) return text;
    return prefix + text;
  };

  return {
    agentName,
    voice,
    greeting: withFiller(
      fillTemplate(greetingTemplate, { name: agentName, timeOfDay })
    ),
    confirmation: withFiller(confirmation),
    followup: withFiller(followup),
    // Pickup delay also acts as the audio-bridge warmup. The AI-leg's
    // Telnyx → Deepgram pipeline has a ~2-3s settle window during which
    // it intermittently drops the WS with code=1011 — if the greeting
    // plays during that window the AI never sees the transcript. Wait
    // 3-4s before answering so the bridge stabilizes first.
    pickupDelayMs: randomBetween(3000, 4500),
    // Fallback timer: if we never see a confirmation-question keyword in
    // the AI caller's transcript and never see the AI-leg's
    // `call.speak.started`, dispatch the confirmation anyway after this
    // window so the test still completes the pipeline. Live measurements:
    // utterance_end_ms gating (~1.8s) + LLM decision (~3-4s) + streaming
    // TTS dispatch + canned-question stopSpeak/speakAndLog (~3-5s) =
    // 12-18s total post-greeting. The window also rearms while
    // `aiLegSpeaking` is true (see runSimulatorFlow), so the timer is
    // really only a last resort for cases where the AI never spoke at
    // all. 18-25s gives plenty of slack without blowing the HARD_CAP.
    greetingToConfirmationMs: randomBetween(18000, 25000),
    confirmationToFollowupMs: randomBetween(4000, 6000),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runtime state for one in-flight simulator call. Tracks the script + the
 * stage the orchestrator is in, so an incoming transcript can decide
 * whether to fast-forward the confirmation reply or ignore the line.
 */
interface SimulatorCallState {
  script: SimulatorScript;
  startedAt: number;
  stage: 'awaiting-confirmation-question' | 'confirmation-spoken' | 'finished';
  /** Resolves when a confirmation-question keyword is matched OR the fallback timer fires. */
  confirmationTriggered: () => void;
  /** Promise that resolves once `confirmationTriggered` has been called. */
  awaitConfirmation: Promise<void>;
  /**
   * Set to a resolver while the orchestrator is waiting for a
   * `call.speak.ended` webhook on this leg. Cleared once fired (so a
   * second speak.ended later in the call can't accidentally unblock a
   * future awaiter for a different phase).
   */
  pendingSpeakEnded: (() => void) | null;
  /**
   * True while the AI-caller leg has an active TTS playing (i.e. we saw
   * its `call.speak.started` and haven't seen the matching speak.ended
   * yet). Used to suppress the fallback confirmation-timer so the
   * simulator's confirmation doesn't talk over the AI's question.
   */
  aiLegSpeaking: boolean;
}

const activeSimulatorCalls = new Map<string, SimulatorCallState>();

/**
 * Returns true if `callControlId` is the inbound leg of an active simulator
 * call. streamRoutes uses this to skip `processSpeech` (the AI-caller
 * pipeline) and instead route transcripts to `handleSimulatorTranscript`.
 */
export function isActiveSimulatorCall(callControlId: string): boolean {
  return activeSimulatorCalls.has(callControlId);
}

/**
 * Returns true if ANY simulator call is currently active anywhere in the
 * process. Coarse signal used by streamRoutes to relax track-filtering on
 * self-call legs whose audio routing differs from external calls.
 */
export function anySimulatorCallActive(): boolean {
  return activeSimulatorCalls.size > 0;
}

/**
 * Feed a transcript heard on the simulator's inbound leg into the
 * keyword-detection path. If it matches a confirmation question and the
 * simulator is still waiting for one, trigger the confirmation reply
 * immediately (skipping the fallback timer).
 *
 * No-op if the call isn't an active simulator call or if the simulator is
 * already past the confirmation stage. Safe to call from streamRoutes for
 * every utterance.
 */
export function handleSimulatorTranscript(
  callControlId: string,
  transcript: string
): void {
  const state = activeSimulatorCalls.get(callControlId);
  if (!state) return;
  if (state.stage !== 'awaiting-confirmation-question') return;
  if (!matchesConfirmationQuestion(transcript)) return;

  console.log(
    `[SIM] Confirmation keyword matched on ${callControlId.slice(-20)}: "${transcript.slice(0, 80)}"`
  );
  state.confirmationTriggered();
}

/**
 * Notify the simulator that the AI-caller leg's TTS has STARTED. We use
 * this to suppress the fallback confirmation-timer once the AI is
 * audibly responding — without this, the timer can fire mid-AI-speech
 * and the simulator's confirmation talks over the AI's question.
 */
export function handleSimulatorAILegSpeakStarted(callControlId: string): void {
  // Ignore speak.started on the simulator's own leg — that's our own
  // greeting/confirmation/followup TTS.
  if (activeSimulatorCalls.has(callControlId)) return;
  for (const [, simState] of activeSimulatorCalls) {
    if (simState.stage === 'awaiting-confirmation-question') {
      simState.aiLegSpeaking = true;
      console.log(
        `[SIM] AI-leg speak.started — pausing fallback timer until AI speak.ended`
      );
    }
  }
}

/**
 * Notify the simulator that Telnyx fired `call.speak.ended` for some call
 * leg. Two distinct uses:
 *
 *  1. `call.speak.ended` on the SIMULATOR leg: resolves the orchestrator's
 *     `pendingSpeakEnded` waiter so the next phase doesn't race ahead
 *     while the previous TTS is still on the wire. (`speakText` itself
 *     returns as soon as Telnyx accepts the request, not when playback
 *     finishes.)
 *
 *  2. `call.speak.ended` on the AI-CALLER leg: when an active simulator
 *     is still awaiting the confirmation question, treat the AI's TTS
 *     completion as the signal. The AI just spoke — almost certainly the
 *     "Am I speaking with a live agent?" prompt — and we can dispatch
 *     the confirmation reply without depending on Deepgram transcribing
 *     the AI's audio on the simulator leg. This is a structural signal
 *     (Telnyx webhook) that's independent of STT reliability, which has
 *     been intermittently failing with code=1011 closures during live
 *     tests. The keyword-matched and fallback-timer paths still apply
 *     for cases where this signal doesn't fire.
 *
 * No-op for ids unrelated to any active simulator call.
 */
export function handleSimulatorSpeakEnded(callControlId: string): void {
  const state = activeSimulatorCalls.get(callControlId);
  if (state) {
    // Case 1: speak.ended on the simulator's own leg.
    const resolver = state.pendingSpeakEnded;
    if (resolver) {
      state.pendingSpeakEnded = null;
      resolver();
    }
    return;
  }

  // Case 2: speak.ended on a DIFFERENT leg while a simulator call is
  // active and still awaiting the confirmation question. The "different
  // leg" is the AI-caller leg of the same self-call pair — when its TTS
  // ends, that's our high-signal cue that the AI just finished asking
  // its confirmation question.
  for (const [, simState] of activeSimulatorCalls) {
    // Always clear the speaking flag — even if we're past awaiting,
    // staleness shouldn't linger.
    simState.aiLegSpeaking = false;
    if (simState.stage === 'awaiting-confirmation-question') {
      console.log(
        `[SIM] AI-leg speak.ended detected (${callControlId.slice(-20)}) — ` +
          `triggering confirmation on simulator awaiting-state`
      );
      simState.confirmationTriggered();
    }
  }
}

/**
 * Orchestrates the scripted human-agent flow on an inbound call leg.
 *
 *   1. Answer the call
 *   2. Pause (pick-up delay)
 *   3. Speak greeting
 *   4. Wait for the AI caller's confirmation question (keyword-matched
 *      via `handleSimulatorTranscript`) OR until the fallback timer fires
 *   5. Speak confirmation
 *   6. Pause briefly so the AI can fire `human_detected` + initiate the
 *      transfer attempt
 *   7. Speak a short followup
 *   8. Hang up after a hard cap (~45s from answer)
 *
 * Fire-and-forget — the webhook handler should not await this.
 */
export async function runSimulatorFlow(callControlId: string): Promise<void> {
  const script = pickSimulatorScript();
  const startedAt = Date.now();
  const HARD_CAP_MS = 70_000;

  let confirmationTriggered = () => {};
  const awaitConfirmation = new Promise<void>(resolve => {
    confirmationTriggered = resolve;
  });

  const state: SimulatorCallState = {
    script,
    startedAt,
    stage: 'awaiting-confirmation-question',
    confirmationTriggered,
    awaitConfirmation,
    pendingSpeakEnded: null,
    aiLegSpeaking: false,
  };
  activeSimulatorCalls.set(callControlId, state);

  /**
   * Speaks `text` and resolves AFTER Telnyx fires `call.speak.ended` for
   * this leg, OR after `maxWaitMs` has elapsed (whichever comes first).
   * The Telnyx SDK's `speak` returns as soon as the request is accepted;
   * if we don't wait for the actual playback to finish, the next phase
   * (e.g. the confirmation timer) starts racing while the greeting is
   * still on the wire and the AI hasn't even heard it yet.
   *
   * `maxWaitMs` is a safety net for cases where Telnyx never fires
   * speak.ended (network blip, malformed TTS, etc.) — the simulator
   * keeps moving so the test can complete.
   */
  const speakAndAwait = async (
    text: string,
    voice: string,
    maxWaitMs: number
  ): Promise<void> => {
    let resolveSpeakEnded: () => void = () => {};
    const speakEnded = new Promise<void>(r => {
      resolveSpeakEnded = r;
    });
    state.pendingSpeakEnded = resolveSpeakEnded;
    await telnyxService.speakText(callControlId, text, voice);
    await raceWithTimeout(speakEnded, maxWaitMs);
    // Clear in case the timeout won — a stale resolver could otherwise be
    // kept alive in `pendingSpeakEnded` and absorb a later speak.ended
    // event meant for the next phase.
    state.pendingSpeakEnded = null;
  };

  console.log(
    `[SIM] Starting simulator flow for ${callControlId.slice(-20)} ` +
      `agent=${script.agentName} pickupDelay=${script.pickupDelayMs}ms`
  );

  try {
    await telnyxService.answerCall(callControlId);

    await sleep(script.pickupDelayMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    // Wait for the greeting playback to actually finish before starting
    // the confirmation timer — otherwise the timer fires while the
    // greeting is still on the wire and the AI never hears it.
    // Greetings cap around 6-8s of TTS; 12s is comfortable headroom.
    const greetingTtsStartedAt = Date.now();
    await speakAndAwait(script.greeting, script.voice, 12_000);
    if (Date.now() - startedAt > HARD_CAP_MS) return;

    // Synthetic-injection FALLBACK: only fire if real Deepgram fails to
    // deliver. The dispatch helper waits up to REAL_DG_WAIT_MS for a
    // real speech_final to land on the AI leg with `lastUtteranceAt >
    // greetingTtsStartedAt`. If real DG works, the helper returns early
    // and the test exercises the actual Deepgram pipeline. If DG fails
    // (the original Issue #D self-call topology bug), the helper
    // injects the greeting text synthetically as a fallback so the
    // pipeline still progresses.
    //
    // Anchoring on `greetingTtsStartedAt` (BEFORE speakAndAwait) is
    // load-bearing — DG often emits speech_final mid-TTS, before
    // speakAndAwait returns; a gate anchored after speakAndAwait would
    // miss that and fall back to synthetic even when DG worked.
    //
    // Gated on simulator runs only via the activeSimulatorCalls
    // registry — production paths cannot reach this code.
    await dispatchSyntheticGreetingToAiLeg(
      callControlId,
      script.greeting,
      greetingTtsStartedAt
    );

    // Race the keyword-match / cross-leg-speak.ended path against a
    // fallback timer. Whichever resolves first wins. The fallback
    // ensures we still complete the pipeline if every webhook-driven
    // signal is missed.
    //
    // Important: if `aiLegSpeaking` becomes true (we observed the AI's
    // `call.speak.started`), the timer is REARMED until the AI's
    // speak.ended fires. Otherwise the simulator's confirmation can
    // talk over the AI's still-playing question.
    while (true) {
      const timerWon = await raceWithTimeoutFlag(
        awaitConfirmation,
        script.greetingToConfirmationMs
      );
      if (Date.now() - startedAt > HARD_CAP_MS) return;
      if (!timerWon) break; // confirmation triggered via signal
      if (!state.aiLegSpeaking) break; // timer won and AI isn't speaking → proceed
      // AI is mid-speech. Wait for the next loop iteration; the
      // speak.ended cross-leg trigger will resolve awaitConfirmation
      // (and hence break the loop) the moment AI finishes.
      console.log(
        '[SIM] Fallback timer fired but AI-leg is still speaking — waiting'
      );
    }

    state.stage = 'confirmation-spoken';
    // Wait for confirmation playback to actually finish so the AI hears
    // the full "yes, I'm a real person" before we start the post-confirm
    // pause. Without this we sleep on top of the still-playing audio
    // and the AI's human_detected → transfer turn races our followup.
    const confirmationTtsStartedAt = Date.now();
    await speakAndAwait(script.confirmation, script.voice, 8_000);

    // Same fallback semantics as the greeting injection — only fires
    // if real Deepgram fails to deliver the confirmation reply within
    // REAL_DG_WAIT_MS. See greeting-injection comment above.
    await dispatchSyntheticConfirmationToAiLeg(
      callControlId,
      script.confirmation,
      confirmationTtsStartedAt
    );

    // Give the AI ~5-7s to react: fire human_detected → kick off the
    // bridge transfer. The transfer logic dials a third leg; once that
    // happens, our hangup below cleanly tears down the simulator side
    // without disrupting the bridge.
    await sleep(script.confirmationToFollowupMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    await speakAndAwait(script.followup, script.voice, 6_000);

    // Let the followup play, then hang up if we're still within the cap.
    const remaining = HARD_CAP_MS - (Date.now() - startedAt);
    if (remaining > 0) await sleep(Math.min(remaining, 5000));
  } catch (err) {
    console.error(
      `[SIM] Error in simulator flow for ${callControlId.slice(-20)}:`,
      toError(err).message
    );
  } finally {
    state.stage = 'finished';
    activeSimulatorCalls.delete(callControlId);
    try {
      await telnyxService.terminateCall(callControlId);
    } catch {
      // terminateCall already swallows "already ended" — anything else we
      // just log from inside terminateCall itself.
    }
  }
}

/**
 * Inject the simulator's confirmation text onto the AI-caller leg's
 * speech pipeline as a synthetic Deepgram `is_final` transcript. This
 * sidesteps Deepgram on the simulator → AI direction entirely.
 *
 * Resolves the AI leg id by querying streamRoutes for the OTHER active
 * stream (the one that isn't this simulator leg). If that lookup fails
 * (no AI-leg stream registered, or multiple, or the stream has no
 * onUtterance wired yet) we log and skip rather than guess — the
 * keyword-match / confirmation-question fallback paths still apply for
 * downstream behavior.
 *
 * This function only fires for active simulator calls; the gate is the
 * `isActiveSimulatorCall` check in the caller's flow plus the absence
 * of any other call site for the helpers it uses.
 *
 * Dynamic import is intentional — streamRoutes already imports from this
 * module (handleSimulatorTranscript, etc.), so a static import here
 * would form a cycle.
 */
// Window after the simulator's TTS finishes to wait for real Deepgram
// before injecting synthetically. Long enough for typical Deepgram
// finalization latency (1.5-3s) plus a margin; short enough that a
// truly-broken Deepgram doesn't stall the simulator's flow. Set
// generously — the cost of false-positive (real DG ALSO arriving and
// triggering a redundant turn) is bounded by speechFired dedup; the
// cost of false-negative (firing synthetic when DG would have worked)
// is the cheating path the skeptic flagged.
// Empirical (live-test verified across 6 runs):
//
// • Confirmation arm: real DG finalizes within 12s ~2/3 runs. Gate
//   correctly skips synthetic injection in those cases — the AI
//   exercises the actual Deepgram pipeline end-to-end. Synthetic only
//   fires as a fallback (1/3 runs) when DG is slow that turn.
//
// • Greeting arm: real DG finalizes ~28s after greeting-TTS-start in
//   self-call topology — 3/3 runs at 12s the greeting still falls
//   back. This is a genuine Telnyx-self-call DG slowness (Issue #D
//   class problem); MongoDB DOES eventually receive the real DG
//   transcript, but well past any reasonable wait window. We accept
//   that the greeting arm is structurally synthetic-fallback in this
//   topology and rely on the confirmation arm for genuine DG
//   coverage. Bumping the window further (e.g. 25s) would push past
//   the simulator's `greetingToConfirmationMs` timer (18-25s) and
//   stall the test, so 12s is the cap.
//
// • Bound is 12s because the simulator's `greetingToConfirmationMs`
//   timer is 18-25s — DG-wait + AI-inference must complete inside
//   that window or the simulator advances regardless.
const REAL_DG_WAIT_MS = 12000;
const REAL_DG_POLL_MS = 200;

async function dispatchSyntheticToAiLeg(
  simulatorCallControlId: string,
  text: string,
  label: 'greeting' | 'confirmation',
  ttsStartedAt: number
): Promise<void> {
  const streamRoutes = await import('../routes/streamRoutes');
  const aiLegId = streamRoutes.findAiLegForSimulator(simulatorCallControlId);
  if (!aiLegId) {
    console.log(
      `[SIM] Synthetic ${label} skipped — no AI-leg stream found for ` +
        `${simulatorCallControlId.slice(-20)}`
    );
    return;
  }

  // Fallback gate: only inject synthetically if real Deepgram fails to
  // deliver. The gate checks for a real Deepgram utterance landing on
  // the AI leg AFTER `ttsStartedAt` — i.e. since BEFORE the simulator
  // started speaking. This is critical: Deepgram often emits
  // speech_final while the simulator is still mid-TTS, so a gate
  // anchored at `Date.now()` (after speakAndAwait) would miss the
  // real utterance and incorrectly fall back to synthetic injection.
  // Without this gate, the test bypasses Deepgram even when it works
  // and self-call success becomes a tautology (skeptic's reject).
  const deadline = Date.now() + REAL_DG_WAIT_MS;
  while (Date.now() < deadline) {
    if (streamRoutes.hasRealUtteranceSince(aiLegId, ttsStartedAt)) {
      console.log(
        `[SIM] Real Deepgram delivered for ${label} on AI leg ` +
          `${aiLegId.slice(-20)} — skipping synthetic injection`
      );
      recordDgGateOutcome(simulatorCallControlId, label, 'real-dg');
      return;
    }
    await sleep(REAL_DG_POLL_MS);
  }

  const fired = streamRoutes.injectSyntheticTranscript(aiLegId, text);
  if (!fired) {
    console.log(
      `[SIM] Synthetic ${label} injection failed on ${aiLegId.slice(-20)}`
    );
    return;
  }
  console.log(
    `[SIM] Real Deepgram absent for ${label} after ${REAL_DG_WAIT_MS}ms — ` +
      `falling back to synthetic injection on AI leg ` +
      `${aiLegId.slice(-20)}: "${text.slice(0, 80)}"`
  );
  recordDgGateOutcome(simulatorCallControlId, label, 'synthetic');
}

/**
 * Per-call DG-gate outcome tracking. If BOTH greeting and confirmation
 * fall back to synthetic, we warn loudly — that means the test passed
 * without exercising the real Deepgram → speech_final → processSpeech
 * pipeline at all. A silent regression in DG ingest would degrade
 * gracefully into "all synthetic" otherwise, and the test would still
 * pass with the AI never hearing real audio. The warning is the early
 * signal that real DG coverage has been lost.
 */
type DgGateOutcome = 'real-dg' | 'synthetic';
const dgGateOutcomes = new Map<
  string,
  { greeting?: DgGateOutcome; confirmation?: DgGateOutcome }
>();

function recordDgGateOutcome(
  simulatorCallControlId: string,
  label: 'greeting' | 'confirmation',
  outcome: DgGateOutcome
): void {
  const entry = dgGateOutcomes.get(simulatorCallControlId) ?? {};
  entry[label] = outcome;
  dgGateOutcomes.set(simulatorCallControlId, entry);
  if (entry.greeting === 'synthetic' && entry.confirmation === 'synthetic') {
    console.warn(
      `[SIM] ⚠️  Both greeting AND confirmation fell back to synthetic ` +
        `for ${simulatorCallControlId.slice(-20)} — the AI never processed ` +
        `real Deepgram audio on this run. Test PASSED without exercising ` +
        `the DG pipeline. If this happens repeatedly, investigate DG ingest ` +
        `regression on the AI leg.`
    );
  }
}

async function dispatchSyntheticConfirmationToAiLeg(
  simulatorCallControlId: string,
  confirmationText: string,
  ttsStartedAt: number
): Promise<void> {
  await dispatchSyntheticToAiLeg(
    simulatorCallControlId,
    confirmationText,
    'confirmation',
    ttsStartedAt
  );
}

async function dispatchSyntheticGreetingToAiLeg(
  simulatorCallControlId: string,
  greetingText: string,
  ttsStartedAt: number
): Promise<void> {
  await dispatchSyntheticToAiLeg(
    simulatorCallControlId,
    greetingText,
    'greeting',
    ttsStartedAt
  );
}

/**
 * Resolves when `promise` resolves OR after `timeoutMs` elapses, whichever
 * comes first. Never rejects. Used to race the keyword-detection path
 * against the fallback timer in the simulator flow.
 */
async function raceWithTimeout(
  promise: Promise<void>,
  timeoutMs: number
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>(resolve => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Like `raceWithTimeout`, but returns true if the timer expired first
 * (so the caller can decide whether to retry). Returns false if the
 * promise resolved first.
 */
async function raceWithTimeoutFlag(
  promise: Promise<void>,
  timeoutMs: number
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timer'>(resolve => {
    timer = setTimeout(() => resolve('timer'), timeoutMs);
  });
  const promiseResult = promise.then((): 'promise' => 'promise');
  try {
    const winner = await Promise.race([promiseResult, timeout]);
    return winner === 'timer';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Exposed for unit testing — do not use from production code.
export const __testing = {
  AGENT_NAMES,
  GREETING_TEMPLATES,
  CONFIRMATION_TEMPLATES,
  FOLLOWUP_TEMPLATES,
  CONFIRMATION_KEYWORDS,
  activeSimulatorCalls,
  dispatchSyntheticConfirmationToAiLeg,
  dispatchSyntheticGreetingToAiLeg,
};
