/**
 * Info Request — Offline Tests (no network, no SMS)
 *
 * Tests stall endpoint TwiML output, special character handling,
 * phone format edge cases, timeout behavior, and DTMF/speech branching.
 * Runs as part of the default test suite.
 */

import '../../../jest.setup';
import request from 'supertest';
import express from 'express';
import callStateManager from '../callStateManager';
import voiceRoutes from '../../routes/voiceRoutes';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/voice', voiceRoutes);

function setupPendingCall(
  callSid: string,
  opts: {
    requestedInfo?: string;
    dataEntryMode?: 'dtmf' | 'speech' | 'none';
    userResponse?: string;
    respondedVia?: 'sms' | 'web';
    requestedAt?: Date;
    userPhone?: string;
  } = {}
) {
  callStateManager.getCallState(callSid);
  callStateManager.updateCallState(callSid, {
    userPhone: opts.userPhone || '+17205551234',
    transferConfig: {
      transferNumber: '+17205550000',
      callPurpose: 'test',
      customInstructions: '',
      aiSettings: { model: 'gpt-4o', maxTokens: 500, temperature: 0.3 },
    } as any,
  });
  callStateManager.setPendingInfoRequest(
    callSid,
    opts.requestedInfo || 'account number',
    opts.dataEntryMode
  );

  if (opts.requestedAt) {
    const state = callStateManager.getCallState(callSid);
    state.pendingInfoRequest!.requestedAt = opts.requestedAt;
  }

  if (opts.userResponse) {
    callStateManager.resolveInfoRequest(
      callSid,
      opts.userResponse,
      opts.respondedVia || 'sms'
    );
  }
}

function postStall(callSid: string) {
  return request(app)
    .post('/voice/stall')
    .type('form')
    .send({ CallSid: callSid })
    .set('Host', 'test.example.com');
}

function postSmsReply(from: string, body: string) {
  return request(app)
    .post('/voice/sms-reply')
    .type('form')
    .send({ From: from, Body: body })
    .set('Host', 'test.example.com');
}

afterEach(() => {
  // Clean up all test states
  for (const sid of [
    'stall-speech',
    'stall-dtmf',
    'stall-dtmf-nodigits',
    'stall-special',
    'stall-timeout',
    'stall-timeout-late',
    'stall-waiting',
    'stall-missing',
    'sms-empty',
    'sms-whitespace',
    'phone-10digit',
    'phone-formatted',
  ]) {
    callStateManager.clearCallState(sid);
  }
});

describe('Stall endpoint — TwiML output after resolution', () => {
  it('speaks the response when dataEntryMode is speech', async () => {
    setupPendingCall('stall-speech', {
      dataEntryMode: 'speech',
      userResponse: '12345678',
    });

    const res = await postStall('stall-speech');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<Say');
    expect(res.text).toContain('12345678');
    // Should also contain a Gather to resume normal flow
    expect(res.text).toContain('<Gather');
    expect(res.text).toContain('process-speech');
  });

  it('sends DTMF digits when dataEntryMode is dtmf and response is numeric', async () => {
    setupPendingCall('stall-dtmf', {
      dataEntryMode: 'dtmf',
      userResponse: '12345',
    });

    const res = await postStall('stall-dtmf');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<Play digits="w12345"');
    expect(res.text).not.toContain('<Say');
    expect(res.text).toContain('<Gather');
  });

  it('falls back to speech when dtmf mode but response has no digits', async () => {
    setupPendingCall('stall-dtmf-nodigits', {
      dataEntryMode: 'dtmf',
      userResponse: 'my account is twelve',
    });

    const res = await postStall('stall-dtmf-nodigits');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<Say');
    expect(res.text).toContain('my account is twelve');
    expect(res.text).not.toContain('<Play digits');
  });
});

describe('Stall endpoint — special characters in reply (E5)', () => {
  it('produces valid XML when response contains <, >, &, quotes', async () => {
    const dangerousResponse = 'account <123> & "456"';
    setupPendingCall('stall-special', {
      dataEntryMode: 'speech',
      userResponse: dangerousResponse,
    });

    const res = await postStall('stall-special');
    expect(res.status).toBe(200);

    // Should be valid XML — Twilio's SDK escapes content in Say elements
    expect(res.text).toContain('</Response>');

    // The response should not contain raw unescaped characters
    expect(res.text).not.toContain('<123>');
    // It should contain the XML-escaped version
    expect(res.text).toMatch(/&lt;123&gt;/);
    expect(res.text).toMatch(/&amp;/);
  });
});

describe('Stall endpoint — timeout behavior (E8)', () => {
  it('returns timeout TwiML after 2 minutes', async () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    setupPendingCall('stall-timeout', { requestedAt: threeMinutesAgo });

    const res = await postStall('stall-timeout');
    expect(res.status).toBe(200);
    expect(res.text).toContain("I don't have that information");
    expect(res.text).toContain('<Gather');
    expect(res.text).toContain('process-speech');
  });

  it('clears pendingInfoRequest on timeout so late replies are ignored (E9)', async () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    setupPendingCall('stall-timeout-late', {
      requestedAt: threeMinutesAgo,
      userPhone: '+17205559999',
    });

    // Trigger timeout
    await postStall('stall-timeout-late');

    // Now try to resolve — should fail since state was cleared
    const resolved = callStateManager.resolveInfoRequest(
      'stall-timeout-late',
      'too late',
      'sms'
    );
    expect(resolved).toBe(false);

    // findCallByUserPhone should also not find it
    expect(callStateManager.findCallByUserPhone('+17205559999')).toBeNull();
  });
});

describe('Stall endpoint — waiting state', () => {
  it('uses Gather (not Redirect) to avoid Twilio redirect limit (E16)', async () => {
    setupPendingCall('stall-waiting');

    const res = await postStall('stall-waiting');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Just a moment');
    // Should use Gather to cycle back, NOT Redirect
    expect(res.text).toContain('<Gather');
    expect(res.text).toContain('/voice/stall');
    expect(res.text).not.toContain('<Redirect');
  });
});

describe('Stall endpoint — missing callSid', () => {
  it('returns error TwiML when no callSid provided', async () => {
    const res = await request(app)
      .post('/voice/stall')
      .type('form')
      .send({})
      .set('Host', 'test.example.com');

    expect(res.status).toBe(200);
    expect(res.text).toContain('An error occurred');
    expect(res.text).toContain('<Hangup');
  });
});

describe('SMS webhook — edge cases', () => {
  it('ignores empty body (E2)', async () => {
    setupPendingCall('sms-empty', { userPhone: '+17205551111' });

    const res = await postSmsReply('+17205551111', '');
    expect(res.status).toBe(200);

    // Should NOT have resolved
    const state = callStateManager.getCallState('sms-empty');
    expect(state.pendingInfoRequest!.userResponse).toBeUndefined();
  });

  it('ignores whitespace-only body (E2)', async () => {
    setupPendingCall('sms-whitespace', { userPhone: '+17205552222' });

    const res = await postSmsReply('+17205552222', '   ');
    expect(res.status).toBe(200);

    const state = callStateManager.getCallState('sms-whitespace');
    expect(state.pendingInfoRequest!.userResponse).toBeUndefined();
  });
});

describe('Phone number normalization edge cases (E7)', () => {
  it('matches 10-digit stored number against 11-digit E.164 From', () => {
    callStateManager.getCallState('phone-10digit');
    callStateManager.updateCallState('phone-10digit', {
      userPhone: '7205551234', // 10 digits, no country code
    });
    callStateManager.setPendingInfoRequest('phone-10digit', 'account number');

    // Twilio sends +1 prefix — normalization strips leading 1
    const match = callStateManager.findCallByUserPhone('+17205551234');
    expect(match).toBe('phone-10digit');
  });

  it('matches formatted stored number against E.164 From', () => {
    callStateManager.getCallState('phone-formatted');
    callStateManager.updateCallState('phone-formatted', {
      userPhone: '(720) 555-1234',
    });
    callStateManager.setPendingInfoRequest('phone-formatted', 'account number');

    // (720) 555-1234 → 7205551234, +17205551234 → 7205551234
    const match = callStateManager.findCallByUserPhone('+17205551234');
    expect(match).toBe('phone-formatted');
  });

  it('matches 11-digit stored number against 11-digit E.164 From', () => {
    callStateManager.getCallState('phone-10digit');
    callStateManager.updateCallState('phone-10digit', {
      userPhone: '+17205551234',
    });
    callStateManager.setPendingInfoRequest('phone-10digit', 'account number');

    const match = callStateManager.findCallByUserPhone('+17205551234');
    expect(match).toBe('phone-10digit');
  });
});
