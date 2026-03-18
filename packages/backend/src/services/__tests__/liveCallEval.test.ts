/**
 * Live Call Evaluation Tests (Jest).
 * Makes real Twilio calls and validates IVR navigation using existing services.
 * Run: pnpm --filter backend test:live
 */

import '../../../jest.setup';
import * as fs from 'fs';
import * as path from 'path';
import twilioService from '../twilioService';
import callHistoryService from '../callHistoryService';
import { connect, disconnect } from '../database';
import {
  DEFAULT_TEST_CASES,
  QUICK_TEST_CASES,
  TEST_IVR_CASES,
} from '../liveCallTestCases';
import type { LiveCallTestCase } from '../liveCallTestCases';
import type { RecordedCall, RecordedTurn } from './recordedCallTypes';

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_SECONDS = 600;
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

async function recordCall(
  callSid: string,
  testCase: LiveCallTestCase,
  durationSeconds: number
): Promise<void> {
  const call = await callHistoryService.getCall(callSid);
  if (!call?.events?.length) return;

  const turns: Array<RecordedTurn> = [];
  let turnNumber = 0;

  for (let i = 0; i < call.events.length; i++) {
    const event = call.events[i];
    if (event.eventType !== 'conversation' || event.type !== 'user') continue;

    turnNumber++;
    // Find the next AI action: only dtmf, speak, or wait (real AI decisions)
    // Skip transfer/termination — those are system events, not decideAction() outputs
    let aiAction = null;
    for (let j = i + 1; j < call.events.length; j++) {
      const next = call.events[j];
      if (next.eventType === 'dtmf') {
        aiAction = {
          action: 'press_digit' as const,
          digit: next.digit,
          reason: next.reason || '',
          detected: {
            isIVRMenu: true,
            menuOptions: [],
            isMenuComplete: true,
            loopDetected: false,
            shouldTerminate: false,
            transferRequested: false,
          },
        };
        break;
      }
      if (next.eventType === 'conversation' && next.type === 'ai') {
        aiAction = {
          action: 'speak' as const,
          speech: next.text,
          reason: '',
          detected: {
            isIVRMenu: false,
            menuOptions: [],
            isMenuComplete: false,
            loopDetected: false,
            shouldTerminate: false,
            transferRequested: false,
          },
        };
        break;
      }
      // Next user speech with no AI action in between means AI waited
      if (next.eventType === 'conversation' && next.type === 'user') {
        aiAction = {
          action: 'wait' as const,
          reason: 'No action before next speech',
          detected: {
            isIVRMenu: false,
            menuOptions: [],
            isMenuComplete: false,
            loopDetected: false,
            shouldTerminate: false,
            transferRequested: false,
          },
        };
        break;
      }
      // Stop at system events — remaining turns after transfer/termination aren't AI-replayable
      if (next.eventType === 'transfer' || next.eventType === 'termination')
        break;
    }

    if (aiAction) {
      turns.push({
        turnNumber,
        ivrSpeech: event.text || '',
        aiAction: aiAction as RecordedTurn['aiAction'],
      });
    }
  }

  if (turns.length === 0) return;

  const digits = await callHistoryService.getDTMFDigits(callSid);
  const reached = await callHistoryService.hasSuccessfulTransfer(callSid);

  const recorded: RecordedCall = {
    id: `${testCase.id}-${new Date().toISOString().slice(0, 10)}`,
    testCaseId: testCase.id,
    recordedAt: new Date().toISOString(),
    config: {
      callPurpose: testCase.callPurpose,
      customInstructions: testCase.customInstructions,
    },
    turns,
    outcome: {
      finalStatus: call.status || 'unknown',
      durationSeconds,
      reachedHuman: reached,
      dtmfDigits: digits,
    },
  };

  const fixturesDir = path.join(__dirname, 'fixtures');
  const filename = `${recorded.id}.json`;
  fs.writeFileSync(
    path.join(fixturesDir, filename),
    JSON.stringify(recorded, null, 2)
  );
  console.log(`Recorded call fixture: ${filename} (${turns.length} turns)`);
}

const testCases = process.env.LIVE_EVAL_IVR
  ? TEST_IVR_CASES
  : process.env.LIVE_EVAL_QUICK
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
        } finally {
          if (process.env.RECORD_CALLS === '1') {
            await recordCall(result.callSid, testCase, result.durationSeconds);
          }
        }
      },
      timeoutMs
    );
  });
});
