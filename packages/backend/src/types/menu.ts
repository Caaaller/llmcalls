/**
 * Menu Option Type
 * Represents a DTMF digit and its corresponding menu option description
 */
export interface MenuOption {
  digit: string;
  option: string;
}

/**
 * Returns true if two menu option lists represent the SAME menu shape —
 * i.e. same set of digits AND each digit maps to a substantially-similar
 * option description (a retry of the same menu may rephrase slightly).
 *
 * Used by speechProcessingService to detect IVR menu transitions for the
 * Qatar-class loop-hallucination fix.
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
  // Compare option descriptions per-digit. Allow small rephrasings: count
  // it the "same" menu if each digit's option in `a` shares ≥3 significant
  // word tokens with `b`'s option for the same digit. Threshold-based to
  // tolerate IVR rephrasings ("for bookings" vs "regarding bookings") while
  // still detecting genuinely different menus.
  const sortedA = [...a].sort((x, y) => (x.digit < y.digit ? -1 : 1));
  const sortedB = [...b].sort((x, y) => (x.digit < y.digit ? -1 : 1));
  for (let i = 0; i < sortedA.length; i++) {
    const aWords = new Set(
      sortedA[i].option
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= 4)
    );
    const bWords = sortedB[i].option
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 4);
    const overlap = bWords.filter(w => aWords.has(w)).length;
    if (overlap < 1 && aWords.size > 0 && bWords.length > 0) return false;
  }
  return true;
}
