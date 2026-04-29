/**
 * Deepgram tier-switch state-machine tests.
 *
 * Covers the URL builder + the `signalHoldStateChange` no-op gate when
 * the feature flag is off and when the model is already at the target.
 *
 * The full WS lifecycle (close + reopen + replay) is integration-tested
 * via the live Hulu validation — this unit test focuses on the
 * deterministic decision logic.
 */

import '../../../jest.setup';
import {
  buildDeepgramUrl,
  isDgTierSwitchEnabled,
  signalHoldStateChange,
  __testing__,
} from '../streamRoutes';

describe('Deepgram tier-switch — URL builder', () => {
  it('uses nova-2-phonecall by default', () => {
    const url = buildDeepgramUrl('nova-2-phonecall');
    expect(url).toContain('model=nova-2-phonecall');
    expect(url).toContain('encoding=mulaw');
    expect(url).toContain('sample_rate=8000');
    expect(url).toContain('endpointing=500');
  });

  it('builds a base-tier URL', () => {
    const url = buildDeepgramUrl('base');
    expect(url).toContain('model=base');
    expect(url).not.toContain('model=nova-2-phonecall');
  });
});

describe('Deepgram tier-switch — feature flag gating', () => {
  const original = process.env.ENABLE_DG_TIER_SWITCH;
  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_DG_TIER_SWITCH;
    else process.env.ENABLE_DG_TIER_SWITCH = original;
  });

  it('isDgTierSwitchEnabled is false when flag unset', () => {
    delete process.env.ENABLE_DG_TIER_SWITCH;
    expect(isDgTierSwitchEnabled()).toBe(false);
  });

  it('isDgTierSwitchEnabled is true only on exact "true"', () => {
    process.env.ENABLE_DG_TIER_SWITCH = 'true';
    expect(isDgTierSwitchEnabled()).toBe(true);
    process.env.ENABLE_DG_TIER_SWITCH = '1';
    expect(isDgTierSwitchEnabled()).toBe(false);
    process.env.ENABLE_DG_TIER_SWITCH = 'TRUE';
    expect(isDgTierSwitchEnabled()).toBe(false);
  });

  it('signalHoldStateChange is a no-op when flag is off', () => {
    delete process.env.ENABLE_DG_TIER_SWITCH;
    const callSid = `noop-${Date.now()}`;
    expect(signalHoldStateChange(callSid, true)).toBe(false);
    expect(signalHoldStateChange(callSid, false)).toBe(false);
  });

  it('signalHoldStateChange is a no-op when no stream state is registered', () => {
    process.env.ENABLE_DG_TIER_SWITCH = 'true';
    const callSid = `unknown-${Date.now()}`;
    expect(signalHoldStateChange(callSid, true)).toBe(false);
  });

  it('signalHoldStateChange swaps current model and is idempotent at target', () => {
    process.env.ENABLE_DG_TIER_SWITCH = 'true';
    const callSid = `swap-${Date.now()}`;

    // Inject a minimal fake stream state directly into the registry.
    const fakeState = {
      callControlId: callSid,
      dgWs: null,
      audioBuffer: [],
      transcript: '',
      speechFired: false,
      lastUtteranceAt: Date.now(),
      silentHoldTimer: null,
      dgReconnects: 0,
      dgSilentMs: 0,
      dgDisconnectedAt: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnectGiveUp: false,
      expectedClose: false,
      onUtterance: null, // null → openDeepgram is skipped, swap still updates state
      semanticWaitTimer: null,
      currentDgModel: 'nova-2-phonecall' as const,
      tierSwitchRingBuffer: [],
    };
    __testing__.activeStreamStates.set(callSid, fakeState as never);

    try {
      // hold → swap to base
      const swapped1 = signalHoldStateChange(callSid, true);
      expect(swapped1).toBe(true);
      expect(__testing__.activeStreamStates.get(callSid)?.currentDgModel).toBe(
        'base'
      );

      // already at base → idempotent no-op
      const swapped2 = signalHoldStateChange(callSid, true);
      expect(swapped2).toBe(false);

      // hold-exit → swap back to nova
      const swapped3 = signalHoldStateChange(callSid, false);
      expect(swapped3).toBe(true);
      expect(__testing__.activeStreamStates.get(callSid)?.currentDgModel).toBe(
        'nova-2-phonecall'
      );
    } finally {
      __testing__.activeStreamStates.delete(callSid);
    }
  });
});
