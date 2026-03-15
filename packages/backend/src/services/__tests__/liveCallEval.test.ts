/**
 * Live Call Evaluation Tests (Jest).
 * Makes real Twilio calls and validates IVR navigation using existing services.
 * Run: pnpm --filter backend test:live
 */

import '../../../jest.setup';
import twilioService from '../twilioService';
import callHistoryService from '../callHistoryService';
import { connect, disconnect } from '../database';
import { DEFAULT_TEST_CASES, QUICK_TEST_CASES } from '../liveCallTestCases';
import type { LiveCallTestCase } from '../liveCallTestCases';

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_SECONDS = 180;
const TERMINAL_STATUSES = [
  'completed',
  'failed',
  'busy',
  'no-answer',
  'canceled',
];

function buildTwimlUrl(testCase: LiveCallTestCase): string {
  const baseUrl = process.env.TWIML_URL || process.env.BASE_URL || '';
  const transferNumber = process.env.TRANSFER_PHONE_NUMBER || '';
  const params = new URLSearchParams({
    transferNumber,
    callPurpose: testCase.callPurpose || 'speak with a representative',
  });
  if (testCase.customInstructions) {
    params.append('customInstructions', testCase.customInstructions);
  }
  return `${baseUrl}/voice?${params.toString()}`;
}

interface CallResult {
  callSid: string;
  status: string;
  durationSeconds: number;
  timedOut: boolean;
}

async function executeCall(testCase: LiveCallTestCase): Promise<CallResult> {
  const from = process.env.TWILIO_PHONE_NUMBER || '';
  const twimlUrl = buildTwimlUrl(testCase);
  const maxDuration =
    testCase.expectedOutcome.maxDurationSeconds || DEFAULT_TIMEOUT_SECONDS;

  const call = await twilioService.initiateCall(
    testCase.phoneNumber,
    from,
    twimlUrl
  );
  const callSid = call.sid;
  const startTime = Date.now();
  let status = call.status;
  let timedOut = false;

  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const currentCall = await twilioService.getCallStatus(callSid);
    status = currentCall.status;

    if (TERMINAL_STATUSES.includes(status)) break;

    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > maxDuration) {
      await twilioService.terminateCall(callSid);
      timedOut = true;
      break;
    }
  }

  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  return { callSid, status, durationSeconds, timedOut };
}

/**
 * Fetch full call data from callHistoryService (same data the UI displays)
 * and format it as a readable timeline for debugging.
 */
async function formatCallTimeline(callSid: string): Promise<string> {
  const call = await callHistoryService.getCall(callSid);
  if (!call) return `  No call history found for ${callSid}`;

  const lines: Array<string> = [];
  lines.push(`  Call: ${callSid}`);
  lines.push(`  Status: ${call.status}`);
  if (call.metadata) {
    lines.push(`  To: ${call.metadata.to || 'unknown'}`);
    lines.push(`  Transfer#: ${call.metadata.transferNumber || 'unknown'}`);
    lines.push(`  Purpose: ${call.metadata.callPurpose || 'unknown'}`);
  }

  if (call.events && call.events.length > 0) {
    lines.push('  --- Event Timeline ---');
    for (const event of call.events) {
      const time = event.timestamp
        ? new Date(event.timestamp).toISOString().slice(11, 19)
        : '??:??:??';
      switch (event.eventType) {
        case 'conversation':
          lines.push(`  [${time}] ${event.type?.toUpperCase()}: ${event.text}`);
          break;
        case 'dtmf':
          lines.push(
            `  [${time}] DTMF: ${event.digit} — ${event.reason || ''}`
          );
          break;
        case 'ivr_menu':
          lines.push(
            `  [${time}] IVR MENU: ${(event.menuOptions || []).map((o: { digit: string; option: string }) => `${o.digit}=${o.option}`).join(', ')}`
          );
          break;
        case 'transfer':
          lines.push(
            `  [${time}] TRANSFER → ${event.transferNumber} (success=${event.success})`
          );
          break;
        case 'termination':
          lines.push(`  [${time}] TERMINATED: ${event.reason}`);
          break;
        default:
          lines.push(
            `  [${time}] ${event.eventType}: ${JSON.stringify(event)}`
          );
      }
    }
  } else {
    lines.push('  --- No events recorded ---');
  }

  return lines.join('\n');
}

const testCases = process.env.LIVE_EVAL_QUICK
  ? QUICK_TEST_CASES
  : DEFAULT_TEST_CASES;

describe('Live call evaluations', () => {
  beforeAll(async () => {
    const baseUrl = process.env.TWIML_URL || process.env.BASE_URL;
    if (!baseUrl)
      throw new Error(
        'TWIML_URL or BASE_URL must be set to run live call tests'
      );
    if (!process.env.TWILIO_PHONE_NUMBER)
      throw new Error('TWILIO_PHONE_NUMBER must be set');
    if (!process.env.TRANSFER_PHONE_NUMBER)
      throw new Error('TRANSFER_PHONE_NUMBER must be set');

    await connect();
  });

  afterAll(async () => {
    await disconnect();
  });

  testCases.forEach(testCase => {
    const timeoutMs =
      ((testCase.expectedOutcome.maxDurationSeconds ||
        DEFAULT_TIMEOUT_SECONDS) +
        30) *
      1000;

    it(
      testCase.name,
      async () => {
        const result = await executeCall(testCase);
        const { expectedOutcome } = testCase;

        try {
          expect(result.timedOut).toBe(false);

          if (expectedOutcome.maxDTMFPresses !== undefined) {
            const digits = await callHistoryService.getDTMFDigits(
              result.callSid
            );
            expect(digits.length).toBeLessThanOrEqual(
              expectedOutcome.maxDTMFPresses
            );
          }

          if (expectedOutcome.expectedDigits) {
            const digits = await callHistoryService.getDTMFDigits(
              result.callSid
            );
            expectedOutcome.expectedDigits.forEach((digit, i) => {
              expect(digits[i]).toBe(digit);
            });
          }

          if (expectedOutcome.shouldReachHuman !== undefined) {
            const reached = await callHistoryService.hasSuccessfulTransfer(
              result.callSid
            );
            expect(reached).toBe(expectedOutcome.shouldReachHuman);
          }

          if (expectedOutcome.maxDurationSeconds !== undefined) {
            expect(result.durationSeconds).toBeLessThanOrEqual(
              expectedOutcome.maxDurationSeconds
            );
          }

          if (expectedOutcome.minDurationSeconds !== undefined) {
            expect(result.durationSeconds).toBeGreaterThanOrEqual(
              expectedOutcome.minDurationSeconds
            );
          }
        } catch (error) {
          const timeline = await formatCallTimeline(result.callSid);
          console.log(
            `\n📞 CALL DEBUG — ${testCase.name} (${result.durationSeconds}s, ${result.timedOut ? 'TIMED OUT' : result.status}):\n${timeline}\n`
          );
          throw error;
        }
      },
      timeoutMs
    );
  });
});
