/**
 * Verifies the DTMF settle delay: before pressing a tone, we wait until at
 * least DTMF_SETTLE_MS has elapsed since the IVR's last speech_final
 * (`userSpeechEndedAt`). Otherwise, when Deepgram reports speech_final but
 * the IVR audio is still streaming, our DTMF press lands during the prompt
 * and the IVR rejects the input ("did not receive your input").
 */

import '../../../jest.setup';
import callStateManager from '../callStateManager';
import { __testing } from '../speechProcessingService';

const { DTMF_SETTLE_MS, waitForDTMFSettle } = __testing;

describe('waitForDTMFSettle', () => {
  const callSid = 'test-call-settle';

  beforeEach(() => {
    callStateManager.clearCallState(callSid);
    callStateManager.getCallState(callSid); // ensure entry exists
  });

  afterEach(() => {
    callStateManager.clearCallState(callSid);
  });

  it('waits the remaining settle window when speech ended recently', async () => {
    const now = Date.now();
    callStateManager.updateCallState(callSid, {
      userSpeechEndedAt: now - 100,
    });

    const start = Date.now();
    await waitForDTMFSettle(callSid);
    const elapsed = Date.now() - start;

    // We should have slept ~300ms (400 - 100). Allow ±100ms tolerance.
    const expected = DTMF_SETTLE_MS - 100;
    expect(elapsed).toBeGreaterThanOrEqual(expected - 50);
    expect(elapsed).toBeLessThanOrEqual(expected + 150);
  });

  it('returns immediately when the settle window has already elapsed', async () => {
    callStateManager.updateCallState(callSid, {
      userSpeechEndedAt: Date.now() - (DTMF_SETTLE_MS + 200),
    });

    const start = Date.now();
    await waitForDTMFSettle(callSid);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('returns immediately when userSpeechEndedAt is unset', async () => {
    const start = Date.now();
    await waitForDTMFSettle(callSid);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
