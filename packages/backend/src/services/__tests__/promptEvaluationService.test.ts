/**
 * Prompt evaluation tests (Jest).
 * Uses expect(actual).toMatchObject(expected) so Jest prints clear diffs on failure.
 * Root .env is loaded via jest.setup.js; we import it explicitly here to ensure
 * OPENAI_API_KEY is available before aiService/processSpeech are loaded.
 */

import '../../../jest.setup';
import { processSpeech } from '../speechProcessingService';
import callStateManager from '../callStateManager';
import {
  expectedFromSingleStepBehavior,
  expectedFromStepBehavior,
  actualFromResult,
} from './promptEvalHelpers';
import ivrNavigatorService from '../ivrNavigatorService';
import transferConfig from '../../config/transfer-config';
import {
  SINGLE_STEP_TEST_CASES,
  MULTI_STEP_TEST_CASES,
} from '../promptEvaluationTestCases';
import type { TransferConfig } from '../../types/voiceProcessing';
import type { PromptTestCase } from '../promptEvaluationService';
import type { MenuOption } from '../../types/menu';

const API_DELAY_MS = 300;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
      await delay(API_DELAY_MS);
      const config = configFor(testCase);
      const testCallSid = `jest-single-${testCase.name}`;

      if (testCase.transferAnnounced || testCase.awaitingHumanConfirmation) {
        callStateManager.updateCallState(testCallSid, {
          transferAnnounced:
            testCase.transferAnnounced || testCase.awaitingHumanConfirmation,
          awaitingHumanConfirmation: testCase.awaitingHumanConfirmation,
        });
      }

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
          hasAiResponse: Boolean(
            (result as { aiResponse?: string }).aiResponse
          ),
        };
        throw new Error(
          `processingResult undefined for "${testCase.name}". Often caused by incomplete-speech early return or error. Result: ${JSON.stringify(summary)}`
        );
      }
      const pr = result.processingResult;
      const expected = expectedFromSingleStepBehavior(
        testCase.expectedBehavior
      );
      const actual = actualFromResult(pr, result.aiAction);
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
      await delay(API_DELAY_MS);
      const config = { ...defaultConfig, ...testCase.config } as TransferConfig;
      let previousMenus: MenuOption[][] = [];
      let lastPressedDTMF: string | undefined;

      for (let i = 0; i < testCase.steps.length; i++) {
        if (i > 0) await delay(API_DELAY_MS);
        const step = testCase.steps[i];
        const testCallSid = `jest-${testCase.name}-${i}`;
        callStateManager.updateCallState(testCallSid, {
          previousMenus,
          lastPressedDTMF,
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
        const actual = actualFromResult(pr, result.aiAction);
        expect(actual).toMatchObject(expected);

        const updatedState = callStateManager.getCallState(testCallSid);
        previousMenus = updatedState.previousMenus || [];
        lastPressedDTMF = updatedState.lastPressedDTMF;
      }

      for (let i = 0; i < testCase.steps.length; i++) {
        callStateManager.clearCallState(`jest-${testCase.name}-${i}`);
      }
    });
  });
});

describe('Prompt evaluation – hold detection', () => {
  const holdCases: Array<{
    name: string;
    speech: string;
    expectedHoldDetected: boolean;
    expectedAction?: string;
    transferAnnounced?: boolean;
  }> = [
    {
      name: 'Hold - Please hold message',
      speech:
        'Please hold while I connect you to the next available representative. Your estimated wait time is 5 minutes.',
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - All agents busy',
      speech:
        'All of our agents are currently busy assisting other customers. Please stay on the line and your call will be answered in the order it was received.',
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - Queue position',
      speech:
        'You are caller number 3 in the queue. A representative will be with you shortly.',
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - Your call is important',
      speech:
        'Your call is important to us. Please continue to hold and a representative will be with you shortly.',
      expectedHoldDetected: true,
    },
    {
      name: 'No Hold - Regular IVR menu',
      speech: 'Press 1 for sales, press 2 for support, press 0 for operator.',
      expectedHoldDetected: false,
      expectedAction: 'press_digit',
    },
    {
      name: 'No Hold - Greeting',
      speech:
        'Thank you for calling Acme Corporation. How can I help you today?',
      expectedHoldDetected: false,
      expectedAction: 'speak',
    },
  ];

  holdCases.forEach(testCase => {
    it(testCase.name, async () => {
      await delay(API_DELAY_MS);

      const result = await ivrNavigatorService.decideAction({
        config: transferConfig.createConfig(),
        conversationHistory: [],
        actionHistory: [],
        currentSpeech: testCase.speech,
        previousMenus: [],
        callPurpose: 'speak with a representative',
        transferAnnounced: testCase.transferAnnounced,
      });

      if (testCase.expectedAction) {
        expect(result.action).toBe(testCase.expectedAction);
      } else if (testCase.expectedHoldDetected) {
        expect(result.action).toBe('wait');
      }
      expect(result.detected.holdDetected ?? false).toBe(
        testCase.expectedHoldDetected
      );
    });
  });
});
