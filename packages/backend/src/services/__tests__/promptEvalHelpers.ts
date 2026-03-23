/**
 * Helpers for Jest prompt-eval tests.
 * Build expected/actual in the same shape so we can use expect(actual).toMatchObject(expected).
 */

import type { VoiceProcessingResult } from '../../types/voiceProcessing';

/** Shape used for expect(actual).toMatchObject(expected) */
export interface EvalExpected {
  transferRequested?: boolean;
  shouldConfirmHuman?: boolean;
  shouldTerminate?: boolean;
  terminationReason?: string | null;
  isIVRMenu?: boolean;
  shouldPress?: boolean;
  digit?: string | null;
  loopDetected?: boolean;
  shouldPreventDTMF?: boolean;
}

/** Single-step expectedBehavior from PromptTestCase */
interface SingleStepExpectedBehavior {
  shouldTransfer?: boolean;
  shouldConfirmHuman?: boolean;
  shouldPressDTMF?: boolean;
  expectedDigit?: string;
  shouldTerminate?: boolean;
  terminationReason?: 'voicemail' | 'closed_no_menu' | 'dead_end' | null;
}

/** Multi-step step expectedBehavior */
interface StepExpectedBehavior {
  shouldPressDTMF?: boolean;
  expectedDigit?: string;
  shouldDetectLoop?: boolean;
  shouldNotPressAgain?: boolean;
  shouldTerminate?: boolean;
  terminationReason?: 'voicemail' | 'closed_no_menu' | 'dead_end' | null;
}

export function expectedFromSingleStepBehavior(
  eb: SingleStepExpectedBehavior
): EvalExpected {
  const expected: EvalExpected = {};
  if (eb.shouldTransfer !== undefined)
    expected.transferRequested = eb.shouldTransfer;
  if (eb.shouldConfirmHuman !== undefined)
    expected.shouldConfirmHuman = eb.shouldConfirmHuman;
  if (eb.shouldTerminate !== undefined)
    expected.shouldTerminate = eb.shouldTerminate;
  if (eb.terminationReason !== undefined)
    expected.terminationReason = eb.terminationReason;
  if (eb.shouldPressDTMF !== undefined)
    expected.shouldPress = eb.shouldPressDTMF;
  if (eb.expectedDigit !== undefined) expected.digit = eb.expectedDigit;
  if (eb.shouldPressDTMF === true) expected.isIVRMenu = true;
  return expected;
}

export function expectedFromStepBehavior(
  eb: StepExpectedBehavior
): EvalExpected {
  const expected: EvalExpected = {};
  if (eb.shouldTerminate !== undefined)
    expected.shouldTerminate = eb.shouldTerminate;
  if (eb.terminationReason !== undefined)
    expected.terminationReason = eb.terminationReason;
  if (eb.shouldDetectLoop !== undefined)
    expected.loopDetected = eb.shouldDetectLoop;
  if (eb.shouldNotPressAgain) {
    expected.shouldPreventDTMF = true;
    expected.shouldPress = false;
  } else {
    if (eb.shouldPressDTMF !== undefined)
      expected.shouldPress = eb.shouldPressDTMF;
    if (eb.expectedDigit !== undefined) expected.digit = eb.expectedDigit;
  }
  if (eb.shouldPressDTMF === true) expected.isIVRMenu = true;
  return expected;
}

export function actualFromResult(
  pr: VoiceProcessingResult,
  aiAction?: string
): EvalExpected {
  return {
    transferRequested: pr.transferRequested || aiAction === 'human_detected',
    shouldConfirmHuman: aiAction === 'maybe_human',
    shouldTerminate: pr.shouldTerminate,
    terminationReason: pr.terminationReason ?? undefined,
    isIVRMenu: pr.isIVRMenu,
    shouldPress: pr.shouldPreventDTMF ? false : pr.dtmfDecision.shouldPress,
    digit: pr.dtmfDecision.digit ?? undefined,
    loopDetected: pr.loopDetected,
    shouldPreventDTMF: pr.shouldPreventDTMF,
  };
}
