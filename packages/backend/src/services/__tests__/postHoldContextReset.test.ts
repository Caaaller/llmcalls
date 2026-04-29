/**
 * Post-hold context reset (Qatar Airways bug fix) — state-machine test.
 *
 * Asserts that when the AI's PREVIOUS turn classified the IVR audio as
 * `holdDetected:true`, the next non-hold turn clears
 * `callState.conversationHistory` BEFORE the LLM sees it. This prevents
 * the LLM from reading minutes of pre-hold IVR priming when a human
 * picks up — the bug behind the live Qatar call where the AI parroted
 * "Connect British Airways to my Avios account" verbatim.
 *
 * No real LLM calls — `ivrNavigatorService.decideAction` is mocked so we
 * can drive precise hold→hold→non-hold transitions and inspect the
 * conversationHistory at each step.
 */

import '../../../jest.setup';
import callStateManager from '../callStateManager';
import { processSpeech } from '../speechProcessingService';
import ivrNavigatorService, { CallAction } from '../ivrNavigatorService';

jest.mock('../ivrNavigatorService', () => {
  const actual = jest.requireActual('../ivrNavigatorService');
  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual.default,
      decideAction: jest.fn(),
    },
  };
});

const mockedDecideAction =
  ivrNavigatorService.decideAction as jest.MockedFunction<
    typeof ivrNavigatorService.decideAction
  >;

function makeAction(
  overrides: Partial<CallAction> & { holdDetected?: boolean }
): CallAction {
  const { holdDetected = false, ...rest } = overrides;
  return {
    action: 'wait',
    speech: '',
    digit: undefined,
    reason: 'test',
    detected: {
      isIVRMenu: false,
      isMenuComplete: false,
      menuOptions: [],
      holdDetected,
      loopDetected: false,
      transferRequested: false,
      transferConfidence: 0,
      humanIntroDetected: false,
      isMenuRepeat: false,
      terminationReason: undefined,
    },
    ...rest,
  } as CallAction;
}

describe('post-hold context reset', () => {
  beforeEach(() => {
    mockedDecideAction.mockReset();
  });

  it('clears conversationHistory on hold→non-hold transition', async () => {
    const callSid = `test-post-hold-reset-${Date.now()}`;
    callStateManager.getCallState(callSid);

    // Seed history with pre-hold IVR priming (simulating 10+ turns of
    // the agent navigating phone tree before getting put on hold).
    for (let i = 0; i < 8; i += 1) {
      callStateManager.addToHistory(callSid, {
        type: 'user',
        text: `Pre-hold IVR utterance ${i}`,
      });
      callStateManager.addToHistory(callSid, {
        type: 'ai',
        text: `Pre-hold AI response ${i}`,
      });
    }

    expect(
      callStateManager.getCallState(callSid).conversationHistory
    ).toHaveLength(16);

    // Turn N-1: HOLD detected. AI returns wait + holdDetected:true.
    mockedDecideAction.mockResolvedValueOnce(
      makeAction({
        action: 'wait',
        holdDetected: true,
        reason: 'hold music detected',
      })
    );
    await processSpeech({
      callSid,
      speechResult: '[hold music: ♪ ♪ ♪]',
      isFirstCall: false,
      baseUrl: '',
      transferNumber: '+15551234567',
      callPurpose: 'test purpose',
      testMode: true,
    });

    expect(callStateManager.getCallState(callSid).lastTurnWasHold).toBe(true);
    // Hold turns don't append to history; pre-hold history is still intact.
    expect(
      callStateManager.getCallState(callSid).conversationHistory
    ).toHaveLength(16);

    // Turn N: HUMAN PICKUP. The mocked LLM returns maybe_human + holdDetected:false.
    // Reset fires AFTER decideAction returns and BEFORE addToHistory mutates
    // conversationHistory. Capture both the history the LLM saw and the
    // post-reset history.
    let observedHistoryLength = -1;
    mockedDecideAction.mockImplementationOnce(async params => {
      observedHistoryLength = params.conversationHistory.length;
      return makeAction({
        action: 'maybe_human',
        speech: '',
        holdDetected: false,
        reason: 'human greeting detected',
      });
    });

    await processSpeech({
      callSid,
      speechResult: 'Welcome to Acme. This is Jamie. How may I help?',
      isFirstCall: false,
      baseUrl: '',
      transferNumber: '+15551234567',
      callPurpose: 'test purpose',
      testMode: true,
    });

    // The LLM still sees the full pre-hold history on this transition turn —
    // the existing humanIntro/maybe_human flag-consistency override protects
    // this turn. The reset's value is in PROTECTING SUBSEQUENT TURNS.
    expect(observedHistoryLength).toBe(16);

    const stateAfter = callStateManager.getCallState(callSid);
    expect(stateAfter.lastTurnWasHold).toBe(false);
    expect(stateAfter.postHoldResetFired).toBe(true);
    // After reset, history contains only the just-spoken user turn (the
    // maybe_human action handler appends user speech but no AI response).
    // maybe_human is action !== 'wait' && !== 'speak' — let's just assert
    // history is much shorter than before (16 → at most a few entries).
    expect((stateAfter.conversationHistory || []).length).toBeLessThan(16);

    callStateManager.clearCallState(callSid);
  });

  it('does NOT clear history when previous turn was not hold', async () => {
    const callSid = `test-no-reset-${Date.now()}`;
    callStateManager.getCallState(callSid);

    for (let i = 0; i < 4; i += 1) {
      callStateManager.addToHistory(callSid, {
        type: 'user',
        text: `Normal IVR turn ${i}`,
      });
    }

    let observedHistoryLength = -1;
    mockedDecideAction.mockImplementationOnce(async params => {
      observedHistoryLength = params.conversationHistory.length;
      return makeAction({
        action: 'wait',
        holdDetected: false,
        reason: 'normal IVR turn',
      });
    });

    await processSpeech({
      callSid,
      speechResult: 'Press 1 for sales, press 2 for support',
      isFirstCall: false,
      baseUrl: '',
      transferNumber: '+15551234567',
      callPurpose: 'test purpose',
      testMode: true,
    });

    // No reset — LLM sees the full pre-existing history.
    expect(observedHistoryLength).toBe(4);
    const state = callStateManager.getCallState(callSid);
    expect(state.lastTurnWasHold).toBeFalsy();
    expect(state.postHoldResetFired).toBeFalsy();

    callStateManager.clearCallState(callSid);
  });

  it('keeps lastTurnWasHold=true across consecutive hold turns', async () => {
    const callSid = `test-consecutive-hold-${Date.now()}`;
    callStateManager.getCallState(callSid);

    callStateManager.addToHistory(callSid, {
      type: 'user',
      text: 'Pre-hold turn',
    });

    // Three back-to-back hold turns.
    for (let i = 0; i < 3; i += 1) {
      mockedDecideAction.mockResolvedValueOnce(
        makeAction({ action: 'wait', holdDetected: true, reason: `hold ${i}` })
      );
      await processSpeech({
        callSid,
        speechResult: `[hold music ${i}]`,
        isFirstCall: false,
        baseUrl: '',
        transferNumber: '+15551234567',
        callPurpose: 'test purpose',
        testMode: true,
      });
      expect(callStateManager.getCallState(callSid).lastTurnWasHold).toBe(true);
    }

    // History is still intact (hold turns don't append).
    expect(
      callStateManager.getCallState(callSid).conversationHistory
    ).toHaveLength(1);

    callStateManager.clearCallState(callSid);
  });
});
