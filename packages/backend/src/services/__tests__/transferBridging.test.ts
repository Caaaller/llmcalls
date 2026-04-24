/**
 * Transfer Bridging — unit tests
 *
 * Regression guard for the "3-way call" bug: when the AI detected a human,
 * the old code called `client.calls.actions.transfer(A, { to: user })` which
 * left our AI leg A active in the bridge with the user and the agent —
 * producing a 3-way call where the user could still hear (and be heard by)
 * our AI after the handoff.
 *
 * The fix: dial the user as a SEPARATE outbound leg C with a
 * `bridgeSourceCallControlId` in client_state, and on `call.answered` bridge
 * A↔C directly so our backend drops out of the media path. When either leg
 * hangs up, Telnyx tears down the bridge and the other is hung up.
 *
 * These tests mock the Telnyx SDK so we can assert exactly which SDK calls
 * fire with which arguments — no network involved.
 */

const dialMock = jest.fn();
const bridgeMock = jest.fn();
const speakMock = jest.fn().mockResolvedValue(undefined);
const answerMock = jest.fn().mockResolvedValue(undefined);
const hangupMock = jest.fn().mockResolvedValue(undefined);

jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    calls: {
      dial: dialMock,
      actions: {
        bridge: bridgeMock,
        speak: speakMock,
        answer: answerMock,
        hangup: hangupMock,
      },
    },
  }));
});

process.env.TELNYX_API_KEY = 'test';
process.env.TELNYX_PHONE_NUMBER = '+15555550100';
process.env.TELNYX_CONNECTION_ID = 'conn-test';

import telnyxService from '../telnyxService';
import {
  encodeBridgeClientState,
  decodeBridgeSourceFromClientState,
} from '../../types/telnyx';

describe('bridge client_state encoding', () => {
  it('round-trips bridgeSourceCallControlId through base64 JSON', () => {
    const sourceId = 'v3:abc123-source-leg';
    const encoded = encodeBridgeClientState({
      bridgeSourceCallControlId: sourceId,
    });
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain(sourceId); // base64 should obscure
    expect(decodeBridgeSourceFromClientState(encoded)).toBe(sourceId);
  });

  it('returns null for missing / malformed / unrelated client_state', () => {
    expect(decodeBridgeSourceFromClientState(undefined)).toBeNull();
    expect(decodeBridgeSourceFromClientState('')).toBeNull();
    expect(decodeBridgeSourceFromClientState('not-base64!!')).toBeNull();

    // Unrelated client_state (e.g. regular TelnyxCallConfig) must not be
    // mistaken for a bridge payload — decoder looks for the specific field.
    const unrelated = Buffer.from(
      JSON.stringify({ transferNumber: '+15551234567', callPurpose: 'foo' })
    ).toString('base64');
    expect(decodeBridgeSourceFromClientState(unrelated)).toBeNull();

    // Field present but empty-string must also fail — prevents us from
    // trying to bridge to a blank id.
    const empty = encodeBridgeClientState({ bridgeSourceCallControlId: '' });
    expect(decodeBridgeSourceFromClientState(empty)).toBeNull();
  });
});

describe('telnyxService.dialForBridge', () => {
  beforeEach(() => {
    dialMock.mockReset();
    dialMock.mockResolvedValue({
      data: { call_control_id: 'v3:new-target-leg' },
    });
  });

  it('dials the user with bridge source encoded in client_state (no 3-way: no actions.transfer)', async () => {
    const sourceId = 'v3:source-ai-leg';
    const newLegId = await telnyxService.dialForBridge({
      sourceCallControlId: sourceId,
      userPhone: '3033962866',
      webhookUrl: 'https://example.ngrok-free.app/voice',
    });

    expect(newLegId).toBe('v3:new-target-leg');
    expect(dialMock).toHaveBeenCalledTimes(1);

    const dialArgs = dialMock.mock.calls[0][0];
    expect(dialArgs.to).toBe('+13033962866'); // e164 normalized
    expect(dialArgs.from).toBe('+15555550100');
    expect(dialArgs.connection_id).toBe('conn-test');
    expect(dialArgs.webhook_url).toBe('https://example.ngrok-free.app/voice');

    // The key regression guard: client_state must decode to the source leg id
    // so the webhook handler can bridge A↔C on call.answered.
    expect(decodeBridgeSourceFromClientState(dialArgs.client_state)).toBe(
      sourceId
    );
  });

  it('omits webhook_url when none provided', async () => {
    await telnyxService.dialForBridge({
      sourceCallControlId: 'v3:source',
      userPhone: '+15551234567',
    });
    expect(dialMock.mock.calls[0][0].webhook_url).toBeUndefined();
  });
});

describe('telnyxService.bridgeCalls', () => {
  beforeEach(() => {
    bridgeMock.mockReset();
    bridgeMock.mockResolvedValue(undefined);
  });

  it('calls actions.bridge with the target leg id', async () => {
    await telnyxService.bridgeCalls('v3:source-A', 'v3:target-C');

    expect(bridgeMock).toHaveBeenCalledTimes(1);
    // First positional arg is the source call_control_id, second is the
    // body with call_control_id_to_bridge_with — this is the Telnyx API
    // that actually makes the handoff clean (A drops out of media path).
    expect(bridgeMock.mock.calls[0][0]).toBe('v3:source-A');
    expect(bridgeMock.mock.calls[0][1]).toEqual({
      call_control_id_to_bridge_with: 'v3:target-C',
    });
  });
});

describe('end-to-end dial → decode → bridge (regression guard)', () => {
  beforeEach(() => {
    dialMock.mockReset();
    bridgeMock.mockReset();
    dialMock.mockResolvedValue({
      data: { call_control_id: 'v3:C-user-leg' },
    });
    bridgeMock.mockResolvedValue(undefined);
  });

  it('client_state written by dialForBridge decodes back to the same source id the webhook will use to bridge', async () => {
    const sourceId = 'v3:A-ai-leg';

    // Step 1: AI decides human_detected → dial user as separate leg
    await telnyxService.dialForBridge({
      sourceCallControlId: sourceId,
      userPhone: '+15551234567',
    });
    const writtenClientState = dialMock.mock.calls[0][0].client_state;

    // Step 2: webhook sees call.answered for C with that client_state,
    // decodes it, then bridges the two legs.
    const decodedSourceId =
      decodeBridgeSourceFromClientState(writtenClientState);
    expect(decodedSourceId).toBe(sourceId);

    await telnyxService.bridgeCalls(decodedSourceId!, 'v3:C-user-leg');

    // Final assertion: bridge was called with both real call_control_ids
    // (A and C), NOT with the legacy `actions.transfer({ to: user })` shape
    // that caused the 3-way call bug.
    expect(bridgeMock).toHaveBeenCalledWith(sourceId, {
      call_control_id_to_bridge_with: 'v3:C-user-leg',
    });
  });
});
