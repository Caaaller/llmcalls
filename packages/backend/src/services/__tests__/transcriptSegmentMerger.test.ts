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
    const words = out
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 0);
    let dup = false;
    for (let len = 4; len <= Math.floor(words.length / 2); len++) {
      for (let i = 0; i + len * 2 <= words.length; i++) {
        const a = words.slice(i, i + len).join(' ');
        const b = words.slice(i + len, i + len * 2).join(' ');
        if (a === b) dup = true;
      }
    }
    expect(dup).toBe(false);
  });
});
