/**
 * Post-DTMF loop watcher unit tests.
 *
 * Covers the pure `shouldForceReprocess` predicate + the
 * `appendInterimSegment` / `renderAccumulated` helpers. Integration with
 * streamRoutes is tested via live call replays (Costco scenario); these
 * tests lock down the gating logic and the time-anchored merge so we can't
 * regress the dedup / isSpeaking / threshold guards or reintroduce
 * string-stitch duplications.
 */

import {
  appendInterimSegment,
  MIN_ACCUMULATED_CHARS,
  POST_DTMF_LOOP_WATCHER_MS,
  renderAccumulated,
  resetWatcherFields,
  shouldForceReprocess,
  ShouldForceReprocessInput,
} from '../postDTMFLoopWatcher';
import {
  clearSegments,
  type DGSegment,
  type SegmentMergerState,
} from '../transcriptSegmentMerger';

const DTMF_AT = 1_000_000;
const AFTER_WINDOW = DTMF_AT + POST_DTMF_LOOP_WATCHER_MS + 10;
const BEFORE_WINDOW = DTMF_AT + POST_DTMF_LOOP_WATCHER_MS - 50;

function seg(startMs: number, endMs: number, text: string): DGSegment {
  return { startMs, endMs, text };
}

function segmentsFromText(text: string): SegmentMergerState {
  // Build a single-segment state with arbitrary [0, 1000ms] window — the
  // shouldForceReprocess predicate only cares about the rendered length.
  return appendInterimSegment(clearSegments(), seg(0, 1000, text));
}

function longSegments(chars = MIN_ACCUMULATED_CHARS + 5): SegmentMergerState {
  return segmentsFromText('x'.repeat(chars));
}

function input(
  overrides: Partial<ShouldForceReprocessInput> = {}
): ShouldForceReprocessInput {
  return {
    lastDTMFPressedAt: DTMF_AT,
    accumulatedInterimSegments: longSegments(),
    isSpeaking: false,
    forcedReprocessFiredAt: undefined,
    ...overrides,
  };
}

describe('shouldForceReprocess', () => {
  it('returns true when all conditions are met', () => {
    expect(shouldForceReprocess(input(), AFTER_WINDOW)).toBe(true);
  });

  it('returns false before the 5s window has elapsed', () => {
    expect(shouldForceReprocess(input(), BEFORE_WINDOW)).toBe(false);
  });

  it('returns false when accumulated interim is under the threshold', () => {
    expect(
      shouldForceReprocess(
        input({
          accumulatedInterimSegments: segmentsFromText(
            'x'.repeat(MIN_ACCUMULATED_CHARS - 1)
          ),
        }),
        AFTER_WINDOW
      )
    ).toBe(false);
  });

  it('returns false when accumulated interim is empty or undefined', () => {
    expect(
      shouldForceReprocess(
        input({ accumulatedInterimSegments: clearSegments() }),
        AFTER_WINDOW
      )
    ).toBe(false);
    expect(
      shouldForceReprocess(
        input({ accumulatedInterimSegments: undefined }),
        AFTER_WINDOW
      )
    ).toBe(false);
  });

  it('returns false when no DTMF has been pressed yet (watcher unarmed)', () => {
    expect(
      shouldForceReprocess(
        input({ lastDTMFPressedAt: undefined }),
        AFTER_WINDOW
      )
    ).toBe(false);
  });

  it('returns false when isSpeaking=true (avoid talking over ourselves)', () => {
    expect(
      shouldForceReprocess(input({ isSpeaking: true }), AFTER_WINDOW)
    ).toBe(false);
  });

  it('returns false when already fired within the dedup window', () => {
    const justFired = AFTER_WINDOW - 100;
    expect(
      shouldForceReprocess(
        input({ forcedReprocessFiredAt: justFired }),
        AFTER_WINDOW
      )
    ).toBe(false);
  });

  it('returns true again once the dedup window has elapsed', () => {
    const oldFire = DTMF_AT;
    const now = oldFire + POST_DTMF_LOOP_WATCHER_MS + 10;
    expect(
      shouldForceReprocess(
        input({
          forcedReprocessFiredAt: oldFire,
          lastDTMFPressedAt: oldFire - 1000,
        }),
        now
      )
    ).toBe(true);
  });

  it('fires at exactly the window boundary (inclusive)', () => {
    expect(
      shouldForceReprocess(input(), DTMF_AT + POST_DTMF_LOOP_WATCHER_MS)
    ).toBe(true);
  });
});

describe('appendInterimSegment / renderAccumulated', () => {
  it('returns initial state when feeding into undefined', () => {
    const state = appendInterimSegment(undefined, seg(0, 1000, 'hello'));
    expect(renderAccumulated(state)).toBe('hello');
  });

  it('replaces same-window revision (Qatar pattern: "press one" → "press 1")', () => {
    // Empirical Deepgram behavior: interim events over the same time window
    // refine number formatting. Pre-PR-#46 string stitching produced
    // "press one press 1" — duplicating the menu prompt. With time-anchored
    // merging the second segment replaces the first.
    let state = clearSegments();
    state = appendInterimSegment(state, seg(0, 2000, 'press one'));
    state = appendInterimSegment(state, seg(0, 2000, 'press 1'));
    expect(renderAccumulated(state)).toBe('press 1');
  });

  it('appends non-overlapping segments in time order', () => {
    let state = clearSegments();
    state = appendInterimSegment(state, seg(0, 2000, 'press 1'));
    state = appendInterimSegment(state, seg(5000, 7000, 'press 2'));
    expect(renderAccumulated(state)).toBe('press 1 press 2');
  });

  it('ignores empty / whitespace-only incoming text', () => {
    let state = appendInterimSegment(undefined, seg(0, 1000, 'press one'));
    state = appendInterimSegment(state, seg(2000, 3000, '   '));
    state = appendInterimSegment(state, seg(2000, 3000, ''));
    expect(renderAccumulated(state)).toBe('press one');
  });

  it('Qatar regression: cascade of progressive revisions does not duplicate', () => {
    // Pre-PR-#46 Costco/Qatar pattern: each progressive interim was a longer
    // revision over the SAME time window. Naive string-concat produced
    // "If you are a member of our If you are a member of our privilege club..."
    // Time-anchored merging keeps a single segment at [0, 4000ms].
    let state = clearSegments();
    state = appendInterimSegment(
      state,
      seg(0, 2000, 'If you are a member of our')
    );
    state = appendInterimSegment(
      state,
      seg(0, 3000, 'If you are a member of our privilege club, press')
    );
    state = appendInterimSegment(
      state,
      seg(0, 4000, 'If you are a member of our privilege club, press 1')
    );
    expect(renderAccumulated(state)).toBe(
      'If you are a member of our privilege club, press 1'
    );
  });
});

describe('resetWatcherFields', () => {
  it('returns all watcher fields cleared (segments form)', () => {
    expect(resetWatcherFields()).toEqual({
      lastDTMFPressedAt: undefined,
      accumulatedInterimSegments: clearSegments(),
      forcedReprocessFiredAt: undefined,
    });
  });
});

describe('DTMF → accumulation → fire scenario', () => {
  it('models the full arming flow: press → interims build → watcher fires once', () => {
    let cs: ShouldForceReprocessInput = {
      lastDTMFPressedAt: 0,
      accumulatedInterimSegments: clearSegments(),
      isSpeaking: false,
    };
    expect(shouldForceReprocess(cs, 0)).toBe(false);

    // t=1000: first interim arrives but is too short.
    cs = {
      ...cs,
      accumulatedInterimSegments: segmentsFromText('welcome'),
    };
    expect(shouldForceReprocess(cs, 1000)).toBe(false);

    // t=3000: accumulator is long enough but window hasn't elapsed.
    cs = {
      ...cs,
      accumulatedInterimSegments: segmentsFromText(
        'welcome to costco press 1 for store hours'
      ),
    };
    expect(shouldForceReprocess(cs, 3000)).toBe(false);

    // t=5000: both conditions met — should fire.
    expect(shouldForceReprocess(cs, 5000)).toBe(true);

    // After firing, set forcedReprocessFiredAt and clear accumulator.
    cs = {
      ...cs,
      forcedReprocessFiredAt: 5000,
      accumulatedInterimSegments: clearSegments(),
    };
    expect(shouldForceReprocess(cs, 5500)).toBe(false);

    // t=11000: accumulator re-grows on a second pass through the same menu
    // loop, dedup window expired → fire again.
    cs = {
      ...cs,
      accumulatedInterimSegments: segmentsFromText(
        'welcome to costco press 1 for store hours'
      ),
    };
    expect(shouldForceReprocess(cs, 11000)).toBe(true);
  });
});
