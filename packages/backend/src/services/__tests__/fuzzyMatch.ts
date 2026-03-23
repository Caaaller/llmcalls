/**
 * Fuzzy matching for IVR speech-to-text comparison.
 * Uses Jaccard token overlap — handles word insertion/omission better than Levenshtein.
 */

export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(normalizeSpeech(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeSpeech(b).split(' ').filter(Boolean));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

export function isSpeechMatch(
  recorded: string,
  live: string,
  threshold = 0.7
): boolean {
  const tokenCount = Math.min(
    normalizeSpeech(recorded).split(' ').filter(Boolean).length,
    normalizeSpeech(live).split(' ').filter(Boolean).length
  );

  const effectiveThreshold = tokenCount < 5 ? 0.5 : threshold;
  return tokenOverlap(recorded, live) >= effectiveThreshold;
}

export interface KeyPhraseResult {
  allFound: boolean;
  found: Array<string>;
  missing: Array<string>;
}

export function containsKeyPhrases(
  transcription: string,
  phrases: Array<string>
): KeyPhraseResult {
  const normalized = normalizeSpeech(transcription);
  const found: Array<string> = [];
  const missing: Array<string> = [];

  for (const phrase of phrases) {
    if (normalized.includes(normalizeSpeech(phrase))) {
      found.push(phrase);
    } else {
      missing.push(phrase);
    }
  }

  return { allFound: missing.length === 0, found, missing };
}
