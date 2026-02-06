/**
 * Transfer Detection Utilities
 * Detects when a call should be transferred based on speech patterns
 */

import { TRANSFER_PATTERNS } from './detectionPatterns';
import { isIVRMenu } from './ivrDetector';

/**
 * Check if speech indicates a transfer request
 * Excludes IVR menu options to avoid false positives
 */
export function wantsTransfer(
  speechResult: string | null | undefined
): boolean {
  if (!speechResult) return false;
  const text = speechResult.toLowerCase();

  // Don't trigger on IVR menu options (e.g., "press 1 for live agent")
  if (isIVRMenu(speechResult)) {
    // Check if it's a menu option pattern (press X for Y, etc.)
    const isMenuOption = /\b(press|select|enter|choose)\s*\d+\s+(for|to)\s+/i.test(
      text
    );
    if (isMenuOption) {
      return false; // This is a menu option, not an actual transfer
    }
  }

  // Check for explicit transfer confirmations (system saying it will transfer)
  const explicitTransferPatterns = [
    "i'm transferring you",
    'i am transferring you',
    'i will transfer you',
    'you will be transferred',
    "you'll be transferred",
    'transferring you now',
    'transferring your call',
    'let me connect you',
    'connecting you',
    'please hold while i transfer',
    'hold while i transfer',
  ];

  const hasExplicitTransfer = explicitTransferPatterns.some(pattern =>
    text.includes(pattern)
  );
  if (hasExplicitTransfer) {
    return true;
  }

  // For other patterns, only match if NOT in a menu context
  // (e.g., "please hold" alone is not enough if it's part of a menu)
  const hasMenuKeywords = /\b(press|select|enter|choose|option|menu)\s*\d/i.test(
    text
  );
  if (hasMenuKeywords) {
    return false; // Likely a menu option
  }

  // Exclude questions that are followed by the system offering to help
  // (e.g., "So you want to speak with a representative? I can help...")
  const isQuestionFollowedByHelp = /\b(so|do|would|can)\s+(you|i)\s+(want|need|speak|help)/i.test(
    text
  ) && /\b(i can|i'll|let me)\s+help/i.test(text);
  if (isQuestionFollowedByHelp) {
    return false; // This is a question, not a transfer
  }

  // Check other transfer patterns
  return TRANSFER_PATTERNS.some(p => text.includes(p));
}

/**
 * Check if speech is incomplete (ends mid-sentence)
 */
export function isIncompleteSpeech(
  speechResult: string | null | undefined
): boolean {
  if (!speechResult) return false;
  const trimmed = speechResult.trim();
  if (!trimmed) return false;

  // Consider speech incomplete if it doesn't end with typical sentence punctuation
  // and is relatively short (likely cut off)
  const endsWithPunctuation = /[.!?]$/.test(trimmed);
  if (!endsWithPunctuation && trimmed.split(' ').length < 5) {
    return true;
  }

  return false;
}
