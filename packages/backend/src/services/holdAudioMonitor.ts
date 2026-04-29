/**
 * Hold low-power-mode audio monitor.
 *
 * When a call enters detected hold, we want to stop forwarding inbound audio
 * frames to Deepgram so we don't burn STT cost transcribing hold music. This
 * module is a pure (no Telnyx/network deps) state machine that consumes
 * mu-law (PCMU) audio frames and tells the caller when the call is likely
 * transitioning back to a human (silence break or speech-like onset).
 *
 * The Telnyx media payload arrives as base64 PCMU @ 8kHz mono. We decode
 * mu-law to 16-bit linear and compute RMS over each frame to track energy.
 * Hold music has fairly steady energy with no long silences; a human
 * picking up typically produces either:
 *   - silence-break: a sustained-energy stretch followed by silence > 1.5s
 *     (the hold music ends, then "Hello?")
 *   - speech-onset: an energy burst whose RMS profile differs from the
 *     prior rolling baseline (loud sudden voice over previously steady music)
 *
 * Periodic forced probes every ~30s let Deepgram briefly transcribe a 3s
 * window so we sanity-check we haven't missed the transition.
 */

const MULAW_DECODE: Int16Array = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    t[i] = sign ? -sample : sample;
  }
  return t;
})();

/** Compute RMS energy for a PCMU buffer. Returns linear amplitude (0..32767). */
export function computePcmuRms(pcmu: Buffer): number {
  if (pcmu.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < pcmu.length; i++) {
    const sample = MULAW_DECODE[pcmu[i]];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / pcmu.length);
}

export type WakeReason = 'silence-break' | 'speech-onset' | 'periodic-probe';

export interface MonitorConfig {
  /** RMS below this counts as silence. */
  silenceThreshold: number;
  /** Sustained-energy stretch (ms) required before a silence break can wake. */
  minSustainedEnergyMs: number;
  /** Silence (ms) after sustained energy that triggers silence-break wake. */
  silenceBreakMs: number;
  /** RMS above this for `speechOnsetSustainedMs` triggers speech-onset wake
   *  (must exceed the rolling baseline by at least `speechOnsetMargin` ratio). */
  speechOnsetSustainedMs: number;
  speechOnsetMargin: number;
  /** How often to fire periodic probes. */
  probeIntervalMs: number;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  silenceThreshold: 200,
  minSustainedEnergyMs: 1500,
  silenceBreakMs: 1500,
  speechOnsetSustainedMs: 250,
  speechOnsetMargin: 1.6,
  probeIntervalMs: 30000,
};

export interface HoldAudioMonitor {
  /** Feed a mu-law audio frame. Returns a WakeReason if a wake trigger fired. */
  pushFrame: (pcmu: Buffer, nowMs: number) => WakeReason | null;
  /** Snapshot of internals — useful for tests. */
  inspect: () => {
    rollingRms: number;
    sustainedEnergyMs: number;
    silenceMs: number;
    msSinceLastProbe: number;
  };
}

/**
 * Create a stateful audio monitor for one call.
 * `enteredAtMs` is the timestamp (epoch ms) when LOW_POWER state began —
 * used to measure probe intervals.
 */
export function createHoldAudioMonitor(
  enteredAtMs: number,
  config: MonitorConfig = DEFAULT_MONITOR_CONFIG
): HoldAudioMonitor {
  // Telnyx mu-law @ 8kHz: each byte = 1 sample = 0.125ms.
  const msPerByte = 1000 / 8000;

  let rollingRms = 0;
  const rollingAlpha = 0.1;
  let sustainedEnergyMs = 0;
  let silenceMs = 0;
  let lastProbeAtMs = enteredAtMs;
  let lastNowMs = enteredAtMs;

  function pushFrame(pcmu: Buffer, nowMs: number): WakeReason | null {
    const frameMs = pcmu.length * msPerByte;
    lastNowMs = nowMs;

    const rms = computePcmuRms(pcmu);
    rollingRms =
      rollingRms === 0 ? rms : rollingRms + rollingAlpha * (rms - rollingRms);

    const isSilent = rms < config.silenceThreshold;

    if (isSilent) {
      silenceMs += frameMs;
    } else {
      // Energetic frame — accumulate sustained-energy if we were already energetic
      // (i.e. don't reset just because of a single noisy spike; require a real
      // silence stretch to reset).
      if (silenceMs < 200) {
        sustainedEnergyMs += frameMs;
      } else {
        // After a meaningful silence, restart the sustained-energy counter.
        sustainedEnergyMs = frameMs;
      }
      silenceMs = 0;
    }

    // Silence-break: had sustained energy, then long silence.
    if (
      sustainedEnergyMs >= config.minSustainedEnergyMs &&
      silenceMs >= config.silenceBreakMs
    ) {
      return 'silence-break';
    }

    // Speech-onset: sudden RMS well above rolling baseline, sustained briefly.
    // Detected by checking if the latest frame's RMS exceeds the long-term
    // rolling baseline by `margin` and sustained-energy crossed the threshold.
    if (
      rollingRms > 0 &&
      rms > rollingRms * config.speechOnsetMargin &&
      sustainedEnergyMs >= config.speechOnsetSustainedMs &&
      // Require some prior baseline period so we don't fire on the very first
      // few frames where rollingRms hasn't converged yet.
      nowMs - enteredAtMs > 1000
    ) {
      return 'speech-onset';
    }

    // Periodic probe.
    if (nowMs - lastProbeAtMs >= config.probeIntervalMs) {
      lastProbeAtMs = nowMs;
      return 'periodic-probe';
    }

    return null;
  }

  return {
    pushFrame,
    inspect: () => ({
      rollingRms,
      sustainedEnergyMs,
      silenceMs,
      msSinceLastProbe: lastNowMs - lastProbeAtMs,
    }),
  };
}

/** True if the env flag enables hold low-power mode. Default OFF. */
export function isHoldLowPowerEnabled(): boolean {
  return process.env.ENABLE_HOLD_LOW_POWER_MODE === 'true';
}
