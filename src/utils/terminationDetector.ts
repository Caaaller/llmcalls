/**
 * Termination Condition Detector
 * Detects when call should be terminated (closed, voicemail, dead end)
 */

import { CLOSED_PATTERNS, VOICEMAIL_PATTERNS } from './detectionPatterns';

export interface TerminationResult {
  shouldTerminate: boolean;
  reason: 'voicemail' | 'closed_no_menu' | 'dead_end' | null;
  message: string | null;
}

/**
 * Check if speech indicates the business is closed.
 * Detects closed status regardless of whether menu options are present.
 *
 * @example
 * isClosed('We are currently closed') // returns true
 * isClosed('We are currently closed, press 9 for emergencies') // returns true
 * isClosed('We are open Monday through Friday') // returns false
 */
export function isClosed(
  speechResult: string | null | undefined
): boolean {
  if (!speechResult) return false;
  const text = speechResult.toLowerCase();

  return CLOSED_PATTERNS.some(p => text.includes(p));
}

/**
 * Check if speech indicates voicemail recording has started
 */
export function isVoicemailRecording(
  speechResult: string | null | undefined
): boolean {
  if (!speechResult) return false;
  const text = speechResult.toLowerCase();

  return VOICEMAIL_PATTERNS.some(p => text.includes(p));
}

/**
 * Check if call has reached a dead end (silence after closed announcement)
 */
export function isDeadEnd(
  speechResult: string | null | undefined,
  previousSpeech: string | null | undefined = null,
  silenceDuration: number = 0
): boolean {
  const currentEmpty = !speechResult || !speechResult.trim();
  const previousClosed = previousSpeech
    ? isClosed(previousSpeech)
    : false;

  if (previousClosed && currentEmpty && silenceDuration >= 5) {
    return true;
  }

  return false;
}

/**
 * Check if any termination condition is met
 */
export function shouldTerminate(
  speechResult: string | null | undefined,
  previousSpeech: string | null | undefined = null,
  silenceDuration: number = 0
): TerminationResult {
  if (isVoicemailRecording(speechResult)) {
    return {
      shouldTerminate: true,
      reason: 'voicemail',
      message: 'Voicemail recording detected',
    };
  }

  if (isClosed(speechResult)) {
    return {
      shouldTerminate: true,
      reason: 'closed_no_menu',
      message: 'Business appears closed',
    };
  }

  if (isDeadEnd(speechResult, previousSpeech, silenceDuration)) {
    return {
      shouldTerminate: true,
      reason: 'dead_end',
      message: 'Call reached a dead end after closed announcement',
    };
  }

  return {
    shouldTerminate: false,
    reason: null,
    message: null,
  };
}
