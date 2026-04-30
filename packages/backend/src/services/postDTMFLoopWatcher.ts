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
import {
  type DGSegment,
  type SegmentMergerState,
  clearSegments,
  mergeSegment,
  renderTranscript,
} from './transcriptSegmentMerger';

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
  accumulatedInterimSegments?: SegmentMergerState;
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

  const accumulated = renderAccumulated(cs.accumulatedInterimSegments);
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
 * Render the accumulated interim segments to a single transcript string.
 * Returns '' when the accumulator is empty / undefined.
 */
export function renderAccumulated(
  state: SegmentMergerState | undefined
): string {
  if (!state) return '';
  return renderTranscript(state);
}

/**
 * Append an interim Deepgram segment to the running accumulator using
 * time-anchored segment merging. Deepgram interim_results emit successive
 * events with [start, duration] windows; later events over the same window
 * REVISE earlier ones (e.g. "press one" → "press 1"). String concatenation
 * could re-introduce the duplication problem PR #46 fixed for is_finals —
 * so the interim path now uses the same merger as the is_final path.
 *
 * Returns a new SegmentMergerState — does not mutate input.
 */
export function appendInterimSegment(
  existing: SegmentMergerState | undefined,
  incoming: DGSegment
): SegmentMergerState {
  const state = existing ?? clearSegments();
  if (!incoming.text || !incoming.text.trim()) return state;
  return mergeSegment(state, incoming);
}

/**
 * Clear all post-DTMF-watcher state fields. Called when a real speech_final
 * fires (or UtteranceEnd) so the watcher resets for the next press.
 */
export function resetWatcherFields(): Pick<
  CallState,
  'lastDTMFPressedAt' | 'accumulatedInterimSegments' | 'forcedReprocessFiredAt'
> {
  return {
    lastDTMFPressedAt: undefined,
    accumulatedInterimSegments: clearSegments(),
    forcedReprocessFiredAt: undefined,
  };
}
