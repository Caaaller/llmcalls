/**
 * Barge-in detection
 *
 * When the AI is mid-TTS and the user/live agent starts speaking, we want
 * to stop our own playback immediately so turn boundaries don't feel robotic.
 *
 * Trigger: Deepgram interim transcript (is_final=false) with sufficient
 * content, while callState.isSpeaking is true. Cancellation is performed
 * by telnyxService.stopSpeak (maps to Telnyx stopPlayback under the hood).
 *
 * Guardrails:
 *   1. Post-start lockout (500ms): don't cancel within the first 500ms of
 *      a TTS playback. Protects against acoustic feedback / echo from our
 *      own audio triggering a self-cancel.
 *   2. Minimum utterance (≥2 words): single "uh" / "um" blips don't count.
 *   3. Once-per-utterance: after cancellation, bargeInFiredThisTurn is set
 *      so subsequent interims in the same turn are ignored.
 */

import type { CallState } from './callStateManager';

/** Minimum ms after speak starts before barge-in can fire. Protects against
 *  acoustic echo / our own audio coming back through the phone mic. */
export const BARGE_IN_POST_START_LOCKOUT_MS = 500;

/** Minimum interim-word count required to count as a real interruption. */
export const BARGE_IN_MIN_WORDS = 2;

function countWords(transcript: string): number {
  const trimmed = transcript.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Pure decision helper: given the current call state, a Deepgram interim
 * transcript, and the current time, decide whether we should cancel
 * in-flight TTS.
 *
 * Exported for unit tests — runtime callers should use via streamRoutes.
 */
export function shouldBargeIn(
  state: Pick<
    CallState,
    'isSpeaking' | 'lastSpeakStartedAt' | 'bargeInFiredThisTurn'
  >,
  transcript: string,
  now: number
): boolean {
  if (!state.isSpeaking) return false;
  if (state.bargeInFiredThisTurn) return false;
  if (!state.lastSpeakStartedAt) return false;
  if (now - state.lastSpeakStartedAt < BARGE_IN_POST_START_LOCKOUT_MS) {
    return false;
  }
  return countWords(transcript) >= BARGE_IN_MIN_WORDS;
}
