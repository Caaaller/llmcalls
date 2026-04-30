/**
 * Unit tests for time-anchored Deepgram is_final segment merging.
 *
 * Each is_final from Deepgram (with interim_results=true) carries a
 * [start, duration] window. Later is_finals over the SAME time window
 * are revisions, not deltas — they may refine number formatting
 * ("two" → "2") or complete a truncated word ("book" → "bookings").
 *
 * The merger replaces overlapping segments with the latest revision and
 * appends non-overlapping ones in start-time order.
 */
import {
  type DGSegment,
  type SegmentMergerState,
  clearSegments,
  mergeSegment,
  renderTranscript,
} from '../transcriptSegmentMerger';
import {
  detectBackToBackDuplication,
  normalizeForDuplication,
} from './detectBackToBackDuplication';

function seg(startMs: number, endMs: number, text: string): DGSegment {
  return { startMs, endMs, text };
}

function feed(segments: DGSegment[]): SegmentMergerState {
  let state = clearSegments();
  for (const s of segments) state = mergeSegment(state, s);
  return state;
}

describe('transcriptSegmentMerger', () => {
  it('case 1: strict revision (same start, longer dur, refined text)', () => {
    // {start:0,dur:2,text:"For first and business class book"} +
    // {start:0,dur:4,text:"For first and business class bookings, please press 1"}
    const state = feed([
      seg(0, 2000, 'For first and business class book'),
      seg(0, 4000, 'For first and business class bookings, please press 1'),
    ]);
    expect(renderTranscript(state)).toBe(
      'For first and business class bookings, please press 1'
    );
  });

  it('case 2: number formatting revision (Qatar pattern)', () => {
    // Same time range, refined text "two" → "2"
    const state = feed([seg(0, 2000, 'Press two'), seg(0, 2000, 'Press 2')]);
    expect(renderTranscript(state)).toBe('Press 2');
  });

  it('case 3: appends non-overlapping segments in time order', () => {
    const state = feed([seg(0, 2000, 'Press 1'), seg(5000, 7000, 'Press 2')]);
    expect(renderTranscript(state)).toBe('Press 1 Press 2');
  });

  it('case 4: partial overlap (new extends past previous)', () => {
    const state = feed([
      seg(0, 3000, 'Please try'),
      seg(2000, 5000, 'Please try again'),
    ]);
    expect(renderTranscript(state)).toBe('Please try again');
  });

  it('case 5: out-of-order arrival sorts by startMs', () => {
    const state = feed([
      seg(5000, 7000, 'second segment'),
      seg(0, 2000, 'first segment'),
    ]);
    expect(renderTranscript(state)).toBe('first segment second segment');
  });

  it('case 6: word-completion revision (same start, longer dur, more text)', () => {
    const state = feed([
      seg(0, 3000, 'please press one'),
      seg(0, 4000, 'please press one for sales'),
    ]);
    expect(renderTranscript(state)).toBe('please press one for sales');
  });

  it('case 7a: empty input renders to empty string', () => {
    expect(renderTranscript(clearSegments())).toBe('');
  });

  it('case 7b: single segment renders to its text', () => {
    const state = mergeSegment(clearSegments(), seg(0, 1000, 'hello'));
    expect(renderTranscript(state)).toBe('hello');
  });

  it('case 7c: identical segments arriving twice do not grow output', () => {
    const state = feed([seg(0, 2000, 'Press 2'), seg(0, 2000, 'Press 2')]);
    expect(state.segments).toHaveLength(1);
    expect(renderTranscript(state)).toBe('Press 2');
  });

  it('touching ranges (a.end === b.start) do NOT overlap — both kept', () => {
    const state = feed([seg(0, 2000, 'first'), seg(2000, 4000, 'second')]);
    expect(state.segments).toHaveLength(2);
    expect(renderTranscript(state)).toBe('first second');
  });

  it('three-way overlap: incoming spans two prior segments — both replaced', () => {
    const state = feed([
      seg(0, 1000, 'a'),
      seg(1500, 2500, 'b'),
      seg(0, 3000, 'unified revision spanning both'),
    ]);
    expect(state.segments).toHaveLength(1);
    expect(renderTranscript(state)).toBe('unified revision spanning both');
  });

  it('Qatar regression — back-to-back is_finals with refined formatting produce a single rendered phrase, not duplication', () => {
    // Pattern observed on calls v3:zvsO3qKJ2J6zI5o3TfOh45q88Xq and
    // v3:8kYcj6HcRJwqWw-bw1gt5QX_bSqh0zQtoz70f. The string-stitcher
    // produced "Please press 1 Please press 1" (duplication shape).
    // With time-anchored merging we get a single phrase.
    const state = feed([
      seg(0, 3500, 'For award redemption, please press one.'),
      seg(0, 3500, 'For award redemption, please press 1.'),
    ]);
    const out = renderTranscript(state);
    expect(out).toBe('For award redemption, please press 1.');

    // Smoking-gun guard: the same 4-word phrase must not repeat back-to-back.
    expect(detectBackToBackDuplication(out)).toEqual({ duplicated: false });
  });

  it('digit-word normalization catches "press one" / "press 1" mix', () => {
    // The exact pattern PR #46 was supposed to fix. Without digit-word
    // normalization the regression guard would miss it (the words don't
    // match literally — "one" !== "1"). With normalizeForDuplication both
    // tokens fold to "1" and the duplication is caught.
    const result = detectBackToBackDuplication(
      'please press one for sales please press 1 for sales',
      { normalize: normalizeForDuplication }
    );
    expect(result.duplicated).toBe(true);
  });

  // ── Edge cases (caveat #4 from PR #46 review) ──────────────────────────

  it('subset-shrink: longer text replaced by a same-window shorter text', () => {
    // Documented behavior: any incoming segment whose [startMs, endMs)
    // overlaps an existing segment REPLACES that segment, even when the
    // incoming text is shorter. Latest revision wins — Deepgram routinely
    // shrinks text on revision (e.g. removing a misheard filler).
    const state = feed([
      seg(0, 2000, 'press one for sales'),
      seg(0, 2000, 'press 1'),
    ]);
    expect(state.segments).toHaveLength(1);
    expect(renderTranscript(state)).toBe('press 1');
  });

  it('zero-duration segment: kept (start === end is a degenerate but valid window)', () => {
    // A zero-duration segment (start === end) does not overlap anything by
    // the strict-inequality rangesOverlap check. We keep it — it costs nothing
    // and lets Deepgram emit instant-utterance fragments without being dropped.
    const state = feed([seg(1000, 1000, 'x')]);
    expect(state.segments).toHaveLength(1);
    expect(renderTranscript(state)).toBe('x');
  });

  it('zero-duration adjacent to a full-window segment: both kept (no overlap)', () => {
    const state = feed([seg(0, 2000, 'first'), seg(2000, 2000, 'tick')]);
    expect(state.segments).toHaveLength(2);
    expect(renderTranscript(state)).toBe('first tick');
  });

  it('identical-timestamp shorter text: latest revision wins', () => {
    // (0, 2000ms, "Press 2 please") then (0, 2000ms, "Press 2") — second
    // segment is the latest revision and replaces the first even though it's
    // shorter. This locks in "latest wins" semantics regardless of length.
    const state = feed([
      seg(0, 2000, 'Press 2 please'),
      seg(0, 2000, 'Press 2'),
    ]);
    expect(state.segments).toHaveLength(1);
    expect(renderTranscript(state)).toBe('Press 2');
  });

  // ── Telemetry: data-loss warn when a merge drops significantly more text
  //    than it brings in (caveat #5). The threshold is a heuristic — incoming
  //    text shorter than half the displaced text suggests either an aggressive
  //    Deepgram revision OR a regression in the merger silently dropping data.
  it('warns when a merge replaces significantly more text than it brings in', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state1 = mergeSegment(
        clearSegments(),
        seg(0, 2000, 'a'.repeat(40))
      );
      mergeSegment(state1, seg(0, 2000, 'b'.repeat(10))); // 10 < 40 * 0.5
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/Significant text loss/);
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT warn when a merge replaces with text >= 50% of dropped', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state1 = mergeSegment(
        clearSegments(),
        seg(0, 2000, 'a'.repeat(40))
      );
      mergeSegment(state1, seg(0, 2000, 'b'.repeat(20))); // 20 == 40 * 0.5
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // Qatar regression: render-time safety net for ADJACENT non-overlapping
  // time windows whose CONTENT overlaps. Deepgram emitted "...for assistance"
  // then "available adviser for assistance" with non-overlapping time
  // windows — time-anchored merger correctly keeps both, but a naive
  // join would produce "for assistance available adviser for assistance"
  // (trailing-word duplication). renderTranscript must word-align-merge
  // adjacent segments. Real-world: sid 3ytfoeE6gXiuYSkljMseKNV96K.
  it('Qatar regression: renderTranscript dedups adjacent segment content overlap', () => {
    let state = clearSegments();
    state = mergeSegment(
      state,
      seg(
        0,
        3000,
        'Please hold. This call will be connected to the next available adviser for assistance'
      )
    );
    state = mergeSegment(
      state,
      seg(3000, 6000, 'available adviser for assistance.')
    );
    expect(renderTranscript(state)).toBe(
      'Please hold. This call will be connected to the next available adviser for assistance.'
    );
  });

  it('renderTranscript handles unrelated adjacent segments (no overlap = space concat)', () => {
    let state = clearSegments();
    state = mergeSegment(state, seg(0, 1000, 'Press 1 for sales'));
    state = mergeSegment(state, seg(2000, 3000, 'or wait on the line'));
    expect(renderTranscript(state)).toBe(
      'Press 1 for sales or wait on the line'
    );
  });
});
