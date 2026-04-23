/**
 * Rewrite any "press X" phrasing (where X is a digit, digit-word, or key name
 * like pound/star) into "representative" before we hand text to TTS.
 *
 * Why: voicebot IVRs (no DTMF menu) hear our TTS as speech. Saying "press
 * zero" into a voicebot is nonsense — the bot can't act on it and the call
 * dead-ends. The prompt is told not to produce this phrasing, but this is a
 * belt-and-suspenders regex net in case the model slips.
 *
 * Rules:
 *   "press (zero|one|...|nine)"         → "representative"
 *   "press \d"                           → "representative"
 *   "press (pound|hash|star|asterisk)"   → "representative"
 *   "press the X key"                    → "representative"
 *   Case-insensitive, word-boundary matched.
 *   "I'll press on with this" is UNCHANGED — we only rewrite when "press" is
 *   followed by a digit/digit-word/key name.
 *
 * If the whole utterance (trimmed) is just "press X", output is
 * "representative". In a sentence, the match is replaced in place.
 */

const DIGIT_WORDS = 'zero|one|two|three|four|five|six|seven|eight|nine';
const KEY_WORDS = 'pound|hash|star|asterisk';

// "press [the] X [key]" where X is a digit word, single digit, or key word.
// Allows an optional leading "the " and optional trailing " key".
const PRESS_PATTERN = new RegExp(
  `\\bpress(?:\\s+the)?\\s+(?:${DIGIT_WORDS}|\\d|${KEY_WORDS})(?:\\s+key)?\\b`,
  'gi'
);

export function sanitizeSpeakText(text: string): string {
  if (!text) return text;

  const replaced = text.replace(PRESS_PATTERN, 'representative');

  if (replaced === text) return text;

  // If the whole utterance (after trimming + stripping trailing punctuation)
  // was just the match, return a clean "representative" with no residue.
  const stripped = replaced.trim().replace(/[.!?]+$/, '');
  if (stripped.toLowerCase() === 'representative') return 'representative';

  return replaced;
}
