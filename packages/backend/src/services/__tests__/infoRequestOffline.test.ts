/**
 * Info Request — Offline Tests (no network, no SMS)
 *
 * Tests stall timer behavior (speakText/sendDTMF calls), special character handling,
 * phone format edge cases, timeout behavior, and DTMF/speech branching.
 * Runs as part of the default test suite.
 */

import '../../../jest.setup';
import request from 'supertest';
import express from 'express';
import callStateManager from '../callStateManager';
import telnyxService from '../telnyxService';
import voiceRoutes, { startStallTimer } from '../../routes/voiceRoutes';

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
      aiSettings: {
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 500,
        temperature: 0.3,
      },
    } as any,
  });
  callStateManager.setPendingInfoRequest(
    callSid,
    opts.requestedInfo || 'account number',
    opts.dataEntryMode
  );

  if (opts.userResponse) {
    callStateManager.resolveInfoRequest(
      callSid,
      opts.userResponse,
      opts.respondedVia || 'sms'
    );
  }
}

function postSmsReply(from: string, body: string) {
  return request(app)
    .post('/voice/sms-reply')
    .type('form')
    .send({ From: from, Body: body })
    .set('Host', 'test.example.com');
}

let speakTextSpy: jest.SpyInstance;
let sendDTMFSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  speakTextSpy = jest
    .spyOn(telnyxService, 'speakText')
    .mockResolvedValue(undefined);
  sendDTMFSpy = jest.spyOn(telnyxService, 'sendDTMF').mockResolvedValue(true);
  jest.spyOn(telnyxService, 'terminateCall').mockResolvedValue(undefined);
  jest.spyOn(telnyxService, 'transfer').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  for (const sid of [
    'stall-speech',
    'stall-dtmf',
    'stall-dtmf-nodigits',
    'stall-special',
    'stall-timeout',
    'stall-timeout-late',
    'stall-waiting',
    'sms-empty',
    'sms-whitespace',
    'phone-10digit',
    'phone-formatted',
  ]) {
    callStateManager.clearCallState(sid);
  }
});

describe('Stall timer — resolution via speakText/sendDTMF', () => {
  it('calls speakText with the user response when dataEntryMode is speech', async () => {
    setupPendingCall('stall-speech', {
      dataEntryMode: 'speech',
      userResponse: '12345678',
    });

    startStallTimer('stall-speech');
    await jest.runAllTimersAsync();

    expect(speakTextSpy).toHaveBeenCalledWith(
      'stall-speech',
      '12345678',
      expect.any(String)
    );
    expect(sendDTMFSpy).not.toHaveBeenCalled();
  });

  it('calls sendDTMF when dataEntryMode is dtmf and response is numeric', async () => {
    setupPendingCall('stall-dtmf', {
      dataEntryMode: 'dtmf',
      userResponse: '12345',
    });

    startStallTimer('stall-dtmf');
    await jest.runAllTimersAsync();

    expect(sendDTMFSpy).toHaveBeenCalledWith('stall-dtmf', 'ww12345');
    expect(speakTextSpy).not.toHaveBeenCalled();
  });

  it('falls back to speakText when dtmf mode but response has no digits', async () => {
    setupPendingCall('stall-dtmf-nodigits', {
      dataEntryMode: 'dtmf',
      userResponse: 'my account is twelve',
    });

    startStallTimer('stall-dtmf-nodigits');
    await jest.runAllTimersAsync();

    expect(speakTextSpy).toHaveBeenCalledWith(
      'stall-dtmf-nodigits',
      'my account is twelve',
      expect.any(String)
    );
    expect(sendDTMFSpy).not.toHaveBeenCalled();
  });

  it('calls speakText with special characters passed as-is (no XML escaping needed)', async () => {
    const dangerousResponse = 'account <123> & "456"';
    setupPendingCall('stall-special', {
      dataEntryMode: 'speech',
      userResponse: dangerousResponse,
    });

    startStallTimer('stall-special');
    await jest.runAllTimersAsync();

    expect(speakTextSpy).toHaveBeenCalledWith(
      'stall-special',
      dangerousResponse,
      expect.any(String)
    );
  });
});

describe('Stall timer — timeout behavior', () => {
  it('speaks timeout message after 2 minutes with no response', async () => {
    setupPendingCall('stall-timeout');

    startStallTimer('stall-timeout');

    // Advance past the 2-minute timeout
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);

    expect(speakTextSpy).toHaveBeenCalledWith(
      'stall-timeout',
      "I don't have that information. Can I speak with a representative?",
      expect.any(String)
    );
  });

  it('clears pendingInfoRequest on timeout so late replies are ignored', async () => {
    setupPendingCall('stall-timeout-late', { userPhone: '+17205559999' });

    startStallTimer('stall-timeout-late');
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);

    // Late SMS reply should not resolve anything
    const resolved = callStateManager.resolveInfoRequest(
      'stall-timeout-late',
      'too late',
      'sms'
    );
    expect(resolved).toBe(false);

    expect(callStateManager.findCallByUserPhone('+17205559999')).toBeNull();
  });
});

describe('Stall timer — waiting state (no response yet)', () => {
  it('does not call speakText or sendDTMF while waiting for user response', async () => {
    setupPendingCall('stall-waiting'); // no userResponse set

    startStallTimer('stall-waiting');

    // Advance just one tick — should not fire yet
    await jest.advanceTimersByTimeAsync(100);

    expect(speakTextSpy).not.toHaveBeenCalled();
    expect(sendDTMFSpy).not.toHaveBeenCalled();

    // Clean up the timer
    callStateManager.clearCallState('stall-waiting');
  });
});

describe('SMS webhook — edge cases', () => {
  it('ignores empty body (E2)', async () => {
    setupPendingCall('sms-empty', { userPhone: '+17205551111' });

    const res = await postSmsReply('+17205551111', '');
    expect(res.status).toBe(200);

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

    const match = callStateManager.findCallByUserPhone('+17205551234');
    expect(match).toBe('phone-10digit');
  });

  it('matches formatted stored number against E.164 From', () => {
    callStateManager.getCallState('phone-formatted');
    callStateManager.updateCallState('phone-formatted', {
      userPhone: '(720) 555-1234',
    });
    callStateManager.setPendingInfoRequest('phone-formatted', 'account number');

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
