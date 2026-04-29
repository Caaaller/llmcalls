import {
  computePcmuRms,
  createHoldAudioMonitor,
  DEFAULT_MONITOR_CONFIG,
  isHoldLowPowerEnabled,
} from '../holdAudioMonitor';

/**
 * Build a 20ms PCMU frame (160 samples @ 8kHz) with a target linear-amplitude
 * RMS by encoding the linear value into mu-law.
 */
function makePcmuFrame(linearAmplitude: number, sizeBytes = 160): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  const mulawByte = linearToMulaw(linearAmplitude);
  buf.fill(mulawByte);
  return buf;
}

/** Standard mu-law encoder (G.711) — used only by test helpers. */
function linearToMulaw(sample: number): number {
  const MULAW_BIAS = 0x84;
  const MULAW_CLIP = 32635;
  const sign = sample < 0 ? 0x80 : 0;
  let s = Math.min(Math.abs(sample), MULAW_CLIP);
  s += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  const mulaw = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulaw;
}

describe('computePcmuRms', () => {
  it('returns near-zero for true silence (mu-law encoding of 0)', () => {
    const silence = makePcmuFrame(0);
    expect(computePcmuRms(silence)).toBeLessThan(50);
  });

  it('returns large value for high-amplitude tone', () => {
    const loud = makePcmuFrame(20000);
    expect(computePcmuRms(loud)).toBeGreaterThan(5000);
  });

  it('returns 0 for empty buffer', () => {
    expect(computePcmuRms(Buffer.alloc(0))).toBe(0);
  });
});

describe('createHoldAudioMonitor', () => {
  const config = DEFAULT_MONITOR_CONFIG;

  it('does NOT wake during steady hold music', () => {
    const monitor = createHoldAudioMonitor(0, config);
    const musicFrame = makePcmuFrame(3000); // moderate energy, above silenceThreshold
    let now = 0;
    let wokeAt: string | null = null;
    // Feed ~10s of steady music (500 frames * 20ms each).
    for (let i = 0; i < 500; i++) {
      const wake = monitor.pushFrame(musicFrame, now);
      if (wake && wake !== 'periodic-probe') {
        wokeAt = `frame ${i} (${wake})`;
        break;
      }
      now += 20;
    }
    expect(wokeAt).toBeNull();
  });

  it('fires silence-break after sustained energy then long silence', () => {
    const monitor = createHoldAudioMonitor(0, config);
    let now = 0;
    let woke: string | null = null;
    const energetic = makePcmuFrame(3000);
    const silent = makePcmuFrame(0);

    // 2s of music — easily over minSustainedEnergyMs (1500).
    for (let i = 0; i < 100; i++) {
      monitor.pushFrame(energetic, now);
      now += 20;
    }
    // Now feed silence; expect silence-break around 1500ms in.
    for (let i = 0; i < 200; i++) {
      const wake = monitor.pushFrame(silent, now);
      if (wake) {
        woke = wake;
        break;
      }
      now += 20;
    }
    expect(woke).toBe('silence-break');
  });

  it('fires speech-onset when a loud burst exceeds rolling baseline', () => {
    const monitor = createHoldAudioMonitor(0, config);
    let now = 0;
    let woke: string | null = null;
    const baseline = makePcmuFrame(1500); // quiet hold music
    const loud = makePcmuFrame(20000); // human voice burst

    // Establish a rolling baseline of quiet music for ~1.5s (over the
    // 1000ms warmup the monitor needs before speech-onset can fire).
    for (let i = 0; i < 75; i++) {
      monitor.pushFrame(baseline, now);
      now += 20;
    }
    // Hit it with sustained loud audio.
    for (let i = 0; i < 50; i++) {
      const wake = monitor.pushFrame(loud, now);
      if (wake && wake !== 'periodic-probe') {
        woke = wake;
        break;
      }
      now += 20;
    }
    expect(woke).toBe('speech-onset');
  });

  it('fires periodic probe at the configured interval', () => {
    const customConfig = { ...config, probeIntervalMs: 5000 };
    const monitor = createHoldAudioMonitor(0, customConfig);
    const musicFrame = makePcmuFrame(3000);
    let now = 0;
    const probes: number[] = [];
    for (let i = 0; i < 600; i++) {
      const wake = monitor.pushFrame(musicFrame, now);
      if (wake === 'periodic-probe') probes.push(now);
      now += 20;
    }
    // Over 12s of music with 5s probe interval, expect ~2 probes.
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expect(probes[0]).toBeGreaterThanOrEqual(5000);
  });

  it('does not fire speech-onset within the first second (warmup)', () => {
    const monitor = createHoldAudioMonitor(0, config);
    let now = 0;
    let woke: string | null = null;
    const loud = makePcmuFrame(20000);
    // Slam loud audio from t=0 — should not wake before warmup elapses.
    for (let i = 0; i < 40; i++) {
      const wake = monitor.pushFrame(loud, now);
      if (wake && wake !== 'periodic-probe') {
        woke = wake;
        break;
      }
      now += 20;
      if (now > 800) break;
    }
    expect(woke).toBeNull();
  });
});

describe('isHoldLowPowerEnabled', () => {
  const original = process.env.ENABLE_HOLD_LOW_POWER_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_HOLD_LOW_POWER_MODE;
    else process.env.ENABLE_HOLD_LOW_POWER_MODE = original;
  });

  it('returns false when env var unset', () => {
    delete process.env.ENABLE_HOLD_LOW_POWER_MODE;
    expect(isHoldLowPowerEnabled()).toBe(false);
  });

  it('returns true only when env var = "true"', () => {
    process.env.ENABLE_HOLD_LOW_POWER_MODE = 'true';
    expect(isHoldLowPowerEnabled()).toBe(true);
    process.env.ENABLE_HOLD_LOW_POWER_MODE = '1';
    expect(isHoldLowPowerEnabled()).toBe(false);
  });
});
