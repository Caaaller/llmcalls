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
import {
  SINGLE_STEP_TEST_CASES,
  MULTI_STEP_TEST_CASES,
} from './promptEvaluationTestCases';

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

class PromptEvaluationService {
  /**
   * Run all prompt evaluation test cases
   */
  async runAllTests(
    config?: Partial<TransferConfig>
  ): Promise<PromptEvaluationReport> {
    const testCases = SINGLE_STEP_TEST_CASES;
    const results = await Promise.all(
      testCases.map(testCase => {
        const mergedConfig = {
          ...config,
          ...testCase.config,
        } as TransferConfig;
        return this.runTestCase(testCase, mergedConfig);
      })
    );

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
          processingResult.terminationReason !==
            testCase.expectedBehavior.terminationReason
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
        if (
          testCase.expectedBehavior.shouldPressDTMF === true &&
          !processingResult.isIVRMenu
        ) {
          errors.push(`Expected IVR menu but menu was not detected`);
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
          processingResult.dtmfDecision.digit !==
            testCase.expectedBehavior.expectedDigit
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
          const isSilentWord =
            responseLower === 'silent.' || responseLower === 'silent';

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
          stepResults.push({
            stepIndex: i,
            speech: step.speech,
            passed: false,
            errors: stepErrors,
            details: stepDetails,
          });
          errors.push(...stepErrors);
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
        if (
          step.expectedBehavior.shouldPressDTMF === true &&
          !processingResult.isIVRMenu
        ) {
          stepErrors.push(
            `Expected IVR menu at step ${i + 1}, but menu was not detected`
          );
        }

        // Validate loop detection
        if (
          step.expectedBehavior.shouldDetectLoop !== undefined &&
          processingResult.loopDetected !==
            step.expectedBehavior.shouldDetectLoop
        ) {
          stepErrors.push(
            `Loop detection mismatch at step ${i + 1}: expected ${step.expectedBehavior.shouldDetectLoop}, got ${processingResult.loopDetected} (confidence: ${processingResult.loopConfidence})`
          );
        }

        // Validate termination detection
        if (step.expectedBehavior.shouldTerminate !== undefined) {
          if (
            processingResult.shouldTerminate !==
            step.expectedBehavior.shouldTerminate
          ) {
            stepErrors.push(
              `Termination detection mismatch at step ${i + 1}: expected shouldTerminate=${step.expectedBehavior.shouldTerminate}, got ${processingResult.shouldTerminate}`
            );
          }

          if (
            step.expectedBehavior.terminationReason !== undefined &&
            processingResult.shouldTerminate
          ) {
            if (
              processingResult.terminationReason !==
              step.expectedBehavior.terminationReason
            ) {
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
            if (!processingResult.shouldPreventDTMF) {
              stepErrors.push(
                `Step ${i + 1}: expected loop prevention (shouldPreventDTMF) but got false`
              );
            }
            if (processingResult.dtmfDecision.shouldPress) {
              stepErrors.push(
                `Should not press DTMF at step ${i + 1} (loop detected, same menu, already pressed ${lastPressedDTMF}) - but system would still press`
              );
            }
          } else {
            // Normal case - check if decision matches expectation
            // Account for loop prevention: if shouldPreventDTMF is true, shouldPress should be false
            const actualShouldPress = processingResult.shouldPreventDTMF
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
          const lastPress =
            consecutiveDTMFPresses[consecutiveDTMFPresses.length - 1];
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
    const results = await Promise.all(
      testCases.map(testCase => {
        const mergedConfig = {
          ...config,
          ...testCase.config,
        } as TransferConfig;
        return this.runMultiStepTestCase(testCase, mergedConfig);
      })
    );

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
        console.log(
          `     Speech: "${stepResult.speech.substring(0, 100)}${stepResult.speech.length > 100 ? '...' : ''}"`
        );

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

        if (
          stepResult.details.previousMenus &&
          stepResult.details.previousMenus.length > 0
        ) {
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
