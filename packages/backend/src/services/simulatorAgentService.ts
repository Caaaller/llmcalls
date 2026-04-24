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
  'Hi, this is {name} with customer service, how can I help you today?',
  'Thanks for calling, this is {name}, what can I do for you?',
  '{name} speaking, how may I assist?',
  "Hello, you've reached customer support, {name} here. What's going on?",
  'Hey, {name} with support — what can I help you with?',
  'Good {timeOfDay}, {name} here. How can I help?',
  "Hi there, this is {name}. What's going on today?",
  "Hey, {name} from the support team. What's up?",
  "{name} here — tell me what's going on.",
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
    // Give the AI time to hear the greeting, run through its pipeline,
    // speak its "am I speaking with a live agent?" question, and have the
    // sim's confirmation land before the AI's listen window closes. The
    // AI's turn roughly: ~800ms endpointing + ~2000ms LLM + ~1000ms TTS
    // pipeline = ~4s minimum. Pad to 6-9s so we're clearly past that.
    greetingToConfirmationMs: randomBetween(6000, 9000),
    confirmationToFollowupMs: randomBetween(4000, 6000),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Orchestrates the scripted human-agent flow on an inbound call leg.
 * - Answer the call
 * - Pause (pick-up delay)
 * - Speak greeting
 * - Pause (listening for the AI's "am I speaking with a live agent?" prompt)
 * - Speak confirmation
 * - Pause, speak a short followup so the AI has something to react to
 * - Hang up after a hard cap (~25s from answer)
 *
 * Fire-and-forget — the webhook handler should not await this.
 */
export async function runSimulatorFlow(callControlId: string): Promise<void> {
  const script = pickSimulatorScript();
  const startedAt = Date.now();
  const HARD_CAP_MS = 45_000;

  console.log(
    `[SIM] Starting simulator flow for ${callControlId.slice(-20)} ` +
      `agent=${script.agentName} pickupDelay=${script.pickupDelayMs}ms`
  );

  try {
    await telnyxService.answerCall(callControlId);

    await sleep(script.pickupDelayMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    await telnyxService.speakText(callControlId, script.greeting, script.voice);

    await sleep(script.greetingToConfirmationMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    await telnyxService.speakText(
      callControlId,
      script.confirmation,
      script.voice
    );

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
    try {
      await telnyxService.terminateCall(callControlId);
    } catch {
      // terminateCall already swallows "already ended" — anything else we
      // just log from inside terminateCall itself.
    }
  }
}

// Exposed for unit testing — do not use from production code.
export const __testing = {
  AGENT_NAMES,
  GREETING_TEMPLATES,
  CONFIRMATION_TEMPLATES,
  FOLLOWUP_TEMPLATES,
};
