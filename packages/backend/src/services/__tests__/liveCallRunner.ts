/**
 * Shared live call execution infrastructure.
 * Extracted from liveCallEval.test.ts for reuse by replay-or-live fallback.
 */

import telnyxService from '../telnyxService';
import callHistoryService from '../callHistoryService';
import { TEST_IVR_NUMBERS } from '../liveCallTestCases';
import type { LiveCallTestCase } from '../liveCallTestCases';
import type { RecordedTurn } from './recordedCallTypes';

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_SECONDS = 600;
// Telnyx call states that indicate the call has ended
const TERMINAL_STATUSES = [
  'hangup',
  'failed',
  'busy',
  'no-answer',
  'canceled',
  'completed',
  'terminated',
  'done',
];

export interface CallResult {
  callSid: string;
  status: string;
  durationSeconds: number;
  timedOut: boolean;
}

export function buildWebhookUrl(): string {
  const baseUrl = process.env.TELNYX_WEBHOOK_URL || process.env.BASE_URL || '';
  return baseUrl.endsWith('/voice') ? baseUrl : `${baseUrl}/voice`;
}

export class PhoneNumberPool {
  private available: Array<string>;
  private waiters: Array<(number: string) => void> = [];

  constructor(numbers: Array<string>) {
    this.available = [...numbers];
  }

  async acquire(): Promise<string> {
    const number = this.available.pop();
    if (number) return number;
    return new Promise(resolve => this.waiters.push(resolve));
  }

  release(number: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(number);
    } else {
      this.available.push(number);
    }
  }
}

export const ivrNumberPool = new PhoneNumberPool(TEST_IVR_NUMBERS);

export function isTestIvrCase(testCase: LiveCallTestCase): boolean {
  return TEST_IVR_NUMBERS.includes(testCase.phoneNumber);
}

export async function executeCall(
  testCase: LiveCallTestCase
): Promise<CallResult> {
  const from = process.env.TELNYX_PHONE_NUMBER || '';
  const webhookUrl = buildWebhookUrl();
  const maxDuration =
    testCase.expectedOutcome.maxDurationSeconds || DEFAULT_TIMEOUT_SECONDS;

  const usePool = isTestIvrCase(testCase);
  const phoneNumber = usePool
    ? await ivrNumberPool.acquire()
    : testCase.phoneNumber;

  // Check for saved override instructions (applied via the Fix button in the UI)
  let customInstructions = testCase.customInstructions;
  try {
    const TestCaseOverride = (await import('../../models/TestCaseOverride'))
      .default;
    const override = await TestCaseOverride.findOne({
      testCaseId: testCase.id,
    });
    if (override) {
      customInstructions = override.customInstructions;
      console.log(
        `🔧 Applying saved override for ${testCase.id}: "${customInstructions.slice(0, 80)}..."`
      );
    }
  } catch {
    // DB not available during unit tests — skip silently
  }

  // Encode call config into client_state for Telnyx
  const { encodeClientState } = await import('../../types/telnyx');
  const clientState = encodeClientState({
    transferNumber: process.env.TRANSFER_PHONE_NUMBER || '',
    callPurpose: testCase.callPurpose || 'speak with a representative',
    ...(customInstructions && { customInstructions }),
    ...(testCase.skipInfoRequests !== false && { skipInfoRequests: true }),
  });

  try {
    const call = await telnyxService.initiateCall(
      phoneNumber,
      from,
      clientState,
      webhookUrl
    );
    const callSid = call.sid;
    const startTime = Date.now();
    let status = call.status;
    let timedOut = false;

    let durationSeconds = 0;

    while (true) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const currentCall = await telnyxService.getCallStatus(callSid);
        const data = currentCall.data as { state?: string };
        status = data?.state || status;
      } catch {
        // 422 "Call has already ended" or 404 — treat as terminal
        break;
      }

      if (TERMINAL_STATUSES.includes(status)) break;

      // Also check DB — server writes 'completed'/'failed' on call.hangup webhook
      const dbCall = await callHistoryService.getCall(callSid);
      if (dbCall?.status === 'completed' || dbCall?.status === 'failed') break;

      // Early exit on hold or transfer detection
      if (dbCall) {
        const events = (dbCall.events || []) as Array<{
          eventType: string;
          timestamp?: string | Date;
        }>;
        const hasTransfer = events.some(e => e.eventType === 'transfer');
        const holdEvents = events.filter(e => e.eventType === 'hold');

        // Transfers: exit immediately (AI confirmed a human)
        if (hasTransfer) {
          console.log('🏁 Early exit: transfer detected — ending call');
          durationSeconds = Math.round((Date.now() - startTime) / 1000);
          await telnyxService.terminateCall(callSid).catch(() => {});
          break;
        }

        // Hold: wait 15s to confirm (silent timer can false-positive during slow IVR processing)
        if (holdEvents.length > 0) {
          const latestHold = holdEvents[holdEvents.length - 1];
          const holdAge = latestHold.timestamp
            ? Date.now() - new Date(latestHold.timestamp).getTime()
            : 0;
          if (holdAge > 15_000) {
            console.log(
              `🏁 Early exit: hold queue confirmed (${Math.round(holdAge / 1000)}s ago) — ending call`
            );
            durationSeconds = Math.round((Date.now() - startTime) / 1000);
            await telnyxService.terminateCall(callSid).catch(() => {});
            break;
          }
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > maxDuration) {
        // Cap at maxDuration to avoid off-by-one from polling interval
        durationSeconds = Math.min(maxDuration, Math.round(elapsed));
        await telnyxService.terminateCall(callSid);
        timedOut = true;
        break;
      }
    }

    if (durationSeconds === 0) {
      durationSeconds = Math.round((Date.now() - startTime) / 1000);
    }
    return { callSid, status, durationSeconds, timedOut };
  } finally {
    if (usePool) ivrNumberPool.release(phoneNumber);
  }
}

export async function formatCallTimeline(callSid: string): Promise<string> {
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
        case 'hold':
          lines.push(`  [${time}] HOLD: Hold queue detected`);
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

export async function buildRecordedTurns(
  callSid: string
): Promise<Array<RecordedTurn>> {
  const call = await callHistoryService.getCall(callSid);
  if (!call?.events?.length) return [];

  const turns: Array<RecordedTurn> = [];
  let turnNumber = 0;

  for (let i = 0; i < call.events.length; i++) {
    const event = call.events[i];
    if (event.eventType !== 'conversation' || event.type !== 'user') continue;

    turnNumber++;
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

  return turns;
}

export async function getCallOutcome(
  callSid: string,
  durationSeconds: number,
  callStatus: string
): Promise<{
  finalStatus: string;
  durationSeconds: number;
  reachedHuman: boolean;
  dtmfDigits: Array<string>;
}> {
  const digits = await callHistoryService.getDTMFDigits(callSid);
  const transferred = await callHistoryService.hasSuccessfulTransfer(callSid);
  const onHold = await callHistoryService.hasReachedHoldQueue(callSid);

  return {
    finalStatus: callStatus,
    durationSeconds,
    reachedHuman: transferred || onHold,
    dtmfDigits: digits,
  };
}

export async function hasBusinessClosed(callSid: string): Promise<boolean> {
  const reason = await callHistoryService.getTerminationReason(callSid);
  if (reason === 'closed_no_menu') return true;

  // Secondary check: scan IVR speech for closed/hours language in case the AI
  // didn't record a termination event (e.g. short call, immediate rejection)
  const call = await callHistoryService.getCall(callSid);
  if (!call?.events) return false;
  const CLOSED_PATTERN =
    /\b(closed|not available|business hours|call back|outside.*hours|hours.*monday|our hours|after hours|operating hours)\b/i;
  return call.events
    .filter(e => e.eventType === 'conversation' && e.type === 'user')
    .some(e => CLOSED_PATTERN.test(e.text || ''));
}

export function hasTelnyxCreds(): boolean {
  return !!(
    process.env.TELNYX_API_KEY &&
    process.env.TELNYX_CONNECTION_ID &&
    process.env.TELNYX_PHONE_NUMBER &&
    (process.env.TELNYX_WEBHOOK_URL || process.env.BASE_URL)
  );
}
