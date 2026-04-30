/**
 * Menu Option Type
 * Represents a DTMF digit and its corresponding menu option description
 */
export interface MenuOption {
  digit: string;
  option: string;
}

/**
 * IVR boilerplate words that appear in many menu descriptions and don't
 * disambiguate which menu we're on. Filtered out before counting word
 * overlap in `sameMenuShape` so e.g. "for bookings press 1" and "for
 * cancellations press 1" don't falsely collapse via the shared "press"
 * token. (Staff-review caveat from the Qatar arc — original threshold
 * of ≥1 overlapping ≥4-letter word created false same-shape matches on
 * IVR boilerplate.)
 */
const IVR_STOP_WORDS = new Set([
  'press',
  'please',
  'select',
  'option',
  'options',
  'choose',
  'enter',
  'menu',
  'continue',
  'representative',
  'agent',
  'department',
  'departments',
  'with',
  'from',
  'about',
  'your',
  'this',
  'that',
  'these',
  'those',
  'have',
  'will',
  'would',
  'could',
  'should',
  'regarding',
]);

function contentWords(option: string): string[] {
  return option
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 4 && !IVR_STOP_WORDS.has(w));
}

/**
 * Returns true if two menu option lists represent the SAME menu shape —
 * i.e. same set of digits AND each digit maps to a substantially-similar
 * option description (a retry of the same menu may rephrase slightly).
 *
 * Used by speechProcessingService to detect IVR menu transitions for the
 * Qatar-class loop-hallucination fix.
 *
 * Per-digit comparison requires ≥2 content words to overlap (or ≥1 if
 * either side has fewer than 2 content words). "Content" = ≥4 letters AND
 * not in IVR_STOP_WORDS. Avoids false positives where two genuinely
 * different submenus share only IVR boilerplate ("press", "please") plus
 * a coincidence.
 */
export function sameMenuShape(a: MenuOption[], b: MenuOption[]): boolean {
  if (a.length !== b.length) return false;
  const aDigits = a
    .map(o => o.digit)
    .sort()
    .join(',');
  const bDigits = b
    .map(o => o.digit)
    .sort()
    .join(',');
  if (aDigits !== bDigits) return false;
  const sortedA = [...a].sort((x, y) => (x.digit < y.digit ? -1 : 1));
  const sortedB = [...b].sort((x, y) => (x.digit < y.digit ? -1 : 1));
  for (let i = 0; i < sortedA.length; i++) {
    const aWords = new Set(contentWords(sortedA[i].option));
    const bWords = contentWords(sortedB[i].option);
    if (aWords.size === 0 && bWords.length === 0) continue; // both empty
    const required = Math.min(2, Math.max(aWords.size, bWords.length));
    const overlap = bWords.filter(w => aWords.has(w)).length;
    if (overlap < required) return false;
  }
  return true;
}
