/**
 * Barge-in decision logic + telnyxService.stopSpeak wiring.
 *
 * The shouldBargeIn helper is pure (no Telnyx calls), so we test it directly
 * with hand-rolled state + transcript/now inputs.
 */

import type { CallState } from '../callStateManager';
import {
  shouldBargeIn,
  BARGE_IN_POST_START_LOCKOUT_MS,
} from '../bargeInService';

type BargeState = Pick<
  CallState,
  'isSpeaking' | 'lastSpeakStartedAt' | 'bargeInFiredThisTurn'
>;

function makeState(overrides: Partial<BargeState> = {}): BargeState {
  return {
    isSpeaking: true,
    lastSpeakStartedAt: 1_000_000,
    bargeInFiredThisTurn: false,
    ...overrides,
  };
}

describe('shouldBargeIn', () => {
  const START = 1_000_000;
  const AFTER_LOCKOUT = START + BARGE_IN_POST_START_LOCKOUT_MS + 50;

  it('does NOT fire within the post-start lockout window', () => {
    expect(
      shouldBargeIn(
        makeState({ lastSpeakStartedAt: START }),
        'hello there',
        START + 200
      )
    ).toBe(false);
  });

  it('does NOT fire on a single-word interim (uh / um / okay)', () => {
    expect(
      shouldBargeIn(
        makeState({ lastSpeakStartedAt: START }),
        'uh',
        AFTER_LOCKOUT
      )
    ).toBe(false);
    expect(
      shouldBargeIn(
        makeState({ lastSpeakStartedAt: START }),
        'okay',
        AFTER_LOCKOUT
      )
    ).toBe(false);
  });

  it('FIRES on a 2+ word interim after the lockout', () => {
    expect(
      shouldBargeIn(
        makeState({ lastSpeakStartedAt: START }),
        'hey wait',
        AFTER_LOCKOUT
      )
    ).toBe(true);
    expect(
      shouldBargeIn(
        makeState({ lastSpeakStartedAt: START }),
        'can I help you with',
        AFTER_LOCKOUT
      )
    ).toBe(true);
  });

  it('does NOT double-fire within the same AI utterance', () => {
    expect(
      shouldBargeIn(
        makeState({
          lastSpeakStartedAt: START,
          bargeInFiredThisTurn: true,
        }),
        'still talking here',
        AFTER_LOCKOUT
      )
    ).toBe(false);
  });

  it('does NOT fire when AI is not currently speaking', () => {
    expect(
      shouldBargeIn(
        makeState({ isSpeaking: false, lastSpeakStartedAt: START }),
        'hey wait',
        AFTER_LOCKOUT
      )
    ).toBe(false);
  });

  it('does NOT fire when lastSpeakStartedAt is unset', () => {
    expect(
      shouldBargeIn(
        makeState({ lastSpeakStartedAt: undefined }),
        'hey wait',
        AFTER_LOCKOUT
      )
    ).toBe(false);
  });

  it('ignores extra whitespace when counting words', () => {
    expect(
      shouldBargeIn(
        makeState({ lastSpeakStartedAt: START }),
        '   hey    wait   ',
        AFTER_LOCKOUT
      )
    ).toBe(true);
  });
});

// ── telnyxService.stopSpeak wiring ─────────────────────────────────────────

const stopPlayback = jest.fn().mockResolvedValue(undefined);

jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    calls: {
      actions: {
        // Only stopPlayback is exercised in this suite; other actions are
        // covered by telnyxGuard.test.ts.
        stopPlayback: (...args: unknown[]) => stopPlayback(...args),
      },
    },
  }));
});

process.env.TELNYX_API_KEY = 'test';
process.env.TELNYX_PHONE_NUMBER = '+15555551212';

// Import AFTER mocks + env
import callStateManager from '../callStateManager';
import telnyxService from '../telnyxService';

describe('telnyxService.stopSpeak', () => {
  const CALL_SID = 'barge-in-call-sid';

  beforeEach(() => {
    stopPlayback.mockClear();
  });

  it('calls stopPlayback with stop=current when call is live', async () => {
    jest.spyOn(callStateManager, 'isCallEnded').mockReturnValue(false);
    await telnyxService.stopSpeak(CALL_SID);
    expect(stopPlayback).toHaveBeenCalledTimes(1);
    expect(stopPlayback).toHaveBeenCalledWith(CALL_SID, { stop: 'current' });
  });

  it('no-ops when the call has already ended (guardedAction)', async () => {
    jest.spyOn(callStateManager, 'isCallEnded').mockReturnValue(true);
    await telnyxService.stopSpeak(CALL_SID);
    expect(stopPlayback).not.toHaveBeenCalled();
  });
});
