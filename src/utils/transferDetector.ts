/**
 * Transfer Detection Utilities
 * Detects when a call should be transferred based on speech patterns
 */

import { TRANSFER_PATTERNS } from './detectionPatterns';

/**
 * Check if speech indicates a transfer request
 */
export function wantsTransfer(speechResult: string | null | undefined): boolean {
  if (!speechResult) return false;
  const text = speechResult.toLowerCase();

  return TRANSFER_PATTERNS.some(p => text.includes(p));
}

/**
 * Check if speech is incomplete (ends mid-sentence)
 */
export function isIncompleteSpeech(speechResult: string | null | undefined): boolean {
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