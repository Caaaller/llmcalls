/**
 * Termination Condition Detector
 * Detects when call should be terminated (closed, voicemail, dead end)
 */

export interface TerminationResult {
  shouldTerminate: boolean;
  reason: 'voicemail' | 'closed_no_menu' | 'dead_end' | null;
  message: string | null;
}

/**
 * Check if speech indicates the business is closed with no menu options
 */
export function isClosedNoMenu(speechResult: string | null | undefined): boolean {
  if (!speechResult) return false;
  const text = speechResult.toLowerCase();

  const closedPatterns = [
    'we are currently closed',
    'our office is currently closed',
    'outside of our normal business hours',
    'our hours are',
    'business hours are',
    'please call back during business hours'
  ];

  const hasMenuPattern = /(press\s*\d|\d\s+for\s+)/.test(text);

  return closedPatterns.some(p => text.includes(p)) && !hasMenuPattern;
}

/**
 * Check if speech indicates voicemail recording has started
 */
export function isVoicemailRecording(speechResult: string | null | undefined): boolean {
  if (!speechResult) return false;
  const text = speechResult.toLowerCase();

  const voicemailPatterns = [
    'please leave a message after the beep',
    'please leave your message after the tone',
    'record your message',
    'at the tone',
    'voicemail',
    'leave a message'
  ];

  return voicemailPatterns.some(p => text.includes(p));
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
  const previousClosed = previousSpeech ? isClosedNoMenu(previousSpeech) : false;

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
      message: 'Voicemail recording detected'
    };
  }

  if (isClosedNoMenu(speechResult)) {
    return {
      shouldTerminate: true,
      reason: 'closed_no_menu',
      message: 'Business appears closed with no menu options'
    };
  }

  if (isDeadEnd(speechResult, previousSpeech, silenceDuration)) {
    return {
      shouldTerminate: true,
      reason: 'dead_end',
      message: 'Call reached a dead end after closed announcement'
    };
  }

  return {
    shouldTerminate: false,
    reason: null,
    message: null
  };
}