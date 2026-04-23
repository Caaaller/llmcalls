/**
 * Space out any multi-digit sequence in a sentence so TTS speaks numbers one
 * digit at a time. IVRs with speech recognition expect digit-by-digit cadence;
 * saying "35142679" as a single number causes "I didn't hear anything" loops.
 *
 * Handles common number formats:
 *   "35142679"         → "3 5 1 4 2 6 7 9"
 *   "720-584-6358"     → "7 2 0 5 8 4 6 3 5 8"
 *   "ID is 12345"      → "ID is 1 2 3 4 5"
 *   "press 1"          → "press 1"          (single digit untouched)
 *   "March 6th 1998"   → "March 6th 1 9 9 8"
 */
export function spaceOutNumbers(text: string): string {
  // Match runs of 2+ digits, allowing dashes/spaces as separators between them.
  // (Parens intentionally excluded so "(720)" keeps its parens — we only rewrite
  // inside the digit run.)
  return text.replace(/\d[\d\- ]*\d/g, match => {
    const digitsOnly = match.replace(/[^\d]/g, '');
    return digitsOnly.split('').join(' ');
  });
}
