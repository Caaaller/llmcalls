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

const SIM_VOICE = 'Telnyx.KokoroTTS.am_michael';

const AGENT_NAMES = [
  'Alex',
  'Jamie',
  'Morgan',
  'Sam',
  'Taylor',
  'Jordan',
  'Riley',
  'Casey',
];

const GREETING_TEMPLATES = [
  'Hi, this is {name} with customer service, how can I help you today?',
  'Thanks for calling, this is {name}, what can I do for you?',
  '{name} speaking, how may I assist?',
  "Hello, you've reached customer support, {name} here. What's going on?",
  'Hey, {name} with support — what can I help you with?',
  'Good {timeOfDay}, {name} here. How can I help?',
];

const CONFIRMATION_TEMPLATES = [
  "Yes, I'm a real person — how can I help?",
  "I'm a live agent, yes. What do you need?",
  "Absolutely, this is a live rep. Tell me what's going on.",
  'Yes, human here. How can I assist?',
  "Correct, you've got a real person. What can I do for you?",
];

const FOLLOWUP_TEMPLATES = [
  "So tell me, what's the issue you're having?",
  'Go ahead, what can I help with?',
  "I'm all ears.",
];

export interface SimulatorScript {
  agentName: string;
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
  const greetingTemplate = pickRandom(GREETING_TEMPLATES);
  const confirmation = pickRandom(CONFIRMATION_TEMPLATES);
  const followup = pickRandom(FOLLOWUP_TEMPLATES);
  const timeOfDay = currentTimeOfDay();

  return {
    agentName,
    greeting: fillTemplate(greetingTemplate, { name: agentName, timeOfDay }),
    confirmation,
    followup,
    pickupDelayMs: randomBetween(800, 2500),
    greetingToConfirmationMs: randomBetween(4000, 6000),
    confirmationToFollowupMs: randomBetween(3000, 5000),
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
  const HARD_CAP_MS = 25_000;

  console.log(
    `[SIM] Starting simulator flow for ${callControlId.slice(-20)} ` +
      `agent=${script.agentName} pickupDelay=${script.pickupDelayMs}ms`
  );

  try {
    await telnyxService.answerCall(callControlId);

    await sleep(script.pickupDelayMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    await telnyxService.speakText(callControlId, script.greeting, SIM_VOICE);

    await sleep(script.greetingToConfirmationMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    await telnyxService.speakText(
      callControlId,
      script.confirmation,
      SIM_VOICE
    );

    await sleep(script.confirmationToFollowupMs);
    if (Date.now() - startedAt > HARD_CAP_MS) return;
    await telnyxService.speakText(callControlId, script.followup, SIM_VOICE);

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
