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
  const kept = state.segments.filter(s => !rangesOverlap(s, incoming));
  return { segments: insertSorted(kept, incoming) };
}

/**
 * Render the merged transcript by joining segment texts in start-time order.
 */
export function renderTranscript(state: SegmentMergerState): string {
  return state.segments
    .map(s => s.text.trim())
    .filter(t => t.length > 0)
    .join(' ')
    .trim();
}
