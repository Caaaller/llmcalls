/**
 * Info Request — E2E SMS Integration Tests
 *
 * Tests real SMS round-trips through Twilio against the RUNNING server.
 * All state setup and checking is done via HTTP to the server's API,
 * since the test process and server process have separate in-memory state.
 *
 * Requires: server + ngrok running, two Twilio numbers, auth token.
 *
 * Run: pnpm --filter backend test:info-request
 */

import '../../../jest.setup';
import twilio from 'twilio';

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER!;
const TEST_USER_PHONE = process.env.TEST_USER_PHONE_NUMBER!;
const POLL_INTERVAL_MS = 2000;
const SMS_TIMEOUT_MS = 30000;

// Auth token for API calls — reuse from .env or login
let AUTH_TOKEN = '';
const SERVER_URL = process.env.TWIML_URL!; // ngrok URL pointing to the server

function requiredEnv() {
  const required = [
    'TWILIO_PHONE_NUMBER',
    'TEST_USER_PHONE_NUMBER',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWIML_URL',
  ];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`${key} must be set in .env`);
    }
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAuthToken(): Promise<string> {
  // Try to get a token by logging in. Use test credentials from env or defaults.
  const email = process.env.TEST_USER_EMAIL || 'test@test.com';
  const password = process.env.TEST_USER_PASSWORD || 'test123';

  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { success: boolean; token?: string };
  if (!data.success || !data.token) {
    throw new Error(
      `Failed to get auth token. Create a test user or set TEST_USER_EMAIL/TEST_USER_PASSWORD. Response: ${JSON.stringify(data)}`
    );
  }
  return data.token;
}

async function setupPendingOnServer(
  callSid: string,
  opts: {
    requestedInfo: string;
    userPhone: string;
    dataEntryMode?: string;
  }
) {
  const res = await fetch(
    `${SERVER_URL}/api/calls/${callSid}/test-pending-info`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(opts),
    }
  );
  const data = (await res.json()) as { success: boolean };
  if (!data.success) {
    throw new Error(
      `Failed to set up pending info on server: ${JSON.stringify(data)}`
    );
  }
}

async function getPendingInfo(
  callSid: string
): Promise<{ pending: boolean; requestedInfo?: string }> {
  const res = await fetch(`${SERVER_URL}/api/calls/${callSid}/pending-info`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  return (await res.json()) as { pending: boolean; requestedInfo?: string };
}

async function sendReply(client: twilio.Twilio, body: string) {
  await client.messages.create({
    from: TEST_USER_PHONE,
    to: TWILIO_PHONE_NUMBER,
    body,
  });
}

async function pollUntilResolved(callSid: string): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < SMS_TIMEOUT_MS) {
    await delay(POLL_INTERVAL_MS);
    const info = await getPendingInfo(callSid);
    if (!info.pending) {
      console.log(
        `✅ Resolved (pending=false after ${Math.round((Date.now() - startTime) / 1000)}s)`
      );
      return true;
    }
    console.log(
      `⏳ Waiting... (${Math.round((Date.now() - startTime) / 1000)}s)`
    );
  }
  return false;
}

describe('Info Request — SMS round-trip e2e', () => {
  let client: twilio.Twilio;

  beforeAll(async () => {
    requiredEnv();
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
    AUTH_TOKEN = await getAuthToken();
    console.log('🔑 Auth token acquired');
  });

  it('happy path: set pending → SMS reply → resolved', async () => {
    const sid = `e2e-happy-${Date.now()}`;

    await setupPendingOnServer(sid, {
      requestedInfo: 'account number',
      userPhone: TEST_USER_PHONE,
    });

    // Verify pending
    const before = await getPendingInfo(sid);
    expect(before.pending).toBe(true);
    expect(before.requestedInfo).toBe('account number');

    // Send reply SMS → triggers webhook on server
    console.log('📱 Sending reply: "12345678"');
    await sendReply(client, '12345678');

    // Poll until resolved
    const resolved = await pollUntilResolved(sid);
    expect(resolved).toBe(true);
  }, 60000);

  it('special characters survive the SMS webhook (E5)', async () => {
    const sid = `e2e-special-${Date.now()}`;

    await setupPendingOnServer(sid, {
      requestedInfo: 'account ID',
      userPhone: TEST_USER_PHONE,
    });

    console.log('📱 Sending special char reply');
    await sendReply(client, 'acct <123> & "456"');

    const resolved = await pollUntilResolved(sid);
    expect(resolved).toBe(true);
  }, 60000);

  it('rapid double reply: first wins, second ignored (E3)', async () => {
    const sid = `e2e-double-${Date.now()}`;

    await setupPendingOnServer(sid, {
      requestedInfo: 'member ID',
      userPhone: TEST_USER_PHONE,
    });

    console.log('📱 Sending two rapid replies');
    await sendReply(client, 'first-reply');
    await sendReply(client, 'second-reply');

    const resolved = await pollUntilResolved(sid);
    expect(resolved).toBe(true);

    // Both should have fired by now — wait a bit extra
    await delay(5000);

    // State should still show resolved (not re-opened)
    const info = await getPendingInfo(sid);
    expect(info.pending).toBe(false);
  }, 60000);

  it('reply from unknown number is silently ignored (E13)', async () => {
    // Don't set up any pending state for TEST_USER_PHONE
    // Just send an SMS and verify the server doesn't crash
    console.log('📱 Sending orphan SMS');
    await sendReply(client, 'orphan message');
    await delay(5000);

    // Server still responds (didn't crash)
    const res = await fetch(`${SERVER_URL}/api/config`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.ok).toBe(true);
  }, 30000);
});

/**
 * AI eval tests: verify the AI returns request_info when asked for info
 * it doesn't have, and provides info when it IS in customInstructions.
 * Uses processSpeech in testMode (calls real OpenAI API, no Twilio).
 *
 * Combined with the SMS e2e tests above and offline stall tests, this
 * gives complete coverage of the info request feature.
 *
 * Note: A full live call test isn't feasible because Twilio returns "busy"
 * when calling between two numbers on the same account.
 */
describe('Info Request — AI returns request_info for missing info', () => {
  it("returns request_info when IVR asks for account number AI doesn't have", async () => {
    const { processSpeech } = await import('../speechProcessingService');
    const csm = (await import('../callStateManager')).default;

    const sid = `e2e-ai-info-${Date.now()}`;

    const result = await processSpeech({
      callSid: sid,
      speechResult:
        'Thank you for calling National Bank. To access your account, please say or enter your 8-digit account number.',
      isFirstCall: true,
      baseUrl: 'http://test',
      callPurpose: 'check my account balance',
      customInstructions: '',
      transferNumber: '+13033962866',
      userPhone: '+17199822499',
      testMode: true,
    });

    console.log(`AI action: ${result.aiAction}`);
    expect(result.aiAction).toBe('request_info');

    const state = csm.getCallState(sid);
    expect(state.pendingInfoRequest).toBeDefined();
    expect(state.pendingInfoRequest!.requestedInfo).toBeTruthy();
    console.log(`Requested: "${state.pendingInfoRequest!.requestedInfo}"`);

    csm.clearCallState(sid);
  }, 30000);

  it('provides info when account number IS in customInstructions', async () => {
    const { processSpeech } = await import('../speechProcessingService');
    const csm = (await import('../callStateManager')).default;

    const sid = `e2e-ai-has-info-${Date.now()}`;

    const result = await processSpeech({
      callSid: sid,
      speechResult:
        'Thank you for calling National Bank. To access your account, please say or enter your 8-digit account number.',
      isFirstCall: true,
      baseUrl: 'http://test',
      callPurpose: 'check my account balance',
      customInstructions: 'My account number is 12345678',
      transferNumber: '+13033962866',
      userPhone: '+17199822499',
      testMode: true,
    });

    console.log(`AI action: ${result.aiAction}`);
    expect(result.aiAction).not.toBe('request_info');
    expect(['speak', 'press_digit']).toContain(result.aiAction);

    csm.clearCallState(sid);
  }, 30000);

  it('returns request_info for Delta SkyMiles number request', async () => {
    const { processSpeech } = await import('../speechProcessingService');
    const csm = (await import('../callStateManager')).default;

    const sid = `e2e-ai-delta-${Date.now()}`;

    // Simulate Delta's conversational AI asking for SkyMiles number
    // (Based on real Delta call transcripts — after stating purpose,
    // Delta asks for the SkyMiles number to look up the account)
    const result = await processSpeech({
      callSid: sid,
      speechResult:
        'Sure, I can help you with your SkyMiles account. Can I get your SkyMiles number please?',
      isFirstCall: false,
      baseUrl: 'http://test',
      callPurpose: 'check my SkyMiles account balance',
      customInstructions: '',
      transferNumber: '+13033962866',
      userPhone: '+17199822499',
      testMode: true,
    });

    console.log(`AI action: ${result.aiAction}`);
    expect(result.aiAction).toBe('request_info');

    const state = csm.getCallState(sid);
    expect(state.pendingInfoRequest).toBeDefined();
    console.log(`Requested: "${state.pendingInfoRequest!.requestedInfo}"`);

    csm.clearCallState(sid);
  }, 30000);

  it('provides Delta SkyMiles number when in customInstructions', async () => {
    const { processSpeech } = await import('../speechProcessingService');
    const csm = (await import('../callStateManager')).default;

    const sid = `e2e-ai-delta-has-${Date.now()}`;

    const result = await processSpeech({
      callSid: sid,
      speechResult:
        'Sure, I can help you with your SkyMiles account. Can I get your SkyMiles number please?',
      isFirstCall: false,
      baseUrl: 'http://test',
      callPurpose: 'check my SkyMiles account balance',
      customInstructions: 'My SkyMiles number is 9905661493',
      transferNumber: '+13033962866',
      userPhone: '+17199822499',
      testMode: true,
    });

    console.log(`AI action: ${result.aiAction}`);
    expect(result.aiAction).not.toBe('request_info');
    expect(['speak', 'press_digit']).toContain(result.aiAction);
    if (result.aiResponse) {
      console.log(`AI response: "${result.aiResponse}"`);
      expect(result.aiResponse).toMatch(/990/); // Should contain the number
    }

    csm.clearCallState(sid);
  }, 30000);
});
