/**
 * Live Call Evaluation Service
 * Automated tests that dial real phone numbers and validate IVR flows
 */

import twilio from 'twilio';
import twilioService from './twilioService';
import callHistoryService from './callHistoryService';

export interface LiveCallTestCase {
  id: string;
  name: string;
  description: string;
  phoneNumber: string;
  callPurpose: string;
  customInstructions?: string;
  expectedOutcome: {
    shouldReachHuman?: boolean;
    maxDTMFPresses?: number;
    expectedDigits?: string[];
    maxDurationSeconds?: number;
    minDurationSeconds?: number;
  };
}

export interface LiveCallTestResult {
  testCaseId: string;
  testCaseName: string;
  passed: boolean;
  callSid?: string;
  status?: string;
  duration?: number;
  dtmfPresses?: string[];
  error?: string;
  reachedHuman?: boolean;
  assertions: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
}

export interface LiveCallEvalReport {
  id: string;
  timestamp: Date;
  totalTests: number;
  passed: number;
  failed: number;
  results: LiveCallTestResult[];
}

const DEFAULT_TIMEOUT_SECONDS = 180;

class LiveCallEvaluationService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.TWIML_URL || process.env.BASE_URL || '';
  }

  private getTwimlUrl(
    transferNumber: string,
    callPurpose: string,
    customInstructions?: string
  ): string {
    const params = new URLSearchParams({
      transferNumber,
      callPurpose: callPurpose || 'speak with a representative',
    });
    if (customInstructions) {
      params.append('customInstructions', customInstructions);
    }
    return `${this.baseUrl}/voice?${params.toString()}`;
  }

  async runTestCase(
    testCase: LiveCallTestCase,
    fromNumber?: string
  ): Promise<LiveCallTestResult> {
    const assertions: LiveCallTestResult['assertions'] = [];
    const dtmfPresses: string[] = [];
    let callSid: string | undefined;
    let status: string | undefined;
    let duration: number | undefined;
    let reachedHuman = false;
    let error: string | undefined;

    const from = fromNumber || process.env.TWILIO_PHONE_NUMBER || '';
    const transferNumber = process.env.TRANSFER_PHONE_NUMBER || '';

    if (!from || !transferNumber) {
      return {
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        passed: false,
        error: 'TWILIO_PHONE_NUMBER or TRANSFER_PHONE_NUMBER not configured',
        assertions: [
          {
            name: 'setup',
            passed: false,
            message: 'Missing required environment variables',
          },
        ],
      };
    }

    if (!this.baseUrl) {
      return {
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        passed: false,
        error: 'TWIML_URL or BASE_URL not configured',
        assertions: [
          {
            name: 'setup',
            passed: false,
            message: 'Missing base URL for TwiML',
          },
        ],
      };
    }

    try {
      console.log(`📞 Starting live call test: ${testCase.name}`);
      console.log(`   Phone: ${testCase.phoneNumber}`);
      console.log(`   Purpose: ${testCase.callPurpose}`);

      const twimlUrl = this.getTwimlUrl(
        transferNumber,
        testCase.callPurpose,
        testCase.customInstructions
      );

      const call = await twilioService.initiateCall(
        testCase.phoneNumber,
        from,
        twimlUrl
      );

      callSid = call.sid;
      status = call.status;
      console.log(`   Call SID: ${callSid}`);

      const maxDuration =
        testCase.expectedOutcome.maxDurationSeconds || DEFAULT_TIMEOUT_SECONDS;
      const startTime = Date.now();

      while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000));

        const currentStatus = await twilioService.getCallStatus(callSid);
        status = currentStatus.status;

        console.log(`   Status: ${status}`);

        const callHistory = await callHistoryService.getCall(callSid);
        if (callHistory) {
          const dtmfEvents = callHistory.dtmfPresses || [];
          dtmfEvents.forEach(e => {
            if (e.digit && !dtmfPresses.includes(e.digit)) {
              dtmfPresses.push(e.digit);
            }
          });

          const transferEvents =
            callHistory.events?.filter(e => e.eventType === 'transfer') || [];
          const successfulTransfers = transferEvents.filter(
            e => e.success === true
          );
          if (successfulTransfers.length > 0) {
            reachedHuman = true;
          }
        }

        if (
          ['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(
            status
          )
        ) {
          duration = Math.round((Date.now() - startTime) / 1000);
          break;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > maxDuration) {
          console.log(`   Timeout after ${maxDuration}s, terminating call`);
          await twilioService.getCallStatus(callSid);
          await this.terminateCall(callSid);
          duration = maxDuration;
          error = `Call timed out after ${maxDuration} seconds`;
          break;
        }
      }

      console.log(
        `   Call ended: ${status}, duration: ${duration}s, DTMF: ${dtmfPresses.join(', ')}`
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`   Error: ${error}`);
    }

    const outcome = testCase.expectedOutcome;

    if (outcome.maxDTMFPresses !== undefined) {
      const passed = dtmfPresses.length <= outcome.maxDTMFPresses;
      assertions.push({
        name: 'maxDTMFPresses',
        passed,
        message: `DTMF presses: ${dtmfPresses.length}, max allowed: ${outcome.maxDTMFPresses}`,
      });
    }

    if (outcome.expectedDigits) {
      const expectedStr = outcome.expectedDigits.join(', ');
      const actualStr = dtmfPresses.join(', ');
      const passed = outcome.expectedDigits.every(
        (d, i) => dtmfPresses[i] === d
      );
      assertions.push({
        name: 'expectedDigits',
        passed,
        message: `Expected: ${expectedStr}, got: ${actualStr}`,
      });
    }

    if (outcome.shouldReachHuman !== undefined) {
      const passed = reachedHuman === outcome.shouldReachHuman;
      assertions.push({
        name: 'shouldReachHuman',
        passed,
        message: `Expected human: ${outcome.shouldReachHuman}, reached: ${reachedHuman}`,
      });
    }

    if (outcome.maxDurationSeconds !== undefined && duration !== undefined) {
      const passed = duration <= outcome.maxDurationSeconds;
      assertions.push({
        name: 'maxDuration',
        passed,
        message: `Duration: ${duration}s, max allowed: ${outcome.maxDurationSeconds}s`,
      });
    }

    if (outcome.minDurationSeconds !== undefined && duration !== undefined) {
      const passed = duration >= outcome.minDurationSeconds;
      assertions.push({
        name: 'minDuration',
        passed,
        message: `Duration: ${duration}s, min required: ${outcome.minDurationSeconds}s`,
      });
    }

    const passed = assertions.every(a => a.passed);

    return {
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      passed,
      callSid,
      status,
      duration,
      dtmfPresses: dtmfPresses.length > 0 ? dtmfPresses : undefined,
      error,
      reachedHuman,
      assertions,
    };
  }

  private async terminateCall(callSid: string): Promise<void> {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (accountSid && authToken) {
        const client = twilio(accountSid, authToken);
        await client.calls(callSid).update({ status: 'completed' });
      }
    } catch (err) {
      console.error('Failed to terminate call:', err);
    }
  }

  async runAllTests(
    testCases: LiveCallTestCase[],
    fromNumber?: string
  ): Promise<LiveCallEvalReport> {
    const report: LiveCallEvalReport = {
      id: `eval-${Date.now()}`,
      timestamp: new Date(),
      totalTests: testCases.length,
      passed: 0,
      failed: 0,
      results: [],
    };

    console.log(
      `\n🚀 Starting live call evaluation with ${testCases.length} test cases (parallel, max 3 concurrent)\n`
    );

    const MAX_CONCURRENT = 3;
    const results: LiveCallTestResult[] = [];

    const runBatch = async (batch: LiveCallTestCase[]): Promise<void> => {
      const promises = batch.map(async testCase => {
        const result = await this.runTestCase(testCase, fromNumber);
        results.push(result);

        if (result.passed) {
          report.passed++;
          console.log(`✅ ${testCase.name}: PASSED`);
        } else {
          report.failed++;
          console.log(`❌ ${testCase.name}: FAILED`);
          result.assertions.forEach(a => {
            console.log(`   ${a.passed ? '✅' : '❌'} ${a.name}: ${a.message}`);
          });
        }
      });

      await Promise.all(promises);
    };

    for (let i = 0; i < testCases.length; i += MAX_CONCURRENT) {
      const batch = testCases.slice(i, i + MAX_CONCURRENT);
      console.log(`   Starting batch of ${batch.length} tests...`);
      await runBatch(batch);

      if (i + MAX_CONCURRENT < testCases.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    report.results = results;

    console.log(`\n📊 Results: ${report.passed}/${report.totalTests} passed\n`);

    return report;
  }
}

const liveCallEvaluationService = new LiveCallEvaluationService();

export default liveCallEvaluationService;
