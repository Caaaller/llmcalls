/**
 * Post-DTMF loop watcher unit tests.
 *
 * Covers the pure `shouldForceReprocess` predicate + the `appendInterim`
 * accumulator helper. Integration with streamRoutes is tested via live
 * call replays (Costco scenario); these tests lock down the gating logic
 * so we can't regress the dedup / isSpeaking / threshold guards.
 */

import {
  appendInterim,
  MIN_ACCUMULATED_CHARS,
  POST_DTMF_LOOP_WATCHER_MS,
  resetWatcherFields,
  shouldForceReprocess,
  ShouldForceReprocessInput,
} from '../postDTMFLoopWatcher';

const DTMF_AT = 1_000_000;
const AFTER_WINDOW = DTMF_AT + POST_DTMF_LOOP_WATCHER_MS + 10;
const BEFORE_WINDOW = DTMF_AT + POST_DTMF_LOOP_WATCHER_MS - 50;

function longText(chars = MIN_ACCUMULATED_CHARS + 5): string {
  return 'x'.repeat(chars);
}

function input(
  overrides: Partial<ShouldForceReprocessInput> = {}
): ShouldForceReprocessInput {
  return {
    lastDTMFPressedAt: DTMF_AT,
    accumulatedInterimText: longText(),
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
          accumulatedInterimText: 'x'.repeat(MIN_ACCUMULATED_CHARS - 1),
        }),
        AFTER_WINDOW
      )
    ).toBe(false);
  });

  it('returns false when accumulated interim is empty or undefined', () => {
    expect(
      shouldForceReprocess(input({ accumulatedInterimText: '' }), AFTER_WINDOW)
    ).toBe(false);
    expect(
      shouldForceReprocess(
        input({ accumulatedInterimText: undefined }),
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
    const oldFire = DTMF_AT; // Fired exactly 5s before "now" = AFTER_WINDOW.
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

describe('appendInterim', () => {
  it('returns the new text when existing is empty', () => {
    expect(appendInterim('', 'hello world')).toBe('hello world');
  });

  it('keeps the longer when new extends existing as prefix', () => {
    expect(appendInterim('press one for', 'press one for billing')).toBe(
      'press one for billing'
    );
  });

  it('keeps the longer when existing extends new as prefix', () => {
    expect(appendInterim('press one for billing', 'press one for')).toBe(
      'press one for billing'
    );
  });

  it('concatenates with a space when texts are unrelated', () => {
    expect(appendInterim('press one', 'for billing')).toBe(
      'press one for billing'
    );
  });

  it('trims and ignores empty new text', () => {
    expect(appendInterim('press one', '   ')).toBe('press one');
    expect(appendInterim('press one', '')).toBe('press one');
  });
});

describe('resetWatcherFields', () => {
  it('returns all watcher fields cleared', () => {
    expect(resetWatcherFields()).toEqual({
      lastDTMFPressedAt: undefined,
      accumulatedInterimText: '',
      forcedReprocessFiredAt: undefined,
    });
  });
});

describe('DTMF → accumulation → fire scenario', () => {
  it('models the full arming flow: press → interims build → watcher fires once', () => {
    // t=0: DTMF pressed, state armed.
    let cs: ShouldForceReprocessInput = {
      lastDTMFPressedAt: 0,
      accumulatedInterimText: '',
      isSpeaking: false,
    };
    expect(shouldForceReprocess(cs, 0)).toBe(false);

    // t=1000: first interim arrives but is too short.
    cs = { ...cs, accumulatedInterimText: 'welcome' };
    expect(shouldForceReprocess(cs, 1000)).toBe(false);

    // t=3000: accumulator is long enough but window hasn't elapsed.
    cs = {
      ...cs,
      accumulatedInterimText: 'welcome to costco press 1 for store hours',
    };
    expect(shouldForceReprocess(cs, 3000)).toBe(false);

    // t=5000: both conditions met — should fire.
    expect(shouldForceReprocess(cs, 5000)).toBe(true);

    // After firing, set forcedReprocessFiredAt and clear accumulator.
    cs = { ...cs, forcedReprocessFiredAt: 5000, accumulatedInterimText: '' };
    // t=5500: dedup window active AND accumulator empty — no fire.
    expect(shouldForceReprocess(cs, 5500)).toBe(false);

    // t=11000: accumulator re-grows on a second pass through the same menu
    // loop, dedup window expired → fire again.
    cs = {
      ...cs,
      accumulatedInterimText: 'welcome to costco press 1 for store hours',
    };
    expect(shouldForceReprocess(cs, 11000)).toBe(true);
  });
});
