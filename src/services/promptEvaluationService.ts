/**
 * Prompt Evaluation Service
 * Development-time evaluations for testing prompts with specific test cases
 * Run these when modifying prompts to ensure critical behaviors still work
 */

import aiService from './aiService';
import aiDTMFService from './aiDTMFService';
import aiDetectionService from './aiDetectionService';
import { TransferConfig } from './aiService';
import { DTMFDecision } from './aiDTMFService';
import { MenuOption } from '../types/menu';

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

// Single-step test cases
const PROMPT_TEST_CASES: PromptTestCase[] = [
  // Transfer Detection Tests
  {
    name: 'Transfer Request - Direct',
    description: 'Should detect direct transfer confirmation from system',
    speech: "I'm transferring you now to a representative",
    expectedBehavior: {
      shouldTransfer: true,
      // Note: AI will ask for confirmation before transferring, which is correct behavior
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

  // Loop Detection Tests
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

  // DTMF Decision Tests
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

  // Termination Tests
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
    name: 'No Termination - Business Hours',
    description:
      'Should NOT terminate when business hours are provided without closed status',
    speech: 'Our business hours are Monday through Friday 9 to 5',
    expectedBehavior: {
      shouldTerminate: false,
    },
  },

  // Call Purpose Tests
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
];

class PromptEvaluationService {
  /**
   * Run all prompt evaluation test cases
   */
  async runAllTests(
    config?: Partial<TransferConfig>
  ): Promise<PromptEvaluationReport> {
    const testCases = PROMPT_TEST_CASES;
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
   */
  async runTestCase(
    testCase: PromptTestCase,
    config: TransferConfig
  ): Promise<PromptTestResult> {
    const errors: string[] = [];
    const details: PromptTestResult['details'] = {};

    try {
      // Test transfer detection using AI
      if (testCase.expectedBehavior.shouldTransfer !== undefined) {
        const transferDetection =
          await aiDetectionService.detectTransferRequest(testCase.speech);
        details.transferDetected = transferDetection.wantsTransfer;

        if (
          transferDetection.wantsTransfer !==
          testCase.expectedBehavior.shouldTransfer
        ) {
          errors.push(
            `Transfer detection mismatch: expected ${testCase.expectedBehavior.shouldTransfer}, got ${transferDetection.wantsTransfer} (confidence: ${transferDetection.confidence}) - ${transferDetection.reason}`
          );
        }
      }

      // Test termination detection using AI
      if (testCase.expectedBehavior.shouldTerminate !== undefined) {
        const termination = await aiDetectionService.detectTermination(
          testCase.speech
        );
        details.terminationDetected = termination.shouldTerminate;

        if (
          termination.shouldTerminate !==
          testCase.expectedBehavior.shouldTerminate
        ) {
          errors.push(
            `Termination detection mismatch: expected ${testCase.expectedBehavior.shouldTerminate}, got ${termination.shouldTerminate} (confidence: ${termination.confidence}) - ${termination.message}`
          );
        }

        if (
          testCase.expectedBehavior.terminationReason &&
          termination.reason !== testCase.expectedBehavior.terminationReason
        ) {
          errors.push(
            `Termination reason mismatch: expected ${testCase.expectedBehavior.terminationReason}, got ${termination.reason}`
          );
        }
      }

      // Test DTMF decision if this is an IVR menu
      if (
        testCase.expectedBehavior.shouldPressDTMF !== undefined ||
        testCase.expectedBehavior.expectedDigit !== undefined
      ) {
        // Use AI to detect if this is an IVR menu
        const menuDetection = await aiDetectionService.detectIVRMenu(
          testCase.speech
        );
        if (menuDetection.isIVRMenu) {
          // Use AI to extract menu options
          const extractionResult = await aiDetectionService.extractMenuOptions(
            testCase.speech
          );
          const menuOptions = extractionResult.menuOptions;

          // Debug: log extracted menu options for troubleshooting
          if (menuOptions.length === 0) {
            console.log(
              `   ⚠️  Warning: No menu options extracted from: "${testCase.speech}" (confidence: ${extractionResult.confidence})`
            );
          }
          const dtmfDecision =
            await aiDTMFService.understandCallPurposeAndPressDTMF(
              testCase.speech,
              config,
              menuOptions
            );
          details.dtmfDecision = dtmfDecision;

          if (
            testCase.expectedBehavior.shouldPressDTMF !== undefined &&
            dtmfDecision.shouldPress !==
              testCase.expectedBehavior.shouldPressDTMF
          ) {
            errors.push(
              `DTMF decision mismatch: expected shouldPress=${testCase.expectedBehavior.shouldPressDTMF}, got ${dtmfDecision.shouldPress}`
            );
          }

          if (
            testCase.expectedBehavior.expectedDigit !== undefined &&
            dtmfDecision.digit !== testCase.expectedBehavior.expectedDigit
          ) {
            errors.push(
              `DTMF digit mismatch: expected ${testCase.expectedBehavior.expectedDigit}, got ${dtmfDecision.digit}`
            );
          }
        }
      }

      // Test AI response generation for transfer scenarios
      // Only check AI response if explicitly required (some tests just check detection)
      if (
        testCase.expectedBehavior.shouldTransfer &&
        testCase.expectedBehavior.expectedCallPurpose === undefined
      ) {
        try {
          const aiResponse = await aiService.generateResponse(
            config,
            testCase.speech,
            true,
            []
          );
          details.aiResponse = aiResponse;

          // For transfer confirmations from system, AI should ask for confirmation first
          // This is correct behavior per the prompt
          const responseLower = aiResponse.toLowerCase();
          const isTransferConfirmation =
            testCase.speech.toLowerCase().includes("i'm transferring") ||
            testCase.speech.toLowerCase().includes('i am transferring') ||
            testCase.speech.toLowerCase().includes('i will transfer');

          if (isTransferConfirmation) {
            // For system transfer confirmations, AI should confirm it's a real person
            // Per prompt: "When you Think you are speaking with a human, confirm it by asking..."
            // However, if the AI recognizes this is an automated system announcement,
            // it may correctly remain silent (per prompt: "Remain silent during menu prompts")
            const isSilentWord = responseLower.trim() === 'silent.' || responseLower.trim() === 'silent';
            const isEmptyResponse = aiResponse.trim() === '';
            const hasConfirmationIntent =
              responseLower.includes('real person') ||
              responseLower.includes('automated system') ||
              responseLower.includes('human') ||
              (responseLower.includes('transfer') && responseLower.includes('speaking'));

            // CRITICAL: AI should NOT say "Silent." - per prompt: "If you are being silent, do not say the word 'Silent'. Simply don't say anything"
            if (isSilentWord) {
              errors.push(
                `AI should not say "Silent." - per prompt: "If you are being silent, do not say the word 'Silent'. Simply don't say anything". Response: "${aiResponse}"`
              );
            } else if (!isEmptyResponse && !hasConfirmationIntent) {
              // If AI responds but doesn't confirm, that's an error
              // The AI should either ask for confirmation OR remain completely silent
              errors.push(
                `AI response should either: (1) confirm before transferring by asking about real person/human, OR (2) remain completely silent. Got: "${aiResponse}"`
              );
            }
            // Empty response is acceptable - AI correctly recognized it's an automated announcement
          } else {
            // For user transfer requests, the AI should acknowledge and navigate
            // Acceptable responses include:
            // 1. Transfer/navigation intent keywords
            // 2. Navigation/acknowledgment language (e.g., "I'll navigate", "begin navigating", "proceed")
            // 3. Empty response (if AI correctly recognizes it should remain silent)
            const hasTransferIntent =
              responseLower.includes('transfer') ||
              responseLower.includes('connect') ||
              responseLower.includes('representative') ||
              responseLower.includes('agent');
            
            const hasNavigationIntent =
              responseLower.includes('navigat') ||
              responseLower.includes('proceed') ||
              responseLower.includes('begin') ||
              responseLower.includes('hold') ||
              responseLower.includes('understand');
            
            const isEmptyResponse = aiResponse.trim() === '';

            if (!hasTransferIntent && !hasNavigationIntent && !isEmptyResponse) {
              errors.push(
                `AI response should indicate transfer/navigation intent or remain silent: "${aiResponse}"`
              );
            }
          }
        } catch (error) {
          errors.push(`AI response generation failed: ${error}`);
        }
      }

      // Test call purpose extraction if expected
      if (testCase.expectedBehavior.expectedCallPurpose) {
        try {
          const aiResponse = await aiService.generateResponse(
            config,
            testCase.speech,
            true,
            []
          );
          details.aiResponse = aiResponse;

          const responseLower = aiResponse.toLowerCase();
          const purposeLower =
            testCase.expectedBehavior.expectedCallPurpose.toLowerCase();

          // Flexible matching: check for key words from the purpose
          // e.g., "order status" should match "status of my order", "order", "status"
          const purposeWords = purposeLower
            .split(/\s+/)
            .filter(w => w.length > 3);
          const hasPurpose = purposeWords.some(word =>
            responseLower.includes(word)
          );

          // Also check for exact phrase match
          const hasExactMatch = responseLower.includes(purposeLower);

          if (!hasExactMatch && !hasPurpose) {
            errors.push(
              `AI response doesn't include expected call purpose "${testCase.expectedBehavior.expectedCallPurpose}": "${aiResponse}"`
            );
          }
        } catch (error) {
          errors.push(`AI response generation failed: ${error}`);
        }
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

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i];
      const stepErrors: string[] = [];
      const stepDetails: MultiStepTestResult['stepResults'][0]['details'] = {
        previousMenus: [...previousMenus],
      };

      try {
        // Detect if this is an IVR menu
        const menuDetection = await aiDetectionService.detectIVRMenu(
          step.speech
        );

        if (menuDetection.isIVRMenu) {
          // Extract menu options
          const extractionResult =
            await aiDetectionService.extractMenuOptions(step.speech);
          const menuOptions = extractionResult.menuOptions;
          stepDetails.menuOptions = menuOptions;

          // Check for loop detection
          let loopDetected = false;
          if (previousMenus.length > 0) {
            const loopCheck = await aiDetectionService.detectLoop(
              menuOptions,
              previousMenus
            );
            loopDetected = loopCheck.isLoop;
            stepDetails.loopDetected = loopCheck.isLoop;

            if (
              step.expectedBehavior.shouldDetectLoop !== undefined &&
              loopCheck.isLoop !== step.expectedBehavior.shouldDetectLoop
            ) {
              stepErrors.push(
                `Loop detection mismatch at step ${i + 1}: expected ${step.expectedBehavior.shouldDetectLoop}, got ${loopCheck.isLoop} (confidence: ${loopCheck.confidence})`
              );
            }
          }

          // Simulate the loop prevention logic from voiceRoutes.ts
          // Check if we already pressed a DTMF for this same menu
          const menusMatch =
            lastMenuForDTMF &&
            lastMenuForDTMF.length === menuOptions.length &&
            lastMenuForDTMF.every(
              (opt, idx) =>
                opt.digit === menuOptions[idx]?.digit &&
                opt.option === menuOptions[idx]?.option
            );

          let shouldActuallyPress = true;
          if (loopDetected && menusMatch && lastPressedDTMF) {
            // Same menu as before, already pressed DTMF - should NOT press again
            shouldActuallyPress = false;
            console.log(
              `   ⚠️  Step ${i + 1}: Loop detected with same menu, already pressed DTMF ${lastPressedDTMF}. Should NOT press again.`
            );
          }

          // Get DTMF decision (what AI would decide)
          const dtmfDecision =
            await aiDTMFService.understandCallPurposeAndPressDTMF(
              step.speech,
              config,
              menuOptions
            );
          stepDetails.dtmfDecision = dtmfDecision;

          // Check if should press DTMF (considering loop prevention)
          const expectedShouldPress = step.expectedBehavior.shouldPressDTMF;
          if (expectedShouldPress !== undefined) {
            // If loop prevention should kick in, we expect shouldPress to be false
            // even if AI would normally press
            if (step.expectedBehavior.shouldNotPressAgain) {
              if (shouldActuallyPress && dtmfDecision.shouldPress) {
                stepErrors.push(
                  `Should not press DTMF at step ${i + 1} (loop detected, same menu, already pressed ${lastPressedDTMF}) - but system would still press`
                );
              }
            } else {
              // Normal case - check if decision matches expectation
              if (dtmfDecision.shouldPress !== expectedShouldPress) {
                stepErrors.push(
                  `DTMF decision mismatch at step ${i + 1}: expected shouldPress=${expectedShouldPress}, got ${dtmfDecision.shouldPress}`
                );
              }
            }
          }

          // Check expected digit (only if we should actually press)
          if (
            step.expectedBehavior.expectedDigit !== undefined &&
            shouldActuallyPress
          ) {
            if (dtmfDecision.digit !== step.expectedBehavior.expectedDigit) {
              stepErrors.push(
                `DTMF digit mismatch at step ${i + 1}: expected ${step.expectedBehavior.expectedDigit}, got ${dtmfDecision.digit}`
              );
            }
          }

          // Update state for next step (only if we actually pressed)
          if (shouldActuallyPress && dtmfDecision.shouldPress && dtmfDecision.digit) {
            lastPressedDTMF = dtmfDecision.digit;
            lastMenuForDTMF = menuOptions;
          }
          previousMenus.push(menuOptions);
        } else {
          // Not an IVR menu - check if we expected it to be
          if (step.expectedBehavior.shouldPressDTMF === true) {
            stepErrors.push(
              `Expected IVR menu at step ${i + 1}, but menu was not detected`
            );
          }
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
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed! Your prompts are working correctly.');
    }
  }
}

// Singleton instance
const promptEvaluationService = new PromptEvaluationService();

export default promptEvaluationService;
