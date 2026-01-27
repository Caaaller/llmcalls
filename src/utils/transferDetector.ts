/**
 * Transfer Detection Utilities
 * Detects when a call should be transferred based on speech patterns
 */

/**
 * Check if speech indicates a transfer request
 */
export function wantsTransfer(speechResult: string | null | undefined): boolean {
  if (!speechResult) return false;
  const text = speechResult.toLowerCase();

  const patterns = [
    'transfer me',
    'transfer the call',
    'transfer this call',
    'speak to a representative',
    'speak with a representative',
    'customer service',
    'human representative',
    'real person',
    'agent',
    'operator',
    'representative please',
    'talk to someone',
    'talk to a person',
    "i'm transferring you",
    'i am transferring you',
    'i will transfer you',
    'you will be transferred',
    "you'll be transferred"
  ];

  return patterns.some(p => text.includes(p));
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