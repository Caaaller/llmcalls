/**
 * Time-anchored merging of Deepgram is_final segments.
 *
 * Deepgram with `interim_results=true` emits is_final events that REVISE
 * earlier finalizations rather than emitting strict deltas. Two finals
 * covering the same time range may differ in formatting (e.g.
 * "Press two" → "Press 2") or completion ("class book" → "class bookings").
 *
 * String-based stitching cannot reliably resolve these revisions. Instead
 * we anchor each final by its [startMs, endMs] window and replace any
 * existing segments whose ranges OVERLAP the incoming one.
 *
 * Pure module — no Telnyx / network dependencies, fully unit-testable.
 */

export interface DGSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SegmentMergerState {
  // Kept sorted by startMs ascending.
  segments: DGSegment[];
}

/**
 * Two ranges [a.start, a.end) and [b.start, b.end) overlap when each starts
 * before the other ends. Touching ranges (a.end === b.start) do NOT overlap.
 */
function rangesOverlap(a: DGSegment, b: DGSegment): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * Insert `seg` into `segments` keeping the array sorted by startMs.
 * Returns a new array — does not mutate input.
 */
function insertSorted(segments: DGSegment[], seg: DGSegment): DGSegment[] {
  const next = segments.slice();
  let i = 0;
  while (i < next.length && next[i].startMs <= seg.startMs) i++;
  next.splice(i, 0, seg);
  return next;
}

export function clearSegments(): SegmentMergerState {
  return { segments: [] };
}

/**
 * Merge an incoming Deepgram is_final segment into existing state.
 *
 * Algorithm: any existing segments overlapping the incoming time range
 * are dropped (they were earlier-version finalizations of the same
 * audio). The incoming segment is then inserted sorted by startMs.
 */
export function mergeSegment(
  state: SegmentMergerState,
  incoming: DGSegment
): SegmentMergerState {
  if (state.segments.length === 0) {
    return { segments: [incoming] };
  }
  const replaced = state.segments.filter(s => rangesOverlap(s, incoming));
  const kept = state.segments.filter(s => !rangesOverlap(s, incoming));

  // Production telemetry: warn when a merge drops significantly more text
  // than it brings in. Either Deepgram revised aggressively, or a future
  // regression is silently degrading the merger. Heuristic: incoming length
  // < half the combined replaced length. Catches a pattern that would
  // otherwise look like "merger working" while quietly losing audio.
  if (replaced.length > 0) {
    const replacedTextLen = replaced.reduce((sum, s) => sum + s.text.length, 0);
    if (incoming.text.length < replacedTextLen * 0.5) {
      console.warn(
        `[transcriptSegmentMerger] Significant text loss in merge: replaced ${replacedTextLen} chars with ${incoming.text.length} chars at [${incoming.startMs}, ${incoming.endMs}]ms`
      );
    }
  }

  return { segments: insertSorted(kept, incoming) };
}

/**
 * Find the longest WORD-ALIGNED suffix of `prev` that exactly equals a
 * prefix of `next`. Returns the merged result. Word-aligned avoids
 * gluing partial words ("def" + "definitely" stays separate).
 *
 * Used by renderTranscript as a safety net for the case where Deepgram
 * emits two is_final events with NON-overlapping time windows but
 * overlapping CONTENT (e.g. boundary segment "...for assistance" + next
 * segment "available adviser for assistance.") — the time-anchored
 * merger correctly keeps both segments, but joining them with a space
 * produces "for assistance available adviser for assistance" with
 * duplicated trailing words. Real-world example from Qatar Airways
 * call sid 3ytfoeE6gXiuYSkljMseKNV96K_4fTpFgRa5l: hold message played
 * once but rendered with "available adviser for assistance available
 * adviser for assistance" because of segment-boundary content overlap.
 */
/** Strip leading/trailing punctuation for word-equality comparison. */
function stripPunct(word: string): string {
  return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function wordsEqual(a: string, b: string): boolean {
  return stripPunct(a) === stripPunct(b);
}

function mergeWordAligned(prev: string, next: string): string {
  const prevTrim = prev.trim();
  const nextTrim = next.trim();
  if (!prevTrim) return nextTrim;
  if (!nextTrim) return prevTrim;
  const prevWords = prevTrim.split(/\s+/);
  const nextWords = nextTrim.split(/\s+/);
  const maxK = Math.min(prevWords.length, nextWords.length);
  for (let k = maxK; k > 0; k--) {
    const prevSuffix = prevWords.slice(-k);
    const nextPrefix = nextWords.slice(0, k);
    let allEqual = true;
    for (let i = 0; i < k; i++) {
      if (!wordsEqual(prevSuffix[i], nextPrefix[i])) {
        allEqual = false;
        break;
      }
    }
    if (allEqual) {
      // Prefer the next-segment's spellings for the overlapping range —
      // they're typically the more-finalized version (e.g. "assistance"
      // → "assistance." with proper end-of-sentence punctuation).
      return prevWords
        .slice(0, prevWords.length - k)
        .concat(nextPrefix)
        .concat(nextWords.slice(k))
        .join(' ');
    }
  }
  return `${prevTrim} ${nextTrim}`;
}

/**
 * Render the merged transcript by joining segment texts in start-time
 * order. Adjacent segments are merged with word-aligned suffix-prefix
 * dedup as a safety net for content-overlap that the time-anchored
 * merger doesn't catch (touching/non-overlapping time windows but
 * overlapping content — see mergeWordAligned doc).
 */
export function renderTranscript(state: SegmentMergerState): string {
  const texts = state.segments
    .map(s => s.text.trim())
    .filter(t => t.length > 0);
  if (texts.length === 0) return '';
  return texts.reduce((acc, text) => mergeWordAligned(acc, text), '').trim();
}
