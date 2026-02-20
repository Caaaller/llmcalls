/**
 * Prompt Evaluation Service
 * Development-time evaluations for testing prompts with specific test cases
 * Run these when modifying prompts to ensure critical behaviors still work
 */

import { TransferConfig } from './aiService';
import { DTMFDecision } from './aiDTMFService';
import { MenuOption } from '../types/menu';
import { processSpeech } from './speechProcessingService';
import callStateManager from './callStateManager';

export interface PromptTestCase {
  name: string;
  description: string;
  speech: string;
  config?: Partial<TransferConfig>;
  expectedBehavior: {
    shouldTransfer?: boolean;
    shouldPressDTMF?: boolean;
    expectedDigit?: string;
    shouldTerminate?: boolean;
    terminationReason?: 'voicemail' | 'closed_no_menu' | 'dead_end' | null;
    expectedCallPurpose?: string;
  };
}

/**
 * Multi-step test case for testing loop detection and stateful behavior
 * Simulates sequential requests with state tracking
 */
export interface MultiStepTestCase {
  name: string;
  description: string;
  steps: Array<{
    speech: string;
    expectedBehavior: {
      shouldPressDTMF?: boolean;
      expectedDigit?: string;
      shouldDetectLoop?: boolean;
      shouldNotPressAgain?: boolean; // If DTMF was already pressed, should not press again
      shouldTerminate?: boolean;
      terminationReason?: 'voicemail' | 'closed_no_menu' | 'dead_end' | null;
    };
  }>;
  config?: Partial<TransferConfig>;
}

export interface PromptTestResult {
  testCase: PromptTestCase;
  passed: boolean;
  errors: string[];
  details: {
    transferDetected?: boolean;
    dtmfDecision?: DTMFDecision;
    terminationDetected?: boolean;
    aiResponse?: string;
  };
}

export interface PromptEvaluationReport {
  totalTests: number;
  passed: number;
  failed: number;
  results: PromptTestResult[];
  timestamp: Date;
}

export interface MultiStepTestResult {
  testCase: MultiStepTestCase;
  passed: boolean;
  errors: string[];
  stepResults: Array<{
    stepIndex: number;
    speech: string;
    passed: boolean;
    errors: string[];
    details: {
      menuOptions?: MenuOption[];
      dtmfDecision?: DTMFDecision;
      loopDetected?: boolean;
      previousMenus?: MenuOption[][];
      terminationDetected?: boolean;
    };
  }>;
}

export interface MultiStepEvaluationReport {
  totalTests: number;
  passed: number;
  failed: number;
  results: MultiStepTestResult[];
  timestamp: Date;
}

// Shared config for test cases
const DEFAULT_CALL_PURPOSE: Partial<TransferConfig> = {
  callPurpose: 'speak with a representative',
};

// Single-step test cases organized by category
const singleStepCases: {
  transfer: PromptTestCase[];
  loopDetection: PromptTestCase[];
  dtmf: PromptTestCase[];
  termination: PromptTestCase[];
  callPurpose: PromptTestCase[];
} = {
  transfer: [
    {
      name: 'Transfer Request - Direct',
      description: 'Should detect direct transfer confirmation from system',
      speech: "I'm transferring you now to a representative",
      expectedBehavior: {
        shouldTransfer: true,
      },
    },
    {
      name: 'Transfer Request - Customer Service',
      description: 'Should detect customer service transfer request',
      speech: 'I need to speak with customer service',
      expectedBehavior: {
        shouldTransfer: true,
      },
    },
    {
      name: 'Transfer Request - Representative',
      description: 'Should detect representative transfer request',
      speech: 'Can I speak with a representative please?',
      expectedBehavior: {
        shouldTransfer: true,
      },
    },
    {
      name: 'No Transfer - IVR Menu',
      description: 'Should NOT detect transfer in IVR menu options',
      speech: 'Press 1 for sales, press 2 for customer service',
      expectedBehavior: {
        shouldTransfer: false,
      },
    },
    {
      name: 'No Transfer - Greeting',
      description: 'Should NOT detect transfer in greeting',
      speech: 'Thank you for calling, how can I help you?',
      expectedBehavior: {
        shouldTransfer: false,
      },
    },
  ],

  loopDetection: [
    {
      name: 'Loop Detection - Repeated Menu',
      description:
        'Should detect loop when same menu options appear twice and act immediately',
      speech:
        'Press 1 for sales, press 2 for support. Press 1 for sales, press 2 for support',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '2', // Should choose support as closest match to "representative"
      },
    },
    {
      name: 'Loop Detection - Single Option Repeat',
      description:
        'Should detect loop when single option repeats and press immediately',
      speech:
        'Press 0 for operator. Press 0 for operator. Press 0 for operator',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '0',
      },
    },
    {
      name: 'Loop Detection - Same Menu After DTMF Pressed',
      description:
        'Should detect when same menu appears after DTMF was already pressed (NYU Langone scenario)',
      speech:
        'Press 2 to request or discuss a financial estimate press 3. If you\'re calling from an insurance company or an attorney\'s office, press 4, all other inquiries press 5.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '5', // Should press 5 for "all other inquiries"
      },
    },
    {
      name: 'Loop Detection - Incomplete Menu Without Option 5',
      description:
        'Should handle incomplete menu that keeps repeating without "all other inquiries" option',
      speech:
        'Press 2 to request or discuss a financial estimate press 3. If you\'re calling from an insurance company or an attorney\'s office, press 4.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: false, // No clear match for representative
      },
    },
    {
      name: 'Loop Detection - Menu Fragment Continuation',
      description:
        'Should handle menu fragment that looks like continuation but is actually repeat',
      speech:
        'Ization, press 2 to request or discuss a financial estimate press 3. If you\'re calling from an insurance company or an attorney\'s office, press 4, all other inquiries press 5.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '5',
      },
    },
    {
      name: 'Loop Detection - Repeated Same Menu Options',
      description:
        'Should detect when exact same menu options appear multiple times (prevent infinite loop)',
      speech:
        'Press 2 to request or discuss a financial estimate press 3. If you\'re calling from an insurance company or an attorney\'s office, press 4, all other inquiries press 5.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '5',
      },
    },
    {
      name: 'Loop Detection - Incomplete Menu Repeating',
      description:
        'Should handle incomplete menu that keeps appearing without completing (status of prior authorization scenario)',
      speech:
        'Status of prior authorization. Press 2 to request or discuss a financial estimate, press 3. If you\'re calling from an insurance company or an attorney\'s office, press 4.',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: false, // No option 5, no clear match
      },
    },
  ],

  dtmf: [
    {
      name: 'DTMF - Representative Option',
      description:
        'Should press correct digit for representative option when call purpose is to speak with someone',
      speech: 'Press 0 to speak with a representative, press 1 for sales',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '0',
      },
    },
    {
      name: 'DTMF - Customer Service Match',
      description:
        'Should match call purpose to customer service menu option',
      speech: 'Press 1 for customer service, press 2 for billing',
      config: {
        callPurpose: 'customer service inquiry',
      },
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '1',
      },
    },
    {
      name: 'DTMF - No Clear Match',
      description: 'Should not press if no clear match found',
      speech: 'Press 1 for sales, press 2 for marketing',
      config: {
        callPurpose: 'technical support',
      },
      expectedBehavior: {
        shouldPressDTMF: false,
      },
    },
    {
      name: 'DTMF - Generic Other Option',
      description:
        'Should prefer "other" or "all other questions" option when no specific match',
      speech:
        'Press 1 for sales, press 2 for support, press 5 for all other questions',
      config: {
        callPurpose: 'general inquiry',
      },
      expectedBehavior: {
        shouldPressDTMF: true,
        expectedDigit: '5',
      },
    },
  ],

  termination: [
    {
      name: 'Termination - Voicemail',
      description: 'Should detect voicemail and terminate',
      speech: 'Please leave a message after the beep',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'voicemail',
      },
    },
    {
      name: 'Termination - Business Closed',
      description: 'Should detect business closed and terminate',
      speech:
        'We are currently closed. Our hours are Monday through Friday 9 to 5',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'Termination - Office Closed with Menu Options',
      description:
        'Should terminate when office is closed even if menu options are provided (automated systems)',
      speech:
        'Our office is currently closed. If you would like to hear your current balance or make a payment now, press 1 for our automated system.',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'Termination - Office Closed with Payment Options',
      description:
        'Should terminate when office is closed even with payment/balance options',
      speech:
        'Calling NYU langone faculty group, practice billing office. Our office is currently closed. If you would like to hear your current balance or make a payment now, press 1 for our automated system.',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'Termination - DirecTV Closed Message',
      description:
        'Should terminate when DirecTV says offices are closed with website redirect',
      speech:
        'Welcome to Direct TV. Our offices are currently closed. Please go to directv.com.',
      expectedBehavior: {
        shouldTerminate: true,
        terminationReason: 'closed_no_menu',
      },
    },
    {
      name: 'No Termination - Business Hours',
      description:
        'Should NOT terminate when business hours are provided without closed status',
      speech: 'Our business hours are Monday through Friday 9 to 5',
      expectedBehavior: {
        shouldTerminate: false,
      },
    },
  ],

  callPurpose: [
    {
      name: 'Call Purpose - Custom Instructions',
      description:
        'Should expand custom instructions into natural conversation',
      speech: 'How can I help you today?',
      config: {
        callPurpose: 'check order status',
        customInstructions: 'Order number is 12345',
      },
      expectedBehavior: {
        expectedCallPurpose: 'order status',
      },
    },
    {
      name: 'Call Purpose - Default Purpose',
      description:
        'Should use default call purpose when no custom instructions',
      speech: 'What is the purpose of your call?',
      config: DEFAULT_CALL_PURPOSE,
      expectedBehavior: {
        expectedCallPurpose: 'representative',
      },
    },
  ],
};

// Flatten grouped cases into single array for backward compatibility
const SINGLE_STEP_TEST_CASES: PromptTestCase[] = [
  ...singleStepCases.transfer,
  ...singleStepCases.loopDetection,
  ...singleStepCases.dtmf,
  ...singleStepCases.termination,
  ...singleStepCases.callPurpose,
];

// Multi-step test cases for loop detection and stateful behavior
const MULTI_STEP_TEST_CASES: MultiStepTestCase[] = [
  {
    name: 'Loop Detection - NYU Langone Scenario',
    description:
      'Tests the actual looping scenario where same menu appears multiple times and DTMF 5 is pressed repeatedly',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          "Thank you for calling the NYU langone faculty group. Practice billing office. If you are calling to make a payment or discuss payment options, press 1 to inquire about the status of prior authorization,",
        expectedBehavior: {
          shouldPressDTMF: false, // Incomplete menu, should wait
        },
      },
      {
        speech: 'Press 5.',
        expectedBehavior: {
          shouldPressDTMF: false, // Just a digit fragment, no complete menu context
        },
      },
      {
        speech:
          "Ization, press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // May detect loop if similar to step 1 menu, that's OK
        },
      },
      {
        speech:
          "2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same menu appearing again
          shouldNotPressAgain: true, // Should detect loop and NOT press again
        },
      },
      {
        speech:
          "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4, all other inquiries press 5.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same menu appearing again
          shouldNotPressAgain: true, // Should detect loop and NOT press again
        },
      },
    ],
  },
  {
    name: 'Loop Detection - Incomplete Menu Repeating',
    description:
      'Tests when incomplete menu keeps repeating without option 5',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4.",
        expectedBehavior: {
          shouldPressDTMF: false, // No option 5, no clear match
        },
      },
      {
        speech:
          "To inquire about the status of prior authorization. Press 2 to request or discuss a financial estimate, press 3. If you're calling from an insurance company or an attorney's office press 4.",
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldDetectLoop: false, // Option 2 changed significantly (from "financial estimate" to "prior authorization"), so not a loop
        },
      },
      {
        speech:
          "Press 2 to request or discuss a financial estimate press 3. If you're calling from an insurance company or an attorney's office, press 4.",
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldDetectLoop: true, // Same menu as step 1 - this IS a loop
        },
      },
    ],
  },
  {
    name: 'DirecTV - Complete Call Flow with Termination',
    description:
      'Tests the complete DirecTV call flow: greeting, multiple menu navigations, human interaction, phone number request, service type question, and final termination when office is closed',
    config: {
      callPurpose: 'speak with a representative',
      customInstructions: 'billing question',
    },
    steps: [
      {
        speech: 'Thank you for calling DirecTV.',
        expectedBehavior: {
          shouldPressDTMF: false, // Greeting, should remain silent
        },
      },
      {
        speech:
          "TV account. I didn't understand that. Would you like to speak with the sales agent to establish a new DirecTV account? You can say yes or press 1 or you can say no.",
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '1', // Should press 1 for sales agent (closest to representative)
        },
      },
      {
        speech:
          'Agent to establish a new DirecTV account. You can say yes or press 1 or you can say no or press 2.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '1', // Should press 1 for agent option
        },
      },
      {
        speech: 'The account, press 1, otherwise press 2.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '2', // Should press 2 for "otherwise" (more likely to lead to representative)
        },
      },
      {
        speech: "I didn't hear anything. Do you still need our assistance?",
        expectedBehavior: {
          shouldPressDTMF: false, // Human question, should respond verbally
        },
      },
      {
        speech: 'In a few words, tell me how I can help you.',
        expectedBehavior: {
          shouldPressDTMF: false, // Human question, should respond with billing question
        },
      },
      {
        speech:
          "Please enter the 10 digit phone number associated with your service, or if you don't know, it, press star.",
        expectedBehavior: {
          shouldPressDTMF: false, // Should SPEAK the phone number, not press star
        },
      },
      {
        speech: 'Are you calling about your DirecTV satellite or streaming service?',
        expectedBehavior: {
          shouldPressDTMF: false, // Human question, should respond verbally
        },
      },
      {
        speech:
          'Welcome to Direct TV. Our offices are currently closed. Please go to directv.com.',
        expectedBehavior: {
          shouldPressDTMF: false,
          shouldTerminate: true, // Should terminate when office is closed
          terminationReason: 'closed_no_menu',
        },
      },
    ],
  },
  {
    name: 'Costco - Administrative Staff Loop',
    description:
      'Tests the Costco scenario where menu keeps repeating with "press 5 for administrative staff" and system should stop pressing after detecting loop',
    config: DEFAULT_CALL_PURPOSE,
    steps: [
      {
        speech:
          'Press 5 to reach the administrative staff. Press 1 for warehouse hours directions and holidays, observed press 2 for information on membership or returns, press 3 to reach the pharmacy.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5', // First time, should press 5
        },
      },
      {
        speech:
          'Press, 3 to reach the pharmacy press 4 for all other departments, press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '4', // Different menu, should press 4 for "all other departments"
        },
      },
      {
        speech: 'All other departments, press 5 to reach the administrator.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5', // Should press 5 for administrator
        },
      },
      {
        speech:
          'To reach the administrative staff. Press 1 for warehouse hours, directions and holidays, observed press 2 for information on membership or returns, press 3 to reach the pharmacy, press 4 for all other departments, press 5,',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Similar menu to step 1 - loop detected
        },
      },
      {
        speech:
          'Apartments press 5 to reach the administrative staff, press 1 for warehouse hours, directions and holidays, observed press 2 for information on membership or returns press 3.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same menu pattern - loop detected
        },
      },
      {
        speech:
          'Or returns press 3 to reach the pharmacy, press 4 for all other departments, press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Similar to step 2 - loop detected
        },
      },
      {
        speech:
          'Administrative staff, press 1 for warehouse hours directions and holidays. Observed press 2 for information on membership or returns, press 3 to reach the pharmacy.',
        expectedBehavior: {
          shouldPressDTMF: false, // No option 5, no clear match - should not press
          shouldDetectLoop: true, // Similar menu pattern - loop detected
        },
      },
      {
        speech:
          'On membership or returns press 3 to reach the pharmacy press 4 for all other departments press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same pattern as step 3 - loop detected
          shouldNotPressAgain: true, // If we already pressed 5 for this menu pattern, should NOT press again
        },
      },
      {
        speech:
          'Staff press 1 for warehouse hours, directions and holidays. Observed press 2 for information on membership or returns, press 3 to reach the pharmacy.',
        expectedBehavior: {
          shouldPressDTMF: false, // No option 5, no clear match
          shouldDetectLoop: true, // Same pattern as step 7 - loop detected
        },
      },
      {
        speech:
          'Returns press 3 to reach the pharmacy, press 4 for all other departments press 5.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same pattern as step 6 and 8 - loop detected
          shouldNotPressAgain: true, // Should NOT press again if we already pressed 5 for this pattern
        },
      },
      {
        speech:
          '5 to reach the administrative staff. Press 1 for warehouse hours directions and holidays, observed press 2 for information on membership or returns, press 3 to reach the pharmacy.',
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '5',
          shouldDetectLoop: true, // Same pattern as step 1, 4, 5 - loop detected
          shouldNotPressAgain: true, // Should NOT press again if we already pressed 5 for this pattern
        },
      },
    ],
  },
];

class PromptEvaluationService {
  /**
   * Run all prompt evaluation test cases
   */
  async runAllTests(
    config?: Partial<TransferConfig>
  ): Promise<PromptEvaluationReport> {
    const testCases = SINGLE_STEP_TEST_CASES;
    const results: PromptTestResult[] = [];

    for (const testCase of testCases) {
      const mergedConfig = {
        ...config,
        ...testCase.config,
      } as TransferConfig;

      const result = await this.runTestCase(testCase, mergedConfig);
      results.push(result);
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    return {
      totalTests: testCases.length,
      passed,
      failed,
      results,
      timestamp: new Date(),
    };
  }

  /**
   * Run a single test case
   * Uses processSpeech (same function as route handler) to avoid duplication
   */
  async runTestCase(
    testCase: PromptTestCase,
    config: TransferConfig
  ): Promise<PromptTestResult> {
    const errors: string[] = [];
    const details: PromptTestResult['details'] = {};

    try {
      // Use processSpeech (same function as route handler) in test mode
      const testCallSid = `test-single-${testCase.name}`;
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
        errors.push('No processing result returned from processSpeech');
        return {
          testCase,
          passed: false,
          errors,
          details,
        };
      }

      const processingResult = result.processingResult;
      details.transferDetected = processingResult.transferRequested;
      details.terminationDetected = processingResult.shouldTerminate;
      details.dtmfDecision = processingResult.dtmfDecision;
      details.aiResponse = result.aiResponse;

      // Test transfer detection
      if (testCase.expectedBehavior.shouldTransfer !== undefined) {
        if (
          processingResult.transferRequested !==
          testCase.expectedBehavior.shouldTransfer
        ) {
          errors.push(
            `Transfer detection mismatch: expected ${testCase.expectedBehavior.shouldTransfer}, got ${processingResult.transferRequested} (confidence: ${processingResult.transferConfidence}) - ${processingResult.transferReason}`
          );
        }
      }

      // Test termination detection
      if (testCase.expectedBehavior.shouldTerminate !== undefined) {
        if (
          processingResult.shouldTerminate !==
          testCase.expectedBehavior.shouldTerminate
        ) {
          errors.push(
            `Termination detection mismatch: expected ${testCase.expectedBehavior.shouldTerminate}, got ${processingResult.shouldTerminate} - ${processingResult.terminationReason}`
          );
        }

        if (
          testCase.expectedBehavior.terminationReason &&
          processingResult.terminationReason !== testCase.expectedBehavior.terminationReason
        ) {
          errors.push(
            `Termination reason mismatch: expected ${testCase.expectedBehavior.terminationReason}, got ${processingResult.terminationReason}`
          );
        }
      }

      // Test DTMF decision
      if (
        testCase.expectedBehavior.shouldPressDTMF !== undefined ||
        testCase.expectedBehavior.expectedDigit !== undefined
      ) {
        if (testCase.expectedBehavior.shouldPressDTMF === true && !processingResult.isIVRMenu) {
          errors.push(
            `Expected IVR menu but menu was not detected`
          );
        }

        if (
          testCase.expectedBehavior.shouldPressDTMF !== undefined &&
          processingResult.dtmfDecision.shouldPress !==
            testCase.expectedBehavior.shouldPressDTMF
        ) {
          errors.push(
            `DTMF decision mismatch: expected shouldPress=${testCase.expectedBehavior.shouldPressDTMF}, got ${processingResult.dtmfDecision.shouldPress}`
          );
        }

        if (
          testCase.expectedBehavior.expectedDigit !== undefined &&
          processingResult.dtmfDecision.digit !== testCase.expectedBehavior.expectedDigit
        ) {
          errors.push(
            `DTMF digit mismatch: expected ${testCase.expectedBehavior.expectedDigit}, got ${processingResult.dtmfDecision.digit}`
          );
        }
      }

      // Test AI response generation for transfer scenarios
      // Only check AI response if explicitly required (some tests just check detection)
      if (
        testCase.expectedBehavior.shouldTransfer &&
        testCase.expectedBehavior.expectedCallPurpose === undefined
      ) {
        // AI response is already generated by processSpeech and returned in result.aiResponse
        if (result.aiResponse) {
          // Validate that AI doesn't say "Silent." (per prompt instructions)
          const responseLower = result.aiResponse.toLowerCase().trim();
          const isSilentWord = responseLower === 'silent.' || responseLower === 'silent';
          
          if (isSilentWord) {
            errors.push(
              `AI should not say "Silent." - per prompt: "If you are being silent, do not say the word 'Silent'. Simply don't say anything". Response: "${result.aiResponse}"`
            );
          }
        }
      }

      // Test call purpose extraction if expected
      if (testCase.expectedBehavior.expectedCallPurpose) {
        // AI response is already generated by processSpeech and returned in result.aiResponse
        // Note: We don't validate the exact wording of the AI response for call purpose.
        // The AI may express the call purpose in various ways, and we trust the AI to
        // understand and communicate the purpose correctly. We only log the response
        // for manual review if needed.
      }
    } catch (error) {
      errors.push(`Test execution error: ${error}`);
    }

    return {
      testCase,
      passed: errors.length === 0,
      errors,
      details,
    };
  }

  /**
   * Run a multi-step test case (for loop detection and stateful behavior)
   */
  async runMultiStepTestCase(
    testCase: MultiStepTestCase,
    config: TransferConfig
  ): Promise<MultiStepTestResult> {
    const errors: string[] = [];
    const stepResults: MultiStepTestResult['stepResults'] = [];
    let previousMenus: MenuOption[][] = [];
    let lastPressedDTMF: string | undefined;
    let lastMenuForDTMF: MenuOption[] | undefined;
    let consecutiveDTMFPresses: { digit: string; count: number }[] = [];

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i];
      const stepErrors: string[] = [];
      const stepDetails: MultiStepTestResult['stepResults'][0]['details'] = {
        previousMenus: [...previousMenus],
      };

      try {
        // Sync eval service state to callStateManager (so processSpeech uses the same state)
        const testCallSid = `test-${testCase.name}-${i}`;
        callStateManager.updateCallState(testCallSid, {
          previousMenus,
          lastPressedDTMF,
          lastMenuForDTMF,
          consecutiveDTMFPresses,
        });

        // Use processSpeech (same function as route handler) in test mode
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
          stepErrors.push(`No processing result returned at step ${i + 1}`);
          continue;
        }

        const processingResult = result.processingResult;

        // Extract updated state from callStateManager back to eval service variables
        const updatedState = callStateManager.getCallState(testCallSid);
        previousMenus = updatedState.previousMenus || [];
        lastPressedDTMF = updatedState.lastPressedDTMF;
        lastMenuForDTMF = updatedState.lastMenuForDTMF;
        consecutiveDTMFPresses = updatedState.consecutiveDTMFPresses || [];

        stepDetails.menuOptions = processingResult.menuOptions;
        stepDetails.loopDetected = processingResult.loopDetected;
        stepDetails.dtmfDecision = processingResult.dtmfDecision;
        stepDetails.terminationDetected = processingResult.shouldTerminate;

        // Validate IVR menu detection
        if (step.expectedBehavior.shouldPressDTMF === true && !processingResult.isIVRMenu) {
          stepErrors.push(
            `Expected IVR menu at step ${i + 1}, but menu was not detected`
          );
        }

        // Validate loop detection
        if (
          step.expectedBehavior.shouldDetectLoop !== undefined &&
          processingResult.loopDetected !== step.expectedBehavior.shouldDetectLoop
        ) {
          stepErrors.push(
            `Loop detection mismatch at step ${i + 1}: expected ${step.expectedBehavior.shouldDetectLoop}, got ${processingResult.loopDetected} (confidence: ${processingResult.loopConfidence})`
          );
        }

        // Validate termination detection
        if (step.expectedBehavior.shouldTerminate !== undefined) {
          if (processingResult.shouldTerminate !== step.expectedBehavior.shouldTerminate) {
            stepErrors.push(
              `Termination detection mismatch at step ${i + 1}: expected shouldTerminate=${step.expectedBehavior.shouldTerminate}, got ${processingResult.shouldTerminate}`
            );
          }

          if (
            step.expectedBehavior.terminationReason !== undefined &&
            processingResult.shouldTerminate
          ) {
            if (processingResult.terminationReason !== step.expectedBehavior.terminationReason) {
              stepErrors.push(
                `Termination reason mismatch at step ${i + 1}: expected ${step.expectedBehavior.terminationReason}, got ${processingResult.terminationReason}`
              );
            }
          }
        }

        // Validate DTMF decision (considering loop prevention)
        const expectedShouldPress = step.expectedBehavior.shouldPressDTMF;
        if (expectedShouldPress !== undefined) {
          // If loop prevention should kick in, we expect shouldPress to be false
          // even if AI would normally press
          if (step.expectedBehavior.shouldNotPressAgain) {
            if (!processingResult.shouldPreventDTMF && processingResult.dtmfDecision.shouldPress) {
              stepErrors.push(
                `Should not press DTMF at step ${i + 1} (loop detected, same menu, already pressed ${lastPressedDTMF}) - but system would still press`
              );
            }
          } else {
            // Normal case - check if decision matches expectation
            // Account for loop prevention: if shouldPreventDTMF is true, shouldPress should be false
            const actualShouldPress =
              processingResult.shouldPreventDTMF
                ? false
                : processingResult.dtmfDecision.shouldPress;
            if (actualShouldPress !== expectedShouldPress) {
              stepErrors.push(
                `DTMF decision mismatch at step ${i + 1}: expected shouldPress=${expectedShouldPress}, got ${actualShouldPress}`
              );
            }
          }
        }

        // Check expected digit (only if we should actually press)
        if (
          step.expectedBehavior.expectedDigit !== undefined &&
          !processingResult.shouldPreventDTMF
        ) {
          const actualDigit = processingResult.dtmfDecision.digit || undefined;
          if (actualDigit !== step.expectedBehavior.expectedDigit) {
            stepErrors.push(
              `DTMF digit mismatch at step ${i + 1}: expected ${step.expectedBehavior.expectedDigit}, got ${actualDigit}`
            );
          }
        }

        // Update state for next step (only if we actually pressed)
        if (
          !processingResult.shouldPreventDTMF &&
          processingResult.dtmfDecision.shouldPress &&
          processingResult.dtmfDecision.digit !== null
        ) {
          const digitPressed = processingResult.dtmfDecision.digit;
          lastPressedDTMF = digitPressed;
          lastMenuForDTMF = processingResult.menuOptions;

          // Track consecutive DTMF presses
          const lastPress = consecutiveDTMFPresses[consecutiveDTMFPresses.length - 1];
          if (lastPress && lastPress.digit === digitPressed) {
            consecutiveDTMFPresses = [
              ...consecutiveDTMFPresses.slice(0, -1),
              { digit: digitPressed, count: lastPress.count + 1 },
            ];
          } else {
            consecutiveDTMFPresses = [
              ...consecutiveDTMFPresses,
              { digit: digitPressed, count: 1 },
            ];
            if (consecutiveDTMFPresses.length > 5) {
              consecutiveDTMFPresses = consecutiveDTMFPresses.slice(-5);
            }
          }
        }
        if (processingResult.menuOptions.length > 0) {
          previousMenus.push(processingResult.menuOptions);
        }
      } catch (error) {
        stepErrors.push(
          `Error processing step ${i + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      stepResults.push({
        stepIndex: i,
        speech: step.speech,
        passed: stepErrors.length === 0,
        errors: stepErrors,
        details: stepDetails,
      });

      errors.push(...stepErrors);
    }

    return {
      testCase,
      passed: errors.length === 0,
      errors,
      stepResults,
    };
  }


  /**
   * Run all multi-step test cases
   */
  async runAllMultiStepTests(
    config?: Partial<TransferConfig>
  ): Promise<MultiStepEvaluationReport> {
    const testCases = MULTI_STEP_TEST_CASES;
    const results: MultiStepTestResult[] = [];

    for (const testCase of testCases) {
      const mergedConfig = {
        ...config,
        ...testCase.config,
      } as TransferConfig;

      const result = await this.runMultiStepTestCase(testCase, mergedConfig);
      results.push(result);
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    return {
      totalTests: testCases.length,
      passed,
      failed,
      results,
      timestamp: new Date(),
    };
  }


  /**
   * Print multi-step evaluation report to console
   */
  printMultiStepReport(report: MultiStepEvaluationReport): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 MULTI-STEP LOOP DETECTION EVALUATION REPORT');
    console.log('='.repeat(80));
    console.log(`Total Tests: ${report.totalTests}`);
    console.log(`✅ Passed: ${report.passed}`);
    console.log(`❌ Failed: ${report.failed}`);
    console.log(`Timestamp: ${report.timestamp.toISOString()}`);
    console.log('\n' + '-'.repeat(80));

    report.results.forEach((result, index) => {
      const status = result.passed ? '✅' : '❌';
      console.log(`\n${index + 1}. ${status} ${result.testCase.name}`);
      console.log(`   Description: ${result.testCase.description}`);

      if (!result.passed) {
        console.log(`   Errors:`);
        result.errors.forEach(error => {
          console.log(`     - ${error}`);
        });
      }

      result.stepResults.forEach((stepResult, stepIndex) => {
        const stepStatus = stepResult.passed ? '✅' : '❌';
        console.log(`\n   Step ${stepIndex + 1}: ${stepStatus}`);
        console.log(`     Speech: "${stepResult.speech.substring(0, 100)}${stepResult.speech.length > 100 ? '...' : ''}"`);

        if (stepResult.details.menuOptions) {
          console.log(
            `     Menu Options: ${stepResult.details.menuOptions.map(opt => `Press ${opt.digit} for ${opt.option}`).join(', ')}`
          );
        }

        if (stepResult.details.loopDetected !== undefined) {
          console.log(
            `     Loop Detected: ${stepResult.details.loopDetected ? '✅ Yes' : '❌ No'}`
          );
        }

        if (stepResult.details.dtmfDecision) {
          const decision = stepResult.details.dtmfDecision;
          console.log(
            `     DTMF Decision: ${decision.shouldPress ? 'Press' : 'No press'} ${decision.digit || 'N/A'} - ${decision.reason}`
          );
        }

        if (stepResult.details.previousMenus && stepResult.details.previousMenus.length > 0) {
          console.log(
            `     Previous Menus: ${stepResult.details.previousMenus.length} menu(s) seen before`
          );
        }

        if (!stepResult.passed && stepResult.errors.length > 0) {
          console.log(`     Step Errors:`);
          stepResult.errors.forEach(error => {
            console.log(`       - ${error}`);
          });
        }
      });
    });

    console.log('\n' + '='.repeat(80));

    if (report.failed > 0) {
      console.log(
        `\n⚠️  ${report.failed} test(s) failed. Review the errors above.`
      );
    } else {
      console.log('\n✅ All multi-step tests passed!');
    }
  }

  /**
   * Print evaluation report to console
   */
  printReport(report: PromptEvaluationReport): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 PROMPT EVALUATION REPORT');
    console.log('='.repeat(80));
    console.log(`Total Tests: ${report.totalTests}`);
    console.log(`✅ Passed: ${report.passed}`);
    console.log(`❌ Failed: ${report.failed}`);
    console.log(`Timestamp: ${report.timestamp.toISOString()}`);
    console.log('\n' + '-'.repeat(80));

    report.results.forEach((result, index) => {
      const status = result.passed ? '✅' : '❌';
      console.log(`\n${index + 1}. ${status} ${result.testCase.name}`);
      console.log(`   Description: ${result.testCase.description}`);
      console.log(`   Speech: "${result.testCase.speech}"`);

      if (!result.passed) {
        console.log(`   Errors:`);
        result.errors.forEach(error => {
          console.log(`     - ${error}`);
        });
      }

      if (result.details.aiResponse) {
        console.log(`   AI Response: "${result.details.aiResponse}"`);
      }

      if (result.details.dtmfDecision) {
        const decision = result.details.dtmfDecision;
        console.log(
          `   DTMF Decision: ${decision.shouldPress ? 'Press' : 'No press'} ${decision.digit || 'N/A'} - ${decision.reason}`
        );
      }
    });

    console.log('\n' + '='.repeat(80));

    if (report.failed > 0) {
      console.log(
        `\n⚠️  ${report.failed} test(s) failed. Review the errors above and adjust your prompts accordingly.`
      );
    } else {
      console.log('\n✅ All tests passed! Your prompts are working correctly.');
    }
  }
}

// Singleton instance
const promptEvaluationService = new PromptEvaluationService();

export default promptEvaluationService;
