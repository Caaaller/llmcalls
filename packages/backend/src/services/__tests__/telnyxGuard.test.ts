/**
 * Regression: telnyxService.guardedAction must short-circuit outbound
 * per-call actions (speakText, sendDTMF, transfer, startStreaming) when
 * callStateManager.isCallEnded(callSid) is true. This prevents the
 * "ghost transfer 14s after caller hangup" class of bugs.
 */

import callStateManager from '../callStateManager';

const speak = jest.fn().mockResolvedValue(undefined);
const sendDtmf = jest.fn().mockResolvedValue(undefined);
const transfer = jest.fn().mockResolvedValue(undefined);

jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    calls: {
      actions: {
        speak: (...args: unknown[]) => speak(...args),
        sendDtmf: (...args: unknown[]) => sendDtmf(...args),
        transfer: (...args: unknown[]) => transfer(...args),
      },
    },
  }));
});

process.env.TELNYX_API_KEY = 'test';
process.env.TELNYX_PHONE_NUMBER = '+15555551212';

// Import AFTER mocks + env
import telnyxService from '../telnyxService';

describe('telnyxService guardedAction', () => {
  const CALL_SID = 'test-call-sid-123';

  beforeEach(() => {
    speak.mockClear();
    sendDtmf.mockClear();
    transfer.mockClear();
  });

  it('speakText no-ops when call is ended', async () => {
    jest.spyOn(callStateManager, 'isCallEnded').mockReturnValue(true);
    await telnyxService.speakText(CALL_SID, 'hello');
    expect(speak).not.toHaveBeenCalled();
  });

  it('transfer no-ops when call is ended', async () => {
    jest.spyOn(callStateManager, 'isCallEnded').mockReturnValue(true);
    await telnyxService.transfer(CALL_SID, '+17205846358');
    expect(transfer).not.toHaveBeenCalled();
  });

  it('speakText calls SDK when call is live', async () => {
    jest.spyOn(callStateManager, 'isCallEnded').mockReturnValue(false);
    await telnyxService.speakText(CALL_SID, 'hello');
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('transfer calls SDK when call is live', async () => {
    jest.spyOn(callStateManager, 'isCallEnded').mockReturnValue(false);
    await telnyxService.transfer(CALL_SID, '+17205846358');
    expect(transfer).toHaveBeenCalledTimes(1);
  });
});
