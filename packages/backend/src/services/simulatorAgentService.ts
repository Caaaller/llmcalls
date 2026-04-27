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
  'Hi, thanks for calling customer service, this is {name} speaking, how can I help you today?',
  "Hello, you've reached our support team, {name} here on the line, what can I do for you today?",
  'Hey, thanks for calling in today, this is {name} with the support team, how can I help you?',
  'Good {timeOfDay}, thanks for reaching out, this is {name} speaking, what can I help you with today?',
];

const CONFIRMATION_TEMPLATES = [
  "Yes, I'm a real person — how can I help?",
  "I'm a live agent, yes. What do you need?",
  "Absolutely, this is a live rep. Tell me what's going on.",
  'Yes, human here. How can I assist?',
  "Correct, you've got a real person. What can I do for you?",
  "Yeah I'm a real human, not a bot. What's the issue?",
  "Totally, live person on the line. What's up?",
  "Yep, I'm a real agent. Go ahead.",
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
    pickupDelayMs: randomBetween(800, 2000),
    // Fallback timer: if we never see a confirmation-question keyword in
    // the AI caller's transcript, dispatch the confirmation anyway after
    // this window so the test still completes the pipeline. Padded to
    // cover greeting playback + AI's full turn (STT + LLM + TTS).
    greetingToConfirmationMs: randomBetween(6000, 9000),
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
  const HARD_CAP_MS = 45_000;

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
  };
  activeSimulatorCalls.set(callControlId, state);

  console.log(
    `[SIM] Starting simulator flow for ${callControlId.slice(-20)} ` +
      `agent=${script.agentName} pickupDelay=${script.pickupDelayMs}ms`
  );

  try {
    await telnyxService.answerCall(callControlId);

    await sleep(script.pickupDelayMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    await telnyxService.speakText(callControlId, script.greeting, script.voice);

    // Race the keyword-match path against a fallback timer. Whichever
    // resolves first wins. The fallback ensures we still complete the
    // pipeline if Deepgram drops, the stream isn't wired, or the AI
    // phrases its confirmation in a way no keyword catches.
    await raceWithTimeout(awaitConfirmation, script.greetingToConfirmationMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;

    state.stage = 'confirmation-spoken';
    await telnyxService.speakText(
      callControlId,
      script.confirmation,
      script.voice
    );

    // Give the AI ~5-7s to react: fire human_detected → kick off the
    // bridge transfer. The transfer logic dials a third leg; once that
    // happens, our hangup below cleanly tears down the simulator side
    // without disrupting the bridge.
    await sleep(script.confirmationToFollowupMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    await telnyxService.speakText(callControlId, script.followup, script.voice);

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

// Exposed for unit testing — do not use from production code.
export const __testing = {
  AGENT_NAMES,
  GREETING_TEMPLATES,
  CONFIRMATION_TEMPLATES,
  FOLLOWUP_TEMPLATES,
  CONFIRMATION_KEYWORDS,
  activeSimulatorCalls,
};
