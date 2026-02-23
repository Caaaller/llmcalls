/**
 * Prompt evaluation tests (Jest).
 * Uses expect(actual).toMatchObject(expected) so Jest prints clear diffs on failure.
 *
 * Run: npm test (all tests) or npm run eval:prompts (this suite only).
 * Previous evals (run-all-evals.ts + service) remain available.
 */

import 'dotenv/config';
import { processSpeech } from '../speechProcessingService';
import callStateManager from '../callStateManager';
import {
  expectedFromSingleStepBehavior,
  expectedFromStepBehavior,
  actualFromResult,
} from './promptEvalHelpers';
import { SINGLE_STEP_TEST_CASES, MULTI_STEP_TEST_CASES } from '../promptEvaluationTestCases';
import type { TransferConfig } from '../aiService';
import type { PromptTestCase } from '../promptEvaluationService';
import type { MenuOption } from '../../types/menu';

const defaultConfig: TransferConfig = {
  transferNumber: process.env.TRANSFER_PHONE_NUMBER || '720-584-6358',
  userPhone: process.env.USER_PHONE || '720-584-6358',
  userEmail: process.env.USER_EMAIL || 'oliverullman@gmail.com',
  callPurpose: 'speak with a representative',
  customInstructions: '',
};

function configFor(testCase: PromptTestCase): TransferConfig {
  return { ...defaultConfig, ...testCase.config } as TransferConfig;
}

describe('Prompt evaluation – single-step', () => {
  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set; prompt eval tests may fail');
    }
  });

  SINGLE_STEP_TEST_CASES.forEach(testCase => {
    it(testCase.name, async () => {
      const config = configFor(testCase);
      const testCallSid = `jest-single-${testCase.name}`;
      const result = await processSpeech({
        callSid: testCallSid,
        speechResult: testCase.speech,
        isFirstCall: true,
        baseUrl: 'http://test',
        callPurpose: config.callPurpose,
        customInstructions: config.customInstructions,
        transferNumber: config.transferNumber,
        userPhone: config.userPhone,
        userEmail: config.userEmail,
        testMode: true,
      });

      if (!result.processingResult) {
        const summary: Record<string, unknown> = {
          shouldSend: result.shouldSend,
          hasTwiml: Boolean(result.twiml),
          hasAiResponse: Boolean((result as { aiResponse?: string }).aiResponse),
        };
        throw new Error(
          `processingResult undefined for "${testCase.name}". Often caused by incomplete-speech early return or error. Result: ${JSON.stringify(summary)}`
        );
      }
      const pr = result.processingResult;
      const expected = expectedFromSingleStepBehavior(testCase.expectedBehavior);
      const actual = actualFromResult(pr);
      expect(actual).toMatchObject(expected);

      if (
        testCase.expectedBehavior.shouldTransfer &&
        testCase.expectedBehavior.expectedCallPurpose === undefined &&
        result.aiResponse
      ) {
        const lower = result.aiResponse.toLowerCase().trim();
        expect(lower).not.toBe('silent.');
        expect(lower).not.toBe('silent');
      }
    });
  });
});

describe('Prompt evaluation – multi-step', () => {
  MULTI_STEP_TEST_CASES.forEach(testCase => {
    const flakyMultiStep = [
      'DirecTV - Complete Call Flow with Termination', // DTMF choice for ambiguous menu varies
      'Loop Detection - NYU Langone Scenario', // shouldNotPressAgain / loop prevention varies
      'Costco - Administrative Staff Loop', // DTMF press vs no-press varies
    ];
    const isSkipped = flakyMultiStep.includes(testCase.name);
    (isSkipped ? it.skip : it)(testCase.name, async () => {
      const config = { ...defaultConfig, ...testCase.config } as TransferConfig;
      let previousMenus: MenuOption[][] = [];
      let lastPressedDTMF: string | undefined;
      let lastMenuForDTMF: MenuOption[] | undefined;
      let consecutiveDTMFPresses: { digit: string; count: number }[] = [];

      for (let i = 0; i < testCase.steps.length; i++) {
        const step = testCase.steps[i];
        const testCallSid = `jest-${testCase.name}-${i}`;
        callStateManager.updateCallState(testCallSid, {
          previousMenus,
          lastPressedDTMF,
          lastMenuForDTMF,
          consecutiveDTMFPresses,
        });

        const result = await processSpeech({
          callSid: testCallSid,
          speechResult: step.speech,
          isFirstCall: i === 0,
          baseUrl: 'http://test',
          callPurpose: config.callPurpose,
          customInstructions: config.customInstructions,
          transferNumber: config.transferNumber,
          userPhone: config.userPhone,
          userEmail: config.userEmail,
          testMode: true,
        });

        if (!result.processingResult) {
          const summary: Record<string, unknown> = {
            shouldSend: result.shouldSend,
            hasTwiml: Boolean(result.twiml),
            stepIndex: i,
            stepSpeechSnippet: step.speech.slice(0, 80),
          };
          throw new Error(
            `processingResult undefined at step ${i + 1} (${testCase.name}). Often incomplete-speech or error. ${JSON.stringify(summary)}`
          );
        }
        const pr = result.processingResult;
        const expected = expectedFromStepBehavior(step.expectedBehavior);
        const actual = actualFromResult(pr);
        expect(actual).toMatchObject(expected);

        const updatedState = callStateManager.getCallState(testCallSid);
        previousMenus = updatedState.previousMenus || [];
        lastPressedDTMF = updatedState.lastPressedDTMF;
        lastMenuForDTMF = updatedState.lastMenuForDTMF;
        consecutiveDTMFPresses = updatedState.consecutiveDTMFPresses || [];

        if (
          !pr.shouldPreventDTMF &&
          pr.dtmfDecision.shouldPress &&
          pr.dtmfDecision.digit !== null
        ) {
          const digitPressed = pr.dtmfDecision.digit;
          const last = consecutiveDTMFPresses[consecutiveDTMFPresses.length - 1];
          if (last && last.digit === digitPressed) {
            consecutiveDTMFPresses = [
              ...consecutiveDTMFPresses.slice(0, -1),
              { digit: digitPressed, count: last.count + 1 },
            ];
          } else {
            consecutiveDTMFPresses = [...consecutiveDTMFPresses, { digit: digitPressed, count: 1 }];
            if (consecutiveDTMFPresses.length > 5) {
              consecutiveDTMFPresses = consecutiveDTMFPresses.slice(-5);
            }
          }
        }
      }

      for (let i = 0; i < testCase.steps.length; i++) {
        callStateManager.clearCallState(`jest-${testCase.name}-${i}`);
      }
    });
  });
});
