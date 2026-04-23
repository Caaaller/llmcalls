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
import ivrNavigatorService, { CallAction } from '../ivrNavigatorService';
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

      if (
        testCase.awaitingHumanConfirmation ||
        testCase.awaitingHumanClarification
      ) {
        callStateManager.updateCallState(testCallSid, {
          ...(testCase.awaitingHumanConfirmation && {
            awaitingHumanConfirmation: true,
          }),
          ...(testCase.awaitingHumanClarification && {
            awaitingHumanClarification: true,
            awaitingHumanConfirmation: true,
          }),
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
        requireLiveAgent: testCase.requireLiveAgent,
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
    ];
    const isSkipped = flakyMultiStep.includes(testCase.name);
    (isSkipped ? it.skip : it)(testCase.name, async () => {
      await delay(API_DELAY_MS);
      const config = { ...defaultConfig, ...testCase.config } as TransferConfig;
      const testCallSid = `jest-${testCase.name}`;
      let previousMenus: MenuOption[][] = [];
      let lastPressedDTMF: string | undefined;

      for (let i = 0; i < testCase.steps.length; i++) {
        if (i > 0) await delay(API_DELAY_MS);
        const step = testCase.steps[i];
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

        // Log step details for debugging flakiness
        console.log(
          `  [${testCase.name}] Step ${i + 1}/${testCase.steps.length}:` +
            `\n    Speech: "${step.speech.slice(0, 80)}..."` +
            `\n    AI action: ${result.aiAction}${pr.dtmfDecision.digit ? ` digit=${pr.dtmfDecision.digit}` : ''}` +
            `\n    loopDetected: ${pr.loopDetected}` +
            `\n    isIVRMenu: ${pr.isIVRMenu}` +
            `\n    menuOptions: ${JSON.stringify(pr.menuOptions?.slice(0, 3))}` +
            `\n    previousMenus fed in: ${JSON.stringify(previousMenus)}` +
            `\n    shouldPress: ${pr.dtmfDecision.shouldPress}` +
            `\n    reason: ${pr.dtmfDecision.reason?.slice(0, 120) || 'N/A'}` +
            (Object.keys(expected).some(
              k =>
                (expected as Record<string, unknown>)[k] !==
                (actual as Record<string, unknown>)[k]
            )
              ? `\n    MISMATCH: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
              : '')
        );

        expect(actual).toMatchObject(expected);

        const updatedState = callStateManager.getCallState(testCallSid);
        previousMenus = updatedState.previousMenus || [];
        lastPressedDTMF = updatedState.lastPressedDTMF;
      }

      callStateManager.clearCallState(testCallSid);
    });
  });
});

describe('Prompt evaluation – hold detection', () => {
  const holdCases: Array<{
    name: string;
    speech: string;
    expectedHoldDetected: boolean;
    expectedAction?: string;
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
    {
      name: 'No Hold - Welcome message with name',
      speech: 'Welcome to Verizon.',
      expectedHoldDetected: false,
    },
    {
      name: 'No Hold - Data entry prompt',
      speech: 'To better serve you, please enter your five digit ZIP code.',
      expectedHoldDetected: false,
    },
    {
      name: 'No Hold - IVR menu mentions "hold" as an option',
      speech: 'To place your call on hold, press 1. To continue, press 2.',
      expectedHoldDetected: false,
      expectedAction: 'press_digit',
    },
    {
      name: 'No Hold - Short transition after hold ended',
      speech:
        'To track the status of a package, report a package delivery issue, or inquire about a service request, press 1.',
      expectedHoldDetected: false,
      expectedAction: 'press_digit',
    },
    {
      name: 'No Hold - Welcome + monitoring disclaimer (Wells Fargo)',
      speech:
        'Welcome to Wells Fargo. This call may be recorded, monitored, or analyzed by Wells Fargo and its service providers.',
      expectedHoldDetected: false,
    },
    {
      name: 'No Hold - Monitoring disclaimer alone',
      speech:
        'This call may be recorded or monitored for quality assurance purposes.',
      expectedHoldDetected: false,
    },
    {
      name: 'Hold - AT&T "let me find someone"',
      speech:
        'Let me find someone to help you. One moment please while I handle your request.',
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - AT&T "one moment while I get an agent"',
      speech: 'One moment while I get an agent to help you.',
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - Voicebot "I\'ll transfer you"',
      speech: "I'll transfer you now.",
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - Voicebot "let me connect you"',
      speech: 'Let me connect you to a representative.',
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - bare "One moment please" (voicebot fetching agent)',
      speech: 'One moment please.',
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - "Just a moment"',
      speech: 'Just a moment.',
      expectedHoldDetected: true,
    },
    {
      name: 'Hold - "Hang tight"',
      speech: 'Hang tight while I look into that.',
      expectedHoldDetected: true,
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

  it('Hold detection returns wait action', async () => {
    await delay(API_DELAY_MS);
    const testCallSid = 'jest-hold-wait-action';

    const result = await processSpeech({
      callSid: testCallSid,
      speechResult:
        'Please hold while we connect you to the next available representative. Your estimated wait time is 3 minutes.',
      isFirstCall: true,
      baseUrl: 'http://test',
      callPurpose: 'speak with a representative',
      transferNumber: defaultConfig.transferNumber,
      userPhone: defaultConfig.userPhone,
      userEmail: defaultConfig.userEmail,
      testMode: true,
    });

    expect(result.aiAction).toBe('wait');
    callStateManager.clearCallState(testCallSid);
  });

  it('Human speech after hold returns maybe_human to trigger mandatory confirmation', async () => {
    await delay(API_DELAY_MS);
    const testCallSid = 'jest-hold-then-human';

    // Step 1: Hold speech - AI should return wait action
    const holdResult = await processSpeech({
      callSid: testCallSid,
      speechResult:
        'Please hold while we connect you to the next available representative.',
      isFirstCall: true,
      baseUrl: 'http://test',
      callPurpose: 'speak with a representative',
      transferNumber: defaultConfig.transferNumber,
      userPhone: defaultConfig.userPhone,
      userEmail: defaultConfig.userEmail,
      testMode: true,
    });

    expect(holdResult.aiAction).toBe('wait');

    await delay(API_DELAY_MS);

    // Step 2: Human speech with a clear personal intro → maybe_human so we ask
    // the confirmation question before transferring.
    const result = await processSpeech({
      callSid: testCallSid,
      speechResult:
        'Hi, this is Sarah from customer service. How can I help you today?',
      isFirstCall: false,
      baseUrl: 'http://test',
      callPurpose: 'speak with a representative',
      transferNumber: defaultConfig.transferNumber,
      userPhone: defaultConfig.userPhone,
      userEmail: defaultConfig.userEmail,
      testMode: true,
    });

    expect(result.aiAction).toBe('maybe_human');
    callStateManager.clearCallState(testCallSid);
  });
});

describe('Transfer confirmation gate', () => {
  // Force decideAction to return human_detected so we can test the structural
  // gate in processSpeech deterministically — independent of AI judgment.
  function makeHumanDetectedAction(
    speech: string,
    humanIntroDetected = false
  ): CallAction {
    return {
      action: 'human_detected',
      reason: `forced human_detected for test on speech: "${speech.slice(0, 60)}"`,
      detected: {
        isIVRMenu: false,
        menuOptions: [],
        isMenuComplete: false,
        loopDetected: false,
        shouldTerminate: false,
        transferRequested: false,
        humanIntroDetected,
      },
    };
  }

  let decideActionSpy: jest.SpyInstance;

  afterEach(() => {
    decideActionSpy?.mockRestore();
  });

  it('downgrades human_detected to maybe_human on first-turn greeting without confirmation pending', async () => {
    const testCallSid = 'jest-gate-no-confirmation-greeting';
    decideActionSpy = jest
      .spyOn(ivrNavigatorService, 'decideAction')
      .mockResolvedValue(
        makeHumanDetectedAction(
          'Thank you for calling Acme. This is Sarah, how can I help you?',
          true
        )
      );

    const result = await processSpeech({
      callSid: testCallSid,
      speechResult:
        'Thank you for calling Acme. This is Sarah, how can I help you?',
      isFirstCall: true,
      baseUrl: 'http://test',
      callPurpose: 'speak with a representative',
      transferNumber: defaultConfig.transferNumber,
      userPhone: defaultConfig.userPhone,
      userEmail: defaultConfig.userEmail,
      testMode: true,
    });

    expect(result.aiAction).toBe('maybe_human');
    const state = callStateManager.getCallState(testCallSid);
    expect(state.transferInitiated).not.toBe(true);
    callStateManager.clearCallState(testCallSid);
  });

  it('allows human_detected to transfer when awaitingHumanConfirmation is set', async () => {
    const testCallSid = 'jest-gate-confirmation-pending';
    callStateManager.updateCallState(testCallSid, {
      awaitingHumanConfirmation: true,
    });

    decideActionSpy = jest
      .spyOn(ivrNavigatorService, 'decideAction')
      .mockResolvedValue(makeHumanDetectedAction('Yes I am a live agent'));

    const result = await processSpeech({
      callSid: testCallSid,
      speechResult: 'Yes I am a live agent',
      isFirstCall: false,
      baseUrl: 'http://test',
      callPurpose: 'speak with a representative',
      transferNumber: defaultConfig.transferNumber,
      userPhone: defaultConfig.userPhone,
      userEmail: defaultConfig.userEmail,
      testMode: true,
    });

    expect(result.aiAction).toBe('human_detected');
    callStateManager.clearCallState(testCallSid);
  });

  it('downgrades human_detected on menu-sounding speech without confirmation pending', async () => {
    const testCallSid = 'jest-gate-menu-no-confirmation';
    decideActionSpy = jest
      .spyOn(ivrNavigatorService, 'decideAction')
      .mockResolvedValue(
        makeHumanDetectedAction(
          'Press 1 for sales, press 2 for support, press 0 for operator'
        )
      );

    const result = await processSpeech({
      callSid: testCallSid,
      speechResult:
        'Press 1 for sales, press 2 for support, press 0 for operator',
      isFirstCall: true,
      baseUrl: 'http://test',
      callPurpose: 'speak with a representative',
      transferNumber: defaultConfig.transferNumber,
      userPhone: defaultConfig.userPhone,
      userEmail: defaultConfig.userEmail,
      testMode: true,
    });

    expect(result.aiAction).toBe('maybe_human');
    const state = callStateManager.getCallState(testCallSid);
    expect(state.transferInitiated).not.toBe(true);
    callStateManager.clearCallState(testCallSid);
  });
});
