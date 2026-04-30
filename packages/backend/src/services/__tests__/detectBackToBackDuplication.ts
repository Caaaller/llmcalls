/**
 * Test helper: detect back-to-back duplicated word phrases in a transcript.
 *
 * The smoking-gun shape of the Deepgram is_final stitching bug fixed by
 * PR #46 (time-anchored segment merger): a 4+ word phrase repeating
 * immediately after itself within a single transcript, e.g. "press one
 * for sales press 1 for sales". This helper is shared between the
 * always-on regression guard in liveCallEval.test.ts and unit tests in
 * transcriptSegmentMerger.test.ts so both check identical patterns.
 *
 * The optional `normalize` callback lets callers fold "press one" and
 * "press 1" together (digit-word ↔ digit) — without it, the regression
 * guard misses the exact pattern PR #46 was supposed to fix.
 */

export interface DetectOptions {
  /** Minimum phrase length (in words) considered. Default 4. */
  minLen?: number;
  /** Maximum phrase length (in words) considered. Default 8. */
  maxLen?: number;
  /** Per-token normalization. Default lowercases. */
  normalize?: (s: string) => string;
}

export type DetectResult =
  | { duplicated: false }
  | { duplicated: true; phrase: string };

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/**
 * Aggressive normalization that folds digit-words to digits and strips
 * punctuation. Use this from the regression guard so "press one" and
 * "press 1" register as the same phrase — that mixed-formatting case
 * is the exact pattern PR #46 fixed.
 */
export function normalizeForDuplication(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => DIGIT_WORDS[w] ?? w)
    .join(' ');
}

export function detectBackToBackDuplication(
  text: string,
  opts: DetectOptions = {}
): DetectResult {
  const minLen = opts.minLen ?? 4;
  const maxLen = opts.maxLen ?? 8;
  const norm = opts.normalize ?? ((s: string) => s.toLowerCase());
  const normalized = norm(text);
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  const upper = Math.min(maxLen, Math.floor(words.length / 2));
  for (let len = minLen; len <= upper; len++) {
    for (let i = 0; i + len * 2 <= words.length; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      const next = words.slice(i + len, i + len * 2).join(' ');
      if (phrase === next) return { duplicated: true, phrase };
    }
  }
  return { duplicated: false };
}
