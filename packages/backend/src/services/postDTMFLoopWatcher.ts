/**
 * Post-DTMF Loop Watcher
 *
 * Some IVRs (e.g. Costco) speak their menu continuously with no silence gap
 * between loops. After we send a DTMF press the IVR keeps playing, but because
 * there's no trailing silence Deepgram never fires another `speech_final` or
 * `UtteranceEnd`. The AI therefore never gets a second turn, `loopDetected`
 * never flips true, and the existing loop-override in `speechProcessingService`
 * (commit a01d3b6) never triggers — the call sits idle until the runner times
 * out 5 min later.
 *
 * The fix: after a DTMF press, accumulate Deepgram interim-transcript text in
 * call state. Once enough interim text has built up and the watcher window has
 * elapsed, force-dispatch the accumulated text to the normal speech-processing
 * entry point. The AI then sees "you pressed X, but here's the menu again" and
 * the deterministic loop-override kicks in.
 *
 * Pure, side-effect-free condition check lives here so we can unit test without
 * Deepgram / Telnyx / Mongo.
 */

import type { CallState } from './callStateManager';

/** Watcher window. After this many ms post-DTMF with no speech_final, we
 * consider the IVR to be talking continuously (no silence gap) and force a
 * reprocess. Matches the de-dup window so we never fire more than once per
 * window. Initial value: 5000ms — picked to beat the 5-min runner timeout
 * with many-press headroom while staying above typical menu-readout lengths. */
export const POST_DTMF_LOOP_WATCHER_MS = 5000;

/** Minimum accumulated interim-text length before the watcher will fire.
 * Guards against force-dispatching a near-empty transcript (e.g. only a filler
 * word arrived since the press). Menu prompts typically exceed 40 chars. */
export const MIN_ACCUMULATED_CHARS = 20;

export interface ShouldForceReprocessInput {
  lastDTMFPressedAt?: number;
  forcedReprocessFiredAt?: number;
  accumulatedInterimText?: string;
  isSpeaking?: boolean;
}

/**
 * Pure predicate: returns true when the post-DTMF watcher should force a
 * reprocess right now. Decoupled from CallState so tests don't need the full
 * object — but CallState satisfies this shape structurally.
 */
export function shouldForceReprocess(
  cs: ShouldForceReprocessInput,
  now: number
): boolean {
  // Watcher isn't armed until a DTMF has actually been sent.
  if (cs.lastDTMFPressedAt === undefined) return false;

  // Don't talk over ourselves — if the AI/TTS is currently playing, wait.
  if (cs.isSpeaking) return false;

  const sinceDTMF = now - cs.lastDTMFPressedAt;
  if (sinceDTMF < POST_DTMF_LOOP_WATCHER_MS) return false;

  const accumulated = cs.accumulatedInterimText ?? '';
  if (accumulated.length < MIN_ACCUMULATED_CHARS) return false;

  // De-dup: only fire once per watcher window. Second loop iteration will
  // arm again naturally once the interim transcript re-grows.
  const sinceLastForce =
    cs.forcedReprocessFiredAt !== undefined
      ? now - cs.forcedReprocessFiredAt
      : Infinity;
  if (sinceLastForce < POST_DTMF_LOOP_WATCHER_MS) return false;

  return true;
}

/**
 * Append interim-transcript text to the running accumulator. Caller passes the
 * existing value and the new interim text; returns the new accumulator value.
 * Deepgram interim results repeat and extend each other, so we keep the
 * latest (longest) interim rather than concatenating every partial — otherwise
 * the length check would fire on the first interim alone.
 *
 * Simplest correct approach: if the new interim contains the old interim as a
 * prefix, replace; otherwise append a space-separator.
 */
export function appendInterim(existing: string, newInterim: string): string {
  const prev = existing ?? '';
  const next = (newInterim ?? '').trim();
  if (!next) return prev;
  if (!prev) return next;
  if (next.startsWith(prev) || prev.startsWith(next)) {
    return next.length > prev.length ? next : prev;
  }
  return `${prev} ${next}`;
}

/**
 * Clear all post-DTMF-watcher state fields. Called when a real speech_final
 * fires (or UtteranceEnd) so the watcher resets for the next press.
 */
export function resetWatcherFields(): Pick<
  CallState,
  'lastDTMFPressedAt' | 'accumulatedInterimText' | 'forcedReprocessFiredAt'
> {
  return {
    lastDTMFPressedAt: undefined,
    accumulatedInterimText: '',
    forcedReprocessFiredAt: undefined,
  };
}
