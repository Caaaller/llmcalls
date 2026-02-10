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

class PromptEvaluationService {
  /**
   * Run all prompt evaluation test cases
   */
  async runAllTests(
    config?: Partial<TransferConfig>
  ): Promise<PromptEvaluationReport> {
    const testCases = this.getTestCases();
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
        const transferDetection = await aiDetectionService.detectTransferRequest(testCase.speech);
        details.transferDetected = transferDetection.wantsTransfer;

        if (transferDetection.wantsTransfer !== testCase.expectedBehavior.shouldTransfer) {
          errors.push(
            `Transfer detection mismatch: expected ${testCase.expectedBehavior.shouldTransfer}, got ${transferDetection.wantsTransfer} (confidence: ${transferDetection.confidence}) - ${transferDetection.reason}`
          );
        }
      }

      // Test termination detection using AI
      if (testCase.expectedBehavior.shouldTerminate !== undefined) {
        const termination = await aiDetectionService.detectTermination(testCase.speech);
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
        const menuDetection = await aiDetectionService.detectIVRMenu(testCase.speech);
        if (menuDetection.isIVRMenu) {
          // Use AI to extract menu options
          const extractionResult = await aiDetectionService.extractMenuOptions(testCase.speech);
          const menuOptions = extractionResult.menuOptions;
          
          // Debug: log extracted menu options for troubleshooting
          if (menuOptions.length === 0) {
            console.log(
              `   ⚠️  Warning: No menu options extracted from: "${testCase.speech}" (confidence: ${extractionResult.confidence})`
            );
          }
          
          const dtmfDecision = await aiDTMFService.understandCallPurposeAndPressDTMF(
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
          const isTransferConfirmation = testCase.speech
            .toLowerCase()
            .includes("i'm transferring") ||
            testCase.speech.toLowerCase().includes('i am transferring') ||
            testCase.speech.toLowerCase().includes('i will transfer');

          if (isTransferConfirmation) {
            // For system transfer confirmations, AI should confirm it's a real person
            const hasConfirmationIntent =
              responseLower.includes('real person') ||
              responseLower.includes('automated system') ||
              responseLower.includes('human') ||
              responseLower.includes('transfer');

            if (!hasConfirmationIntent) {
              errors.push(
                `AI response should confirm before transferring: "${aiResponse}"`
              );
            }
          } else {
            // For user transfer requests, check for transfer intent
            const hasTransferIntent =
              responseLower.includes('transfer') ||
              responseLower.includes('connect') ||
              responseLower.includes('representative') ||
              responseLower.includes('agent');

            if (!hasTransferIntent) {
              errors.push(
                `AI response doesn't indicate transfer intent: "${aiResponse}"`
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
          const purposeWords = purposeLower.split(/\s+/).filter(w => w.length > 3);
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
   * Get all test cases for prompt evaluation
   */
  getTestCases(): PromptTestCase[] {
    return [
      // Transfer Detection Tests
      {
        name: 'Transfer Request - Direct',
        description:
          'Should detect direct transfer confirmation from system',
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
        config: {
          callPurpose: 'speak with a representative',
        },
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
        config: {
          callPurpose: 'speak with a representative',
        },
        expectedBehavior: {
          shouldPressDTMF: true,
          expectedDigit: '0',
        },
      },

      // DTMF Decision Tests
      {
        name: 'DTMF - Representative Option',
        description:
          'Should press correct digit for representative option when call purpose is to speak with someone',
        speech: 'Press 0 to speak with a representative, press 1 for sales',
        config: {
          callPurpose: 'speak with a representative',
        },
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
        speech: 'We are currently closed. Our hours are Monday through Friday 9 to 5',
        expectedBehavior: {
          shouldTerminate: true,
          terminationReason: 'closed_no_menu',
        },
      },
      {
        name: 'No Termination - Business Hours',
        description: 'Should NOT terminate when business hours are provided without closed status',
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
        description: 'Should use default call purpose when no custom instructions',
        speech: 'What is the purpose of your call?',
        config: {
          callPurpose: 'speak with a representative',
        },
        expectedBehavior: {
          expectedCallPurpose: 'representative',
        },
      },
    ];
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

